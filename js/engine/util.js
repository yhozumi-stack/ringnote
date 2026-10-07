// 分析エンジンの共通関数（日付・統計）。画面にもブラウザにも依存しない。

// ---------------------------------------------------------------- 日付（'YYYY-MM-DD' の文字列で扱う）
function toUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(dateStr, n) {
  const d = toUTC(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a, b) {
  return Math.round((toUTC(a) - toUTC(b)) / 86400000);
}

/** 0=日 … 6=土 */
export function weekday(dateStr) {
  return toUTC(dateStr).getUTCDay();
}

/** その日付の 0:00（指定の UTC オフセット分での現地時刻）をエポックミリ秒で返す */
export function localMidnightMs(dateStr, offsetMin) {
  return toUTC(dateStr).getTime() - offsetMin * 60000;
}

/** エポックミリ秒 → 現地時刻の「時」（0〜23.99） */
export function localHour(ms, offsetMin) {
  const m = (((ms + offsetMin * 60000) % 86400000) + 86400000) % 86400000;
  return m / 3600000;
}

// ---------------------------------------------------------------- 数値
export function toNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toMs(v) {
  if (!v || typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function median(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** 中央絶対偏差から求めた「ふだんのばらつき」（正規分布なら標準偏差に相当） */
export function robustSpread(values) {
  const med = median(values);
  if (med == null) return null;
  const mad = median(values.filter((x) => x != null).map((x) => Math.abs(x - med)));
  return mad * 1.4826;
}

export function mean(values) {
  const v = values.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function stdev(values) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

/**
 * 折れ線の換算表で値を読む。points = [[x, y], ...]（x の昇順）。
 * 範囲の外は端の値に張り付く。
 */
export function interpolate(points, x) {
  if (x <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

/** 度数分布（値→個数）から分位点を求める。bins は 0..N の整数値ごとの個数 */
export function quantileFromHistogram(bins, q) {
  const total = bins.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const target = q * total;
  let acc = 0;
  for (let i = 0; i < bins.length; i++) {
    acc += bins[i];
    if (acc >= target) return i;
  }
  return bins.length - 1;
}
