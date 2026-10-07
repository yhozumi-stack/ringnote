// DOM・SVG の生成ヘルパー、日付と数値の整形、アイコン。
// 外部から来た文字列は必ず textContent 経由で入れる（innerHTML は使わない）。

const SVG_NS = 'http://www.w3.org/2000/svg';

function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
  }
}

function applyAttrs(el, attrs) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

/** HTML 要素を作る。h('div', {class:'x'}, '文字', 子要素...) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  appendKids(el, kids);
  return el;
}

/** SVG 要素を作る。 */
export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  appendKids(el, kids);
  return el;
}

// ---------------------------------------------------------------- 日付
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function pad(n) { return String(n).padStart(2, '0'); }

/** 端末の現地時間での今日 'YYYY-MM-DD' */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

export function weekdayOf(dateStr) { return WEEK[toUTC(dateStr).getUTCDay()]; }

export function dateLabel(dateStr) {
  const d = toUTC(dateStr);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEK[d.getUTCDay()]})`;
}

export function shortDate(dateStr) {
  const d = toUTC(dateStr);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** 日付の範囲を配列で返す（両端含む） */
export function dateRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** エポックミリ秒を、指定の UTC オフセット（分）での時計表示 'H:MM' にする */
export function clock(ms, offsetMin) {
  if (ms == null) return '—';
  const d = new Date(ms + offsetMin * 60000);
  return `${d.getUTCHours()}:${pad(d.getUTCMinutes())}`;
}

/** 'YYYY-MM-DD' の 0:00（指定オフセットでの現地時刻）をエポックミリ秒にする */
export function localMidnightMs(dateStr, offsetMin) {
  return toUTC(dateStr).getTime() - offsetMin * 60000;
}

/** API に渡す ISO 文字列（オフセット付き） */
export function isoWithOffset(ms, offsetMin) {
  const d = new Date(ms + offsetMin * 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const a = Math.abs(offsetMin);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

// ---------------------------------------------------------------- 数値
export function fmtInt(v) { return v == null ? '—' : Math.round(v).toLocaleString('ja-JP'); }

export function fmtNum(v, digits = 1) {
  return v == null ? '—' : v.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 分 → '7時間12分' / '48分' */
export function fmtMinutes(min) {
  if (min == null) return '—';
  const m = Math.round(min);
  const hh = Math.floor(Math.abs(m) / 60);
  const mm = Math.abs(m) % 60;
  const sign = m < 0 ? '−' : '';
  if (hh === 0) return `${sign}${mm}分`;
  return `${sign}${hh}時間${pad(mm)}分`;
}

/** 分 → '7:12'（軸目盛など狭い場所用） */
export function fmtHM(min) {
  if (min == null) return '—';
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

/** 符号付きの差分 '+3' '−0.4' */
export function fmtSigned(v, digits = 0) {
  if (v == null) return '';
  const r = Number(v.toFixed(digits));
  if (r === 0) return '±0';
  const body = Math.abs(r).toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (r > 0 ? '+' : '−') + body;
}

// ---------------------------------------------------------------- アイコン
const ICONS = {
  home: ['M4 11.5 12 5l8 6.5', 'M6.5 10v9h11v-9'],
  moon: ['M19.5 14.2A7.6 7.6 0 0 1 9.8 4.5a7.6 7.6 0 1 0 9.7 9.7Z'],
  heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z'],
  steps: ['M4 17h3l2.5-9 4 13 2.5-7H20'],
  trend: ['M4 19V5', 'M4 19h16', 'M7.5 15l3.5-4 3 2.5 4.5-6'],
  gear: ['M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
    'M19 12a7 7 0 0 0-.1-1.3l1.9-1.4-1.9-3.2-2.2.9a7 7 0 0 0-2.2-1.3L14.2 3h-4.4l-.3 2.7a7 7 0 0 0-2.2 1.3l-2.2-.9-1.9 3.2 1.9 1.4a7 7 0 0 0 0 2.6l-1.9 1.4 1.9 3.2 2.2-.9a7 7 0 0 0 2.2 1.3l.3 2.7h4.4l.3-2.7a7 7 0 0 0 2.2-1.3l2.2.9 1.9-3.2-1.9-1.4c.1-.4.1-.9.1-1.3Z'],
  left: ['M14.5 6l-6 6 6 6'],
  right: ['M9.5 6l6 6-6 6'],
  refresh: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4.5v4h-4'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5.5', 'M12 7.6v.2'],
  warn: ['M12 4 21 19.5H3L12 4Z', 'M12 10v4.5', 'M12 17v.2'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  up: ['M12 19V6', 'M6.5 11.5 12 6l5.5 5.5'],
  down: ['M12 5v13', 'M6.5 12.5 12 18l5.5-5.5'],
  dot: ['M12 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z'],
  share: ['M12 15V4', 'M8 7.5 12 4l4 3.5', 'M6 12v7h12v-7'],
  back: ['M14.5 6l-6 6 6 6'],
};

export function icon(name, cls) {
  const el = s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: cls || null });
  for (const d of ICONS[name] || ICONS.dot) el.appendChild(s('path', { d }));
  return el;
}

/** 値と単位を並べた要素（単位は小さく） */
export function valueWithUnit(text, unit) {
  const frag = document.createDocumentFragment();
  frag.appendChild(document.createTextNode(text));
  if (unit && text !== '—') frag.appendChild(h('span', { class: 'unit' }, unit));
  return frag;
}
