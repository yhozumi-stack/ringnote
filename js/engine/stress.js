// ストレス（日中）。設計書 3.3。
//
// 表示するのは2つ。
// - SOXAI の目安での区分（低い・標準・高い）。SOXAI アプリ内の説明にある区切りを、そのまま当てはめる（config の soxaiBands）
// - 自分の直近14日の分布での相対的な区分（高・中・低）。7日分たまってから出す
// SOXAI のストレス値は、心拍変動（RMSSD と LF/HF）から SOXAI が算出した 0〜100 の値。ここでは LF/HF を独自には使わない。
// 独自の指標（心拍の上昇と心拍変動の低下）は裏で計算して比べるだけで、採否は実データを見て決める。

import { localHour, median, robustSpread, quantileFromHistogram } from './util.js';

const BINS = 101; // ストレス値 0〜100 を整数で数える。範囲外は overRange に数えて黙って捨てない

/**
 * その日の起きている時間の5分枠を取り出し、運動中・運動直後・動いていない、を印付けする。
 * @param {object[]} epochs 正規化済みの5分データ
 * @param {object} p { dayStart, dayEnd, sleepIntervals:[{start,end}], cfg }
 */
export function awakeEpochs(epochs, { dayStart, dayEnd, sleepIntervals = [], cfg }) {
  const ex = cfg.stress.exercise;
  const out = [];
  let cooldown = 0;
  let prevT = null;
  for (const e of epochs) {
    if (e.t < dayStart || e.t >= dayEnd) continue;
    const inBed = e.stage != null || sleepIntervals.some((s) => e.t >= s.start && e.t < s.end);
    if (inBed) { cooldown = 0; prevT = e.t; continue; }
    const moving = (e.steps != null && e.steps >= ex.stepsAtLeast) || (e.mets != null && e.mets >= ex.metsAtLeast)
      || (e.type != null && ex.types.includes(e.type));
    if (!e.worn && !moving) { prevT = e.t; continue; } // 着けていない枠
    // 運動の後10分も「運動直後」として分ける。記録が途切れたら数え直す
    if (prevT != null && e.t - prevT > 600000) cooldown = 0;
    let state = 'rest';
    if (moving) { state = 'exercise'; cooldown = ex.cooldownEpochs; }
    else if (cooldown > 0) { state = 'cooldown'; cooldown -= 1; }
    // 活動の種類は実データでは入っていないので、歩数で「動いていない」を判定する。種類が入っていれば安静だけを採る
    const still = state === 'rest' && (e.steps ?? 0) <= cfg.stress.still.maxSteps && (e.type == null || e.type === cfg.stress.still.type);
    out.push({ t: e.t, stress: e.stress, hr: e.hr, hrv: e.hrv, state, still });
    prevT = e.t;
  }
  return out;
}

/**
 * 1日分の要約（端末に保存しておき、次の日以降の「自分の分布」の材料にする）。
 * 健康の生データそのものではなく、度数と中央値だけを持つ。
 */
export function stressDayStats(date, awake) {
  const hist = new Array(BINS).fill(0);
  let n = 0; let overRange = 0;
  for (const e of awake) {
    if (e.state !== 'rest' || e.stress == null) continue;
    const v = Math.round(e.stress);
    if (v < 0 || v >= BINS) { overRange += 1; continue; }
    hist[v] += 1; n += 1;
  }
  const still = awake.filter((e) => e.still);
  const hrs = still.map((e) => e.hr).filter((x) => x != null);
  const lnHrvs = still.map((e) => (e.hrv != null && e.hrv > 0 ? Math.log(e.hrv) : null)).filter((x) => x != null);
  const rest = awake.filter((e) => e.state === 'rest');
  return {
    date, hist, n, overRange,
    stillHr: hrs.length >= 6 ? { median: median(hrs), spread: robustSpread(hrs), n: hrs.length } : null,
    stillLnHrv: lnHrvs.length >= 6 ? { median: median(lnHrvs), spread: robustSpread(lnHrvs), n: lnHrvs.length } : null,
    hrvCoverage: rest.length ? rest.filter((e) => e.hrv != null).length / rest.length : null,
  };
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 12) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100 : null;
}

/**
 * その日のストレスの分析。
 * @param {object[]} awake      awakeEpochs() の戻り値（当日）
 * @param {object[]} priorStats 当日より前の stressDayStats()（直近14日分。順不同でよい）
 * @param {object} p { offset, cfg }
 */
/** SOXAI の目安での区分: 'low' 低い（0〜30）/ 'standard' 標準（31〜50未満）/ 'high' 高い（50以上）。値が無ければ null */
export function soxaiStressBand(value, cfg) {
  if (value == null || !Number.isFinite(value)) return null;
  const b = cfg.stress.soxaiBands;
  return value >= b.highMin ? 'high' : value <= b.lowMax ? 'low' : 'standard';
}

/** 起きている時間を、SOXAI の目安で分けた時間（分）。SOXAI アプリと同じく、運動中の枠も数える */
function soxaiSummary(awake, cfg) {
  const minutes = { low: 0, standard: 0, high: 0 };
  let run = 0; let longest = 0; let lastT = null;
  for (const e of awake) {
    const band = soxaiStressBand(e.stress, cfg);
    if (band) minutes[band] += 5;
    if (band === 'high') {
      run = lastT != null && e.t - lastT <= 300000 ? run + 5 : 5; // 5分枠が途切れずに続いている間だけ連続として数える
      lastT = e.t;
      longest = Math.max(longest, run);
    } else {
      run = 0;
      lastT = null;
    }
  }
  return { minutes, measuredMin: minutes.low + minutes.standard + minutes.high, longestHighMin: longest };
}

