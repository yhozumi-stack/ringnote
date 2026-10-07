// 日ごとの派生指標（設計書 1.2 と 2 章）。

import { addDays, median, stdev, weekday } from './util.js';

/** 睡眠ステージの区分。2026-10-07 の実データで、1分ごとの分数が日次の内訳と4つとも一致することを確認した */
export const STAGE_NAMES = { 0: 'deep', 1: 'light', 2: 'rem', 3: 'awake' };
export const STAGE_LABELS = { deep: '深い睡眠', light: '浅い睡眠', rem: 'レム睡眠', awake: '覚醒', other: 'その他' };

/** 夜の区分（設計書 1.2）: none 記録なし / short 短すぎる / ok 分析できる */
export function nightClass(day, cfg) {
  if (!day || !day.hasNight) return 'none';
  return day.v.sleep_total_sleep_time >= cfg.night.analyzableMin ? 'ok' : 'short';
}

/**
 * 5分データから、その夜の派生値を作る（設計書 2.1）。
 * epochs は正規化済みの5分データ（normalizeEpochs の戻り値）。その夜を含んでいればよい。
 * 戻り値を day にそのまま代入できる。5分データが無い夜は全部 null。
 */
export function nightFeatures(day, epochs) {
  const empty = { nightTemp: null, nightOdi: null, minHrPos: null, nightCoverage: null, stageMinutes: null, unknownStages: [] };
  if (!day || !day.hasNight || day.sleepStart == null || !epochs || !epochs.length) return empty;
  // 5分データの時刻は、各枠の「終わり」を指す（実データで確認済み。就寝が 0 時の少し前の夜なら、最初の枠が 0:00、最後の枠が起床時刻ちょうどになる）
  const seg = epochs.filter((e) => e.t > day.sleepStart && e.t <= day.sleepEnd);
  const expected = Math.max(1, Math.round((day.sleepEnd - day.sleepStart) / 300000));
  if (!seg.length) return { ...empty, nightCoverage: 0 };

  // 夜間の皮膚温: 睡眠中の有効な値の中央値（指輪のずれや布団から手が出た時の外れ値に強い）
  const nightTemp = median(seg.map((e) => e.temp));

  // 最低心拍が出た位置（0=就寝直後 1=起床直前）。夜間の回復の様子を見る補助
  let minHr = null; let minAt = null;
  for (const e of seg) {
    const hr = e.sHr != null ? e.sHr : e.hr;
    if (hr != null && (minHr == null || hr < minHr)) { minHr = hr; minAt = e.t; }
  }
  const minHrPos = minAt == null ? null : (minAt - day.sleepStart) / (day.sleepEnd - day.sleepStart);

  // ODI: 睡眠中の平均（0 は「低下なし」の本物の値）
  const odis = seg.map((e) => e.odi).filter((x) => x != null);
  const nightOdi = odis.length ? odis.reduce((a, b) => a + b, 0) / odis.length : null;

  // 睡眠ステージごとの分数と、想定外の値の検出（黙って捨てない）。
  // 区分は実データで確認したもの（仕様書の記載とは異なる）。1分ごとの記録があればそちらで数える
  const stageMinutes = { deep: 0, light: 0, rem: 0, awake: 0, other: 0 };
  const unknownStages = new Set();
  const count = (code, minutes) => {
    const name = STAGE_NAMES[code];
    if (!name) unknownStages.add(code);
    stageMinutes[name || 'other'] += minutes;
  };
  for (const e of seg) {
    if (e.stage == null) continue;
    if (e.stage1) e.stage1.forEach((code) => count(code, 1));
    else count(e.stage, 5);
  }

  const withHr = seg.filter((e) => e.worn).length;
  return {
    nightTemp, nightOdi, minHrPos,
    nightCoverage: Math.min(1, withHr / expected),
    stageMinutes,
    unknownStages: [...unknownStages].sort((a, b) => a - b),
  };
}

/**
 * 平常値の材料にする夜かどうか（設計書 1.2）のうち、その夜だけで決まる条件。
 * 「強い兆候の日でない」「時差移動の直後でない」は index.js が時系列で判定する。
 */
