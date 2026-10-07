// 記録との関係（設計書 5.4）。主観入力・生活ログと数値を、後から比べるための集計。
//
// 決まり:
// - 未入力の日は、どの組にも入れない（「なし」「普通」とみなさない）。明示的に入力された値どうしを比べる。
// - 件数が少ない時は値を出さない。5件未満は件数だけ、5〜9件は参考、10件以上で通常の表示。
// - 睡眠と体の値は「自分の平常値との差」の中央値で比べる。相関であって、原因を示すものではない。

import { CONFIG } from './config.js';
import { addDays, diffDays, median } from './util.js';
import { noCaffeine, caffeineTimeBand, countBand, iqosCountBand, iqosGapBand, iqosRelativeBand, trainingGapBand } from './subjective.js';

const dev = (r, key) => (r.metrics[key] && r.metrics[key].dev) || null;
const diffOf = (key) => (r) => { const d = dev(r, key); return d ? d.diff : null; };
const sub = (d) => d.subjective || {};
const judged = (r) => r.radar.status === 'active' || r.radar.status === 'reference';

/**
 * 見る値。get(result, day, days) が null を返した日は、その値の件数に入れない。
 * base=true は「自分の平常値との差」。share=true は「当てはまった日の割合」。どちらも無ければ、その日の値そのもの。
 */
export const OUTCOMES = {
  hrv: { label: '心拍変動', unit: '%', digits: 0, base: true, get: (r) => { const d = dev(r, 'hrv'); return d && d.pct != null ? d.pct * 100 : null; } },
  hr: { label: '睡眠中の心拍', unit: 'bpm', digits: 1, base: true, get: diffOf('hr') },
  temp: { label: '夜間の皮膚温', unit: '℃', digits: 2, base: true, get: diffOf('temp') },
  resp: { label: '呼吸数', unit: '回/分', digits: 1, base: true, get: diffOf('resp') },
  spo2: { label: '血中酸素', unit: '', digits: 1, base: true, get: diffOf('spo2') },
  sleep: { label: '睡眠時間', unit: '分', digits: 0, base: true, get: diffOf('sleep') },
  eff: { label: '睡眠効率', unit: '', digits: 1, base: true, get: diffOf('eff') },
  latency: { label: '寝つくまで', unit: '分', digits: 0, base: true, get: diffOf('latency') },
  soxaiStress: { label: 'SOXAI のストレス値', unit: '', digits: 0, get: (r, d) => d.v.health_stress ?? null },
  // 前日の行動や前日のストレスと組み合わせる時は、同じ「前日」の SOXAI の値を見る
  soxaiStressPrev: { label: '前日の SOXAI ストレス値', unit: '', digits: 0, get: (r, d, days) => { const p = days && days.get(addDays(d.date, -1)); return p ? p.v.health_stress ?? null : null; } },
  score: { label: 'コンディションの点数', unit: '', digits: 0, get: (r) => (r.recovery.status === 'ok' ? r.recovery.score : null) },
  fatigueHigh: { label: '疲労感が「強い」', share: true, get: (r, d) => (sub(d).fatigue == null ? null : sub(d).fatigue === 'high') },
  sorenessHigh: { label: '筋肉痛が「強い」', share: true, get: (r, d) => (sub(d).soreness == null ? null : sub(d).soreness === 'high') },
  detected: { label: '体調の変化を検出', share: true, get: (r) => (judged(r) ? r.radar.level !== 'none' : null) },
};

const SLEEP_SET = ['latency', 'sleep', 'eff', 'hrv', 'hr'];
const IQOS_SET = ['hrv', 'hr', 'latency', 'eff', 'sleep', 'soxaiStressPrev'];
const byValue = (field) => (d) => (sub(d)[field] == null ? null : [String(sub(d)[field])]);

/**
 * 比較の一覧。pick(day, cfg, days) は、その日が入る組の一覧を返す（未入力なら null）。
 * 1日が2つの組に入ることがある（飲酒の「あり」と「うち多め」）。
 */
