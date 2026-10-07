// 平常値とズレ（設計書 1.3）。
// 平常値 = 当日を含まない直前28日のうち「平常値の材料にする夜」の中央値。
// ふだんのばらつき = 中央絶対偏差から求めた値（指標ごとの下限つき）。

import { addDays, median, robustSpread } from './util.js';

/** 指標の値を取り出す。source が 'derived:xxx' なら5分データ由来の派生値 */
export function metricValue(day, key, cfg) {
  if (!day) return null;
  const src = cfg.metrics[key].source;
  const v = src.startsWith('derived:') ? day[src.slice(8)] : day.v[src];
  return v == null ? null : v;
}

/**
 * @param {Map} days 日付 → 正規化済みの日
 * @param {(date:string)=>boolean} isEligible その日が「平常値の材料にする夜」かどうか
 */
export function baselineFor(days, date, key, cfg, isEligible) {
  const vals = [];
  for (let i = 1; i <= cfg.baseline.windowDays; i++) {
    const d = addDays(date, -i);
    if (!isEligible(d)) continue;
    const v = metricValue(days.get(d), key, cfg);
    if (v != null) vals.push(v);
  }
  if (vals.length < cfg.baseline.minValues) return { ready: false, n: vals.length };
  const med = median(vals);
  const m = cfg.metrics[key];
  const spread = Math.max(robustSpread(vals) || 0, m.floorAbs || 0, (m.floorPct || 0) * Math.abs(med));
  return { ready: true, n: vals.length, median: med, spread };
}

/** ズレ: diff=差 / pct=平常比 / z=ふだんのばらつきを1とした大きさ */
export function deviation(value, base) {
  if (value == null || !base || !base.ready) return null;
  const diff = value - base.median;
  return { diff, pct: base.median !== 0 ? diff / base.median : null, z: diff / base.spread };
}

/** 直近の傾向: 直前7日の中央値を平常値と比べる */
export function trendFor(days, date, key, cfg, isEligible, base) {
  if (!base || !base.ready) return null;
  const vals = [];
  for (let i = 1; i <= cfg.baseline.trendDays; i++) {
    const d = addDays(date, -i);
    if (!isEligible(d)) continue;
    const v = metricValue(days.get(d), key, cfg);
    if (v != null) vals.push(v);
  }
  if (vals.length < cfg.baseline.trendMinValues) return null;
  const med = median(vals);
  return { median: med, diff: med - base.median, z: (med - base.median) / base.spread, n: vals.length };
}

/** 任意の値の並びから平常値を作る（身体負荷など、夜に紐づかない値用） */
export function baselineFromValues(values, { minValues, floorAbs = 0, floorPct = 0 }) {
  const vals = values.filter((v) => v != null);
  if (vals.length < minValues) return { ready: false, n: vals.length };
  const med = median(vals);
  return { ready: true, n: vals.length, median: med, spread: Math.max(robustSpread(vals) || 0, floorAbs, floorPct * Math.abs(med)) };
}
