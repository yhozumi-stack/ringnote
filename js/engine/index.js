// 分析エンジンの入口（設計書 v0.3）。画面にもブラウザにも依存しない。
// iPhone の画面と朝の DM は、どちらもこの同じ関数を呼ぶ（数字の食い違いを防ぐ）。
//
// 使い方:
//   const days = prepareDays(日次の生データ, { nightByDate, subjectiveByDate });
//   const result = analyze(days, '2026-10-21', { sleepNeedMin: 450 });
//
// 状態は保存しない。毎回、過去の記録を古い順にたどって計算し直す。
// ある日の結果は、その日より後の記録には左右されない。

import { withSettings } from './config.js';
import { normalizeDaily, normalizeEpochs } from './normalize.js';
import { nightClass, nightFeatures, nightQualifiesForBaseline, sleepDebt, sleepRegularity, weekendGap, loadValue, loadBalance } from './features.js';
import { metricValue, baselineFor, deviation, trendFor, baselineFromValues } from './baseline.js';
import { recoveryScore } from './recovery.js';
import { radarForNight, radarMessage } from './radar.js';
import { todayGuidance } from './guidance.js';
import { sanitizeSubjective, contextNotes } from './subjective.js';
import { addDays } from './util.js';

export { CONFIG } from './config.js';
export { normalizeDaily, normalizeEpochs, decodeStage1min } from './normalize.js';
export { nightFeatures, STAGE_NAMES, STAGE_LABELS } from './features.js';
export { awakeEpochs, stressDayStats, stressAnalysis } from './stress.js';
export { DAILY_FIELDS, DETAIL_FIELDS } from './fields.js';
export { SUBJECTIVE_FIELDS, FIELD_GROUPS, COLD_SYMPTOMS, optionLabel, sanitizeSubjective, fieldsOf, missingFields, hadCaffeine, energyCaffeineMg, lastCaffeineAt, lastTimeAt, iqosGapMin, iqosGapBand, iqosRelativeBand, iqosInputDays, countBand } from './subjective.js';
export { OUTCOMES, COMPARISONS, groupCompare, allComparisons, coldEpisodes, sampleLevel } from './insights.js';
export { exportLifelogJson, exportLifelogCsv, parseLifelog, mergeLifelog } from './lifelog-io.js';
export { buildAnalysisExport, analysisExportCsv, buildDetailExport } from './analysis-export.js';
export { archiveNeedsRefetch, decideArchiveUpdate } from './archive-policy.js';

/**
 * API の日次データを、分析用の「日」の集まりにする。
 * @param {object[]} rawDaily  /api/v2/DailyInfoData の応答（配列）
 * @param {object} [extra]
 * @param {Object<string, object>} [extra.nightByDate]       日付 → nightFeatures() の戻り値（5分データから作った派生値）
 * @param {Object<string, object>} [extra.subjectiveByDate]  日付 → 主観入力（項目は subjective.js）
 * @returns {Map<string, object>} 日付の昇順
 */