export const COMPARISONS = [
  { key: 'alcohol', title: '飲酒', outcomes: ['hrv', 'hr', 'temp', 'sleep', 'eff'],
    groups: [['none', 'なし'], ['any', 'あり'], ['much', 'うち多め']],
    pick: (d) => { const v = sub(d).alcohol; return v == null ? null : v === 'none' ? ['none'] : v === 'much' ? ['any', 'much'] : ['any']; } },
  { key: 'coffee', title: 'コーヒーの杯数', outcomes: SLEEP_SET,
    groups: CONFIG.lifelog.coffeeBands.map((b) => [b.key, b.label]),
    pick: (d, cfg) => { const b = countBand(sub(d).coffee ?? null, cfg.lifelog.coffeeBands); return b ? [b] : null; } },
  { key: 'energy', title: 'エナジードリンクの本数', outcomes: SLEEP_SET,
    groups: CONFIG.lifelog.energyBands.map((b) => [b.key, b.label]),
    pick: (d, cfg) => { const b = countBand(sub(d).energy ?? null, cfg.lifelog.energyBands); return b ? [b] : null; } },
  { key: 'caffeineLast', title: '最後にカフェインを摂った時刻', outcomes: SLEEP_SET,
    groups: [['zero', '摂らなかった'], ['am', '12時まで'], ['early', '12〜15時'], ['late', '15〜18時'], ['night', '18時以降']],
    pick: (d, cfg) => { if (noCaffeine(d.subjective)) return ['zero']; const b = caffeineTimeBand(d, cfg); return b ? [b] : null; } },
  { key: 'iqos', title: 'IQOS の本数', outcomes: IQOS_SET,
    groups: CONFIG.lifelog.iqosBands.map((b) => [b.key, b.label]),
    pick: (d, cfg) => { const b = iqosCountBand(d.subjective, cfg); return b ? [b] : null; } },
  // 本人比。固定の区分とは別に、自分のふだんの本数を基準にする。needs は、出せるようになるまでの条件（画面の案内用）
  { key: 'iqosRelative', title: 'IQOS の本数（自分のふだんと比べて）', outcomes: IQOS_SET,
    groups: [['low', '少なめ'], ['usual', '普段どおり'], ['high', '多め']],
    needs: { field: 'iqos', minDays: CONFIG.lifelog.iqosRelative.minDays },
    pick: (d, cfg, days) => { const b = iqosRelativeBand(days, d.date, cfg); return b ? [b] : null; } },
  { key: 'iqosLast', title: '最後に IQOS を吸った時刻', outcomes: IQOS_SET,
    groups: [['zero', '吸わなかった'], ...CONFIG.lifelog.iqosGapBands.map((b) => [b.key, b.label])],
    pick: (d, cfg) => { const b = iqosGapBand(d, cfg); return b ? [b] : null; } },
  { key: 'training', title: '前日の筋トレ負荷', outcomes: ['hrv', 'hr', 'fatigueHigh', 'sorenessHigh'],
    groups: [['none', 'なし'], ['light', '軽い'], ['normal', '普通'], ['hard', '強い']], pick: byValue('training') },
  { key: 'trainingEnd', title: '筋トレを終えた時刻', outcomes: ['latency', 'hr', 'hrv', 'temp', 'sleep', 'eff'],
    groups: [['zero', 'しなかった'], ...CONFIG.lifelog.trainingGapBands.map((b) => [b.key, b.label])],
    pick: (d, cfg) => { const b = trainingGapBand(d, cfg); return b ? [b] : null; } },
  { key: 'mental', title: '昨日の精神的ストレス', outcomes: ['soxaiStressPrev', 'hrv', 'latency', 'sleep', 'eff'],
    groups: [['low', '低い'], ['normal', '普通'], ['high', '高い']], pick: byValue('mental') },
  { key: 'badDay', title: '体調が「悪い」日に動いていた指標', outcomes: ['hrv', 'hr', 'temp', 'resp', 'spo2', 'sleep', 'eff'],
    groups: [['other', '良い・普通'], ['bad', '悪い']],
    pick: (d) => (sub(d).condition == null ? null : [sub(d).condition === 'bad' ? 'bad' : 'other']) },
  { key: 'conditionScore', title: '体調と、コンディションの点数', outcomes: ['score'],
    groups: [['good', '良い'], ['normal', '普通'], ['bad', '悪い']], pick: byValue('condition') },
  { key: 'fatigueScore', title: '疲労感と、コンディションの点数', outcomes: ['score'],
    groups: [['low', '少ない'], ['normal', '普通'], ['high', '強い']], pick: byValue('fatigue') },
  { key: 'coldDetect', title: '風邪っぽい症状と、体調変化の検出', outcomes: ['detected'],
    groups: [['none', '症状なし'], ['sym', '症状あり']],
    pick: (d) => (sub(d).cold == null ? null : [sub(d).cold === 'none' ? 'none' : 'sym']) },
  { key: 'badDetect', title: '体調「悪い」と、体調変化の検出', outcomes: ['detected'],
    groups: [['other', '良い・普通'], ['bad', '悪い']],
    pick: (d) => (sub(d).condition == null ? null : [sub(d).condition === 'bad' ? 'bad' : 'other']) },
];

/** 件数による出し分け: few 値を出さない / ref 参考 / ok 通常 */
export function sampleLevel(n, cfg = CONFIG) {
  return n >= cfg.insights.fullAt ? 'ok' : n >= cfg.insights.refAt ? 'ref' : 'few';
}

function summarize(rows, outcomeKeys, cfg, days) {
  const values = {};
  for (const key of outcomeKeys) {
    const def = OUTCOMES[key];
    const vals = rows.map(({ r, d }) => def.get(r, d, days)).filter((v) => v != null);
    const n = vals.length;
    const level = sampleLevel(n, cfg);
    if (def.share) values[key] = { n, level, count: vals.filter(Boolean).length, value: n ? vals.filter(Boolean).length / n : null };
    else values[key] = { n, level, value: n ? median(vals) : null };
  }
  return values;
}

/**
 * 1つの比較を集計する。
 * @param {Map} days     prepareDays() の戻り値
 * @param {Map} results  analyzeAll() の戻り値
 * @param {object} comparison COMPARISONS の1件
 * @param {object} [p] { from, upTo: この範囲の日だけ使う（両端含む）, cfg }
 */