export function stressAnalysis(awake, priorStats, { offset, cfg }) {
  const sc = cfg.stress;
  const usable = (priorStats || []).filter((s) => s && s.n >= sc.minEpochsPerDay);
  const rest = awake.filter((e) => e.state === 'rest' && e.stress != null);
  const exerciseMin = awake.filter((e) => e.state === 'exercise').length * 5;
  const cooldownMin = awake.filter((e) => e.state === 'cooldown').length * 5;
  const base = { exerciseMin, cooldownMin, measuredMin: rest.length * 5, daysInBaseline: usable.length, daysNeeded: sc.minDays,
    soxai: soxaiSummary(awake, cfg) };

  let low = null; let high = null;
  if (usable.length >= sc.minDays) {
    const merged = new Array(BINS).fill(0);
    for (const s of usable) s.hist.forEach((c, i) => { merged[i] += c; });
    low = quantileFromHistogram(merged, sc.lowQuantile);
    high = quantileFromHistogram(merged, sc.highQuantile);
  }
  const zoned = low != null && high != null && high > low;
  const zoneOf = (e) => {
    if (e.state !== 'rest') return e.state;
    if (e.stress == null || !zoned) return null;
    return e.stress >= high ? 'high' : e.stress <= low ? 'low' : 'mid';
  };
  const series = awake.map((e) => ({ t: e.t, stress: e.stress, zone: zoneOf(e), soxai: soxaiStressBand(e.stress, cfg) }));
  const own = ownIndex(awake, usable, cfg);

  if (!zoned) {
    return { ...base, status: usable.length >= sc.minDays ? 'flat' : 'learning', thresholds: null, series, own,
      note: usable.length >= sc.minDays ? '直近14日のストレス値にほとんど幅が無く、高・中・低に分けられません' : null };
  }

  const minutes = { high: 0, mid: 0, low: 0 };
  let run = 0; let longest = 0; let lastHighT = null;
  for (const p of series) {
    if (p.zone === 'high' || p.zone === 'mid' || p.zone === 'low') minutes[p.zone] += 5;
    if (p.zone === 'high') {
      // 5分枠が途切れずに続いている間だけ連続として数える
      run = lastHighT != null && p.t - lastHighT <= 300000 ? run + 5 : 5;
      lastHighT = p.t;
      longest = Math.max(longest, run);
    } else {
      run = 0;
      lastHighT = null;
    }
  }
  const blocks = sc.blocks.map((b) => {
    const inBlock = (t) => { const h = localHour(t, offset); return b.from < b.to ? h >= b.from && h < b.to : h >= b.from || h < b.to; };
    const pts = series.filter((p) => inBlock(p.t) && p.stress != null && (p.zone === 'high' || p.zone === 'mid' || p.zone === 'low'));
    return { key: b.key, label: b.label, measuredMin: pts.length * 5, highMin: pts.filter((p) => p.zone === 'high').length * 5,
      average: pts.length ? Math.round(pts.reduce((a, p) => a + p.stress, 0) / pts.length) : null };
  });
  return { ...base, status: 'ok', thresholds: { low, high }, minutes, longestHighMin: longest, blocks, series, own, note: null };
}

/**
 * 独自のストレス指標（比べるためだけに計算する。画面の主表示にはまだ使わない）。
 * 起きていて動いていない枠の、心拍の上昇と心拍変動の低下を、自分の直近14日と比べる。15分の移動中央値。
 */
function ownIndex(awake, usable, cfg) {
  const oc = cfg.stress.ownIndex;
  const hrDays = usable.filter((s) => s.stillHr);
  const hvDays = usable.filter((s) => s.stillLnHrv);
  const coverage = median(usable.map((s) => s.hrvCoverage));
  if (hrDays.length < cfg.stress.minDays || hvDays.length < cfg.stress.minDays) {
    return { available: false, experimental: true, hrvCoverage: coverage, reason: '比べるための日数が足りません' };
  }
  const hrMed = median(hrDays.map((s) => s.stillHr.median));
  const hrSpread = Math.max(median(hrDays.map((s) => s.stillHr.spread)) || 0, 2);
  const hvMed = median(hvDays.map((s) => s.stillLnHrv.median));
  const hvSpread = Math.max(median(hvDays.map((s) => s.stillLnHrv.spread)) || 0, 0.08);
  const raw = awake.filter((e) => e.still && e.hr != null && e.hrv != null && e.hrv > 0)
    .map((e) => ({ t: e.t, stress: e.stress, v: 0.5 * ((e.hr - hrMed) / hrSpread) - 0.5 * ((Math.log(e.hrv) - hvMed) / hvSpread) }));
  const k = oc.rollingEpochs;
  const values = raw.map((p, i) => ({ t: p.t, v: Math.round(median(raw.slice(Math.max(0, i - k + 1), i + 1).map((q) => q.v)) * 100) / 100 }));
  const both = raw.filter((p) => p.stress != null);
  return {
    available: true, experimental: true, hrvCoverage: coverage,
    meetsAdoptionBar: coverage != null && coverage >= oc.minHrvCoverage,
    correlationWithSoxai: pearson(both.map((p) => p.v), both.map((p) => p.stress)),
    values,
  };
}