export function prepareDays(rawDaily, { nightByDate = {}, subjectiveByDate = {} } = {}) {
  const list = [];
  for (const raw of rawDaily || []) {
    const d = normalizeDaily(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
    const nf = nightByDate[d.date];
    if (nf) {
      d.nightTemp = nf.nightTemp ?? null;
      d.nightOdi = nf.nightOdi ?? null;
      d.minHrPos = nf.minHrPos ?? null;
      d.nightCoverage = nf.nightCoverage ?? null;
    }
    d.subjective = sanitizeSubjective(subjectiveByDate[d.date]);
    list.push(d);
  }
  list.sort((a, b) => (a.date < b.date ? -1 : 1));
  return new Map(list.map((d) => [d.date, d]));
}

const STAGE_LABEL = { learning: 'ベースライン学習中', provisional: '暫定（学習中）', normal: '分析中' };
const CONF_ORDER = ['low', 'mid', 'high'];
const CONF_LABEL = { high: '高', mid: '中', low: '低', na: '判定不可' };

function fmtSleep(min) {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}時間${String(m % 60).padStart(2, '0')}分`;
}

function signed(v, digits = 0) {
  const r = Number(v.toFixed(digits));
  if (r === 0) return '±0';
  return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(digits);
}

/** 「今日の変化」に出す短い文 */
function changeText(key, m, cfg) {
  const def = cfg.metrics[key];
  if (!m.dev) return null;
  if (def.show === 'pct') return `${def.label} ${signed(m.dev.pct * 100)}%`;
  return `${def.label} ${signed(m.dev.diff, def.digits || 0)}${def.unit === 'ポイント' ? '' : def.unit}`;
}

/**
 * すべての日を古い順に分析する。
 * @returns {Map<string, object>} 日付 → 分析結果
 */
export function analyzeAll(days, settings = {}) {
  const cfg = withSettings(settings);
  const dates = [...days.keys()].sort();
  const eligible = new Set();          // 平常値の材料にする夜
  const isEligible = (d) => eligible.has(d);
  const results = new Map();

  let prevOffset = null;
  let tzShiftUntil = null;             // 時差のある移動の影響が残る最終日
  let prevMl = null;
  let mlChangedOn = null;
  let prevJudged = null;               // 直前の「判定できた夜」の最終レベル
  const episode = { active: false, clear: 0 };

  for (const date of dates) {
    const day = days.get(date);

    // ---- 条件の変化（時差・解析モデルの版） ----
    if (prevOffset != null && day.offset !== prevOffset) tzShiftUntil = addDays(date, cfg.night.tzShiftExcludeDays - 1);
    prevOffset = day.offset;
    const tzShifted = tzShiftUntil != null && date <= tzShiftUntil;
    if (day.mlVer && prevMl && day.mlVer !== prevMl) mlChangedOn = date;
    if (day.mlVer) prevMl = day.mlVer;
    const mlRecentlyChanged = mlChangedOn != null && date <= addDays(mlChangedOn, 6);

    // ---- 学習の段階（直前28日の、平常値の材料にする夜の数） ----
    let nights = 0;
    for (let i = 1; i <= cfg.baseline.windowDays; i++) if (eligible.has(addDays(date, -i))) nights += 1;
    const stageKey = nights >= cfg.stages.normal ? 'normal' : nights >= cfg.stages.provisional ? 'provisional' : 'learning';
    const stage = { key: stageKey, label: STAGE_LABEL[stageKey], nights, needed: cfg.stages.normal,
      progress: `${Math.min(nights, cfg.stages.normal)}/${cfg.stages.normal}日` };

    const nclass = nightClass(day, cfg);

    // ---- 指標ごとの平常値とズレ ----
    const metrics = {};
    for (const key of Object.keys(cfg.metrics)) {
      const value = nclass === 'none' ? null : metricValue(day, key, cfg);
      const base = baselineFor(days, date, key, cfg, isEligible);
      metrics[key] = { value, base, dev: nclass === 'ok' ? deviation(value, base) : null, trend: trendFor(days, date, key, cfg, isEligible, base) };
    }

    // ---- 前日の身体負荷（前日の値を、その前の28日と比べる） ----
    let load = null;
    const yLoad = loadValue(days.get(addDays(date, -1)));
    if (yLoad) {
      const prior = [];
      for (let i = 2; i <= cfg.baseline.windowDays + 1; i++) {
        const l = loadValue(days.get(addDays(date, -i)));
        if (l && l.source === yLoad.source) prior.push(l.value);
      }
      const lb = baselineFromValues(prior, { minValues: cfg.baseline.minValues, floorPct: 0.1 });
      if (lb.ready) load = { value: yLoad.value, source: yLoad.source, z: (yLoad.value - lb.median) / lb.spread, median: lb.median };
    }

    // ---- 睡眠 ----
    const debt = sleepDebt(days, date, cfg);
    const sleep = {
      soxaiScore: day.v.sleep_score,
      minutes: day.v.sleep_total_sleep_time,
      debt,
      soxaiDebtMin: day.v.sleep_debt,
      regularity: sleepRegularity(days, date, cfg),
      weekendGapMin: weekendGap(days, date, cfg),
      minHr: day.v.sleep_hr_min,
      minHrPos: day.minHrPos,
      needMin: cfg.sleep.needMin,
      needIsProvisional: settings.sleepNeedMin == null,
    };

    // ---- 体調変化（3.4） ----
    let radar;
    if (stageKey === 'learning') {
      radar = { status: 'learning', level: 'none', label: cfg.radar.levels.none, returned: false, inEpisode: false, message: null };
    } else if (nclass !== 'ok') {
      // 判定できない夜は、連続日数を切りも伸ばしもしない
      radar = { status: 'unjudgeable', level: 'none', label: '判定不可', returned: false, inEpisode: episode.active, message: null,
        reason: nclass === 'none' ? 'この夜の睡眠の記録がありません' : '睡眠が3時間未満のため判定できません' };
    } else {
      const night = radarForNight(metrics, cfg);
      let level = night.level;
      const consecutive = level !== 'none' && prevJudged != null && prevJudged !== 'none';
      if (level === 'mild' && consecutive) level = 'strong'; // 「軽い兆候」以上が2夜連続
      let returned = false;
      if (level !== 'none') {
        episode.active = true;
        episode.clear = 0;
      } else if (episode.active) {
        if (night.flagged === 0) {
          episode.clear += 1;
          if (episode.clear >= cfg.radar.clearNightsToReturn) { returned = true; episode.active = false; episode.clear = 0; }
        } else {
          episode.clear = 0; // 1系統だけ外れている夜は「平常に戻った夜」に数えない
        }
      }
      prevJudged = level;
      radar = { ...night, status: stageKey === 'normal' ? 'active' : 'reference', level, baseLevel: night.level, consecutive,
        label: cfg.radar.levels[level], returned, inEpisode: episode.active };
      radar.message = radarMessage(radar, cfg);
    }

    // ---- 回復（3.2）: 14夜たまってから ----
    let recovery;
    if (stageKey !== 'normal') recovery = { status: 'learning', progress: stage.progress };
    else if (nclass !== 'ok') recovery = { status: 'unavailable', reason: nclass === 'none' ? 'この夜の睡眠の記録がありません' : '睡眠が3時間未満のため算出できません' };
    else recovery = recoveryScore({ cfg, day, metrics, debt, load });

    // ---- 信頼度（1.6） ----
    const confidence = confidenceFor({ cfg, stage, nclass, day, metrics, tzShifted, mlRecentlyChanged });

    // ---- 今日の運動の目安（4章） ----
    const guidance = todayGuidance({ cfg, recovery, radar, sleepMin: day.hasNight ? day.v.sleep_total_sleep_time : null, subjective: day.subjective });

    // ---- 今日の変化 ----
    const changes = [];
    for (const key of ['hrv', 'hr', 'temp']) {
      const text = changeText(key, metrics[key], cfg);
      if (text) changes.push({ key, text, provisional: stageKey !== 'normal' });
    }
    if (day.hasNight) changes.push({ key: 'sleep', text: `睡眠 ${fmtSleep(day.v.sleep_total_sleep_time)}`, provisional: false });
    if (radar.tempDrop) changes.push({ key: 'tempDrop', text: '皮膚温が平常より低め（寝具や室温でも下がります）', provisional: stageKey !== 'normal' });

    results.set(date, {
      date, stage, confidence,
      night: { class: nclass, coverage: day.nightCoverage, baselineEligible: false },
      metrics, load, loadBalance: loadBalance(days, date),
      sleep, recovery, radar, guidance, changes,
      soxai: { sleep: day.v.sleep_score, health: day.v.health_score, activity: day.v.activity_score, qol: day.v.qol_score },
      subjective: day.subjective,
      // 数値の変化を読み解くための一言（飲酒の印など）。判定や点数は変えない
      context: contextNotes({ subjective: day.subjective, metrics, radar }),
    });

    // ---- この夜を、明日以降の平常値の材料にするか（1.2） ----
    const strong = radar.level === 'strong' && (radar.status === 'active' || radar.status === 'reference');
    if (nightQualifiesForBaseline(day, cfg) && !tzShifted && !strong) {
      eligible.add(date);
      results.get(date).night.baselineEligible = true;
    }
  }
  return results;
}

function confidenceFor({ cfg, stage, nclass, day, metrics, tzShifted, mlRecentlyChanged }) {
  if (nclass !== 'ok') {
    return { level: 'na', label: CONF_LABEL.na, reasons: [nclass === 'none' ? 'この夜の睡眠の記録がありません' : '睡眠が3時間未満です'] };
  }
  if (stage.key === 'learning') return { level: 'na', label: CONF_LABEL.na, reasons: [`ベースライン学習中（${stage.progress}）`] };
  let idx = stage.nights >= cfg.stages.high ? 2 : stage.nights >= cfg.stages.normal ? 1 : 0;
  const reasons = [];
  if (idx < 2) reasons.push(`平常値の材料が${stage.nights}夜分です`);
  const down = (why) => { idx = Math.max(0, idx - 1); reasons.push(why); };
  if (day.v.sleep_total_sleep_time < cfg.night.baselineMin) down('睡眠が4時間未満です');
  if (day.nightCoverage != null && day.nightCoverage < cfg.night.minCoverage) down('睡眠中の記録に欠けが多い夜です');
  const lacking = ['temp', 'resp'].filter((k) => !metrics[k].dev).map((k) => cfg.metrics[k].label);
  if (lacking.length) down(`${lacking.join('と')}が使えていません`);
  if (tzShifted) down('時差のある移動の直後です');
  if (mlRecentlyChanged) down('解析モデルの版が変わった直後です');
  const level = CONF_ORDER[idx];
  return { level, label: CONF_LABEL[level], reasons };
}

/** 1日分だけ欲しい時用。その日までの記録だけを使って計算する。 */
export function analyze(days, date, settings = {}) {
  const upTo = new Map([...days].filter(([d]) => d <= date));
  return analyzeAll(upTo, settings).get(date) || null;
}

/** 5分データ（API の生の応答）から、その夜の派生値を作る。prepareDays の nightByDate に渡す。 */
export function nightFeaturesFromRaw(rawDailyRow, rawDetailRows) {
  return nightFeatures(normalizeDaily(rawDailyRow), normalizeEpochs(rawDetailRows));
}