export function groupCompare(days, results, comparison, { from = null, upTo = null, cfg = CONFIG } = {}) {
  const buckets = new Map(comparison.groups.map(([key]) => [key, []]));
  for (const [date, r] of results) {
    if ((from && date < from) || (upTo && date > upTo)) continue;
    const d = days.get(date);
    if (!d || !d.subjective) continue; // 入力が1つも無い日
    const keys = comparison.pick(d, cfg, days);
    if (!keys) continue;               // この項目が未入力の日は、どの組にも入れない
    for (const k of keys) if (buckets.has(k)) buckets.get(k).push({ r, d });
  }
  return {
    key: comparison.key, title: comparison.title, outcomes: comparison.outcomes,
    groups: comparison.groups.map(([key, label]) => {
      const rows = buckets.get(key);
      return { key, label, n: rows.length, level: sampleLevel(rows.length, cfg), values: summarize(rows, comparison.outcomes, cfg, days) };
    }),
  };
}

/** すべての比較をまとめて集計する */
export function allComparisons(days, results, opts = {}) {
  return COMPARISONS.map((c) => groupCompare(days, results, c, opts));
}

const RADAR_SHORT = { none: 'なし', mild: '軽い兆候', strong: '強い兆候' };

/** その日の体調変化の検出の状態を、短い言葉にする。記録が無い日は null */
function radarState(r) {
  if (!r) return null;
  if (r.radar.status === 'learning') return { key: 'learning', label: '学習中', detected: null };
  if (r.radar.status === 'unjudgeable') return { key: 'unjudgeable', label: '判定不可', detected: null };
  return { key: r.radar.level, label: RADAR_SHORT[r.radar.level], detected: r.radar.level !== 'none', reference: r.radar.status === 'reference' };
}

/**
 * 風邪っぽい症状の前後（設計書 5.4）。1回目から「1回の記録」として前後の動きを返す。
 *
 * - 症状（「少し」か「あり」）の日が gapDays 以内に続いていれば、同じ1回として数える（一連の風邪を1回にする）。
 * - 始まった日を 0 として、before 日前から after 日後までの値を並べる。
 * - 回数が refAt（3回）以上で中央値を参考として、fullAt（5回）以上で通常の集計として返す。
 *
 * @returns {{count, level:'none'|'record'|'ref'|'ok', offsets:number[], outcomes:string[], episodes:object[], aggregate:object[]|null}}
 */
export function coldEpisodes(days, results, { upTo = null, cfg = CONFIG, outcomes = ['hrv', 'hr', 'temp', 'resp', 'spo2', 'score'] } = {}) {
  const ec = cfg.insights.episode;
  const symptomOf = (date) => { const d = days.get(date); const v = d && sub(d).cold; return v === 'slight' || v === 'yes' ? v : null; };
  const offsets = [];
  for (let k = -ec.before; k <= ec.after; k++) offsets.push(k);

  const found = [];
  let cur = null;
  for (const date of results.keys()) {
    if (upTo && date > upTo) continue;
    const v = symptomOf(date);
    if (!v) continue;
    if (cur && diffDays(date, cur.last) <= ec.gapDays) {
      cur.last = date; cur.symptomDays += 1; if (v === 'yes') cur.max = 'yes';
    } else {
      cur = { onset: date, last: date, symptomDays: 1, max: v, symptoms: new Set() };
      found.push(cur);
    }
    for (const s of sub(days.get(date)).coldSymptoms || []) cur.symptoms.add(s);
  }

  const rowAt = (onset, k) => {
    const date = addDays(onset, k);
    const r = !upTo || date <= upTo ? results.get(date) : null;
    const d = days.get(date);
    const values = {};
    for (const key of outcomes) values[key] = r && d ? OUTCOMES[key].get(r, d, days) : null;
    return { offset: k, date, hasRecord: !!r, values, radar: radarState(r), symptom: r ? symptomOf(date) : null };
  };
  const episodes = found.map((e) => ({
    onset: e.onset, last: e.last, symptomDays: e.symptomDays, spanDays: diffDays(e.last, e.onset) + 1, max: e.max,
    symptoms: [...e.symptoms], rows: offsets.map((k) => rowAt(e.onset, k)),
  }));

  const count = episodes.length;
  const level = count >= ec.fullAt ? 'ok' : count >= ec.refAt ? 'ref' : count > 0 ? 'record' : 'none';
  let aggregate = null;
  if (count >= ec.refAt) {
    aggregate = offsets.map((k, i) => {
      const rows = episodes.map((e) => e.rows[i]);
      const values = {};
      for (const key of outcomes) {
        const vals = rows.map((x) => x.values[key]).filter((v) => v != null);
        values[key] = { n: vals.length, value: vals.length ? median(vals) : null };
      }
      const judged = rows.filter((x) => x.radar && x.radar.detected != null);
      return { offset: k, values, detected: { n: judged.length, count: judged.filter((x) => x.radar.detected).length } };
    });
  }
  return { count, level, offsets, outcomes, episodes: episodes.reverse(), aggregate };
}