export function nightQualifiesForBaseline(day, cfg) {
  if (nightClass(day, cfg) !== 'ok') return false;
  if (day.v.sleep_total_sleep_time < cfg.night.baselineMin) return false;
  if (day.nightCoverage != null && day.nightCoverage < cfg.night.minCoverage) return false;
  return true;
}

/** 睡眠負債（設計書 2.2）。直近14日、昼寝を含む、直近7日は重み1・それより前は半分。 */
export function sleepDebt(days, date, cfg) {
  const s = cfg.sleep;
  let total = 0; let nights = 0;
  for (let i = 0; i < s.debtWindowDays; i++) {
    const d = days.get(addDays(date, -i));
    if (!d || !d.hasNight) continue; // 記録の無い日は「不足」とも「充足」とも数えない
    nights += 1;
    const slept = d.v.sleep_total_sleep_time + (d.v.sleep_nap_time || 0);
    total += (s.needMin - slept) * (i < s.debtRecentDays ? 1 : s.debtOlderWeight);
  }
  if (nights < s.debtMinNights) return { status: 'insufficient', nights, needed: s.debtMinNights };
  const minutes = Math.max(0, Math.round(total)); // 寝すぎた日は不足を相殺する。0 未満にはしない
  const band = s.debtBands.find((b) => minutes <= b.max);
  return { status: 'ok', minutes, band: band.key, label: band.label, nights, needMin: s.needMin };
}

/** 睡眠の規則性（設計書 2.1 / 3.1）。直近7日の睡眠中央時刻のばらつき。 */
export function sleepRegularity(days, date, cfg) {
  const s = cfg.sleep;
  const mids = [];
  for (let i = 0; i < s.regularityDays; i++) {
    const d = days.get(addDays(date, -i));
    if (d && d.midSleepMin != null) mids.push(d.midSleepMin);
  }
  if (mids.length < s.regularityMinNights) return { status: 'insufficient', nights: mids.length, needed: s.regularityMinNights };
  const sdMin = Math.round(stdev(mids));
  const band = s.regularityBands.find((b) => sdMin <= b.max);
  return { status: 'ok', sdMin, band: band.key, label: band.label, nights: mids.length };
}

/** 平日と休日の睡眠中央時刻の差（分）。休日 = 土曜と日曜の朝に終わる睡眠。直近28日で各2夜以上ある時だけ。 */
export function weekendGap(days, date, cfg) {
  const weekend = []; const week = [];
  for (let i = 0; i < cfg.baseline.windowDays; i++) {
    const key = addDays(date, -i);
    const d = days.get(key);
    if (!d || d.midSleepMin == null) continue;
    const w = weekday(key);
    (w === 0 || w === 6 ? weekend : week).push(d.midSleepMin);
  }
  if (weekend.length < 2 || week.length < 2) return null;
  return Math.round(median(weekend) - median(week));
}

/** 身体負荷に使う値（活動カロリー。無ければ歩数）と、その単位 */
export function loadValue(day) {
  if (!day || !day.worn) return null;
  if (day.v.activity_calories != null) return { value: day.v.activity_calories, source: 'activity_calories' };
  if (day.v.activity_steps != null) return { value: day.v.activity_steps, source: 'activity_steps' };
  return null;
}

/** 負荷のバランス: 直近7日の合計 ÷ 直近28日の週平均。値が無い日は除く。 */
export function loadBalance(days, date) {
  const pick = (from, to) => {
    const out = [];
    for (let i = from; i <= to; i++) {
      const l = loadValue(days.get(addDays(date, -i)));
      if (l && l.source === 'activity_calories') out.push(l.value);
    }
    return out;
  };
  const recent = pick(1, 7);
  const long = pick(1, 28);
  if (recent.length < 4 || long.length < 14) return null;
  const r = recent.reduce((a, b) => a + b, 0) / recent.length;
  const l = long.reduce((a, b) => a + b, 0) / long.length;
  return l > 0 ? Math.round((r / l) * 100) / 100 : null;
}
