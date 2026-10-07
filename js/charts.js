// SVG グラフ部品（外部ライブラリなし）。
// 規則: 線は2px・棒は最大24pxで先端だけ4pxの丸み・目盛線は実線の細線・
//       隣り合う塗りの間は2pxの隙間・文字は系列色にしない・軸は1本だけ。
// 色は CSS のクラスで付ける（ライト/ダークの切り替えを1か所に集めるため）。

import { h, s } from './ui.js';

// ------------------------------------------------------------ 共通
function widthOf(container) {
  return Math.max(220, Math.floor(container.clientWidth || 320));
}

/** きりの良い目盛（3〜5本） */
export function niceTicks(min, max, target = 4) {
  if (!(max > min)) return [min];
  const raw = (max - min) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * pow).find((st) => (max - min) / st <= target + 0.5) || 10 * pow;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

let activeHide = null;
document.addEventListener('pointerdown', (ev) => {
  if (activeHide && !(ev.target instanceof Element && ev.target.closest('.hit'))) activeHide();
}, { passive: true });

/** ポインター・タッチ・キーボードで「何番目の点か」を拾う共通処理 */
function attachHover(overlay, { count, indexFromFrac, onShow, onHide }) {
  let cur = null;
  const hide = () => { if (cur == null) return; cur = null; onHide(); if (activeHide === hide) activeHide = null; };
  const show = (i) => {
    if (i == null || Number.isNaN(i)) return;
    const idx = Math.max(0, Math.min(count - 1, i));
    if (activeHide && activeHide !== hide) activeHide();
    activeHide = hide;
    cur = idx;
    onShow(idx);
  };
  const fromEvent = (ev) => {
    const r = overlay.getBoundingClientRect();
    return indexFromFrac(r.width ? (ev.clientX - r.left) / r.width : 0);
  };
  overlay.addEventListener('pointerdown', (ev) => show(fromEvent(ev)));
  overlay.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'mouse' || ev.buttons > 0 || ev.pressure > 0) show(fromEvent(ev));
  });
  overlay.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') hide(); });
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight') { ev.preventDefault(); show(cur == null ? 0 : cur + 1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); show(cur == null ? count - 1 : cur - 1); }
    else if (ev.key === 'Escape') hide();
  });
  overlay.addEventListener('focus', () => { if (cur == null && overlay.matches(':focus-visible')) show(count - 1); });
  overlay.addEventListener('blur', hide);
  return { show, hide };
}

function makeTooltip(container) {
  const tip = h('div', { class: 'tooltip', hidden: true });
  container.appendChild(tip);
  return {
    /** @param {number} xPx コンテナ左端からの位置 @param {{value:string,name:string,keyClass?:string,box?:boolean}[]} rows */
    show(xPx, title, rows) {
      tip.replaceChildren(
        h('div', { class: 'tt-title' }, title),
        ...rows.map((r) => h('div', { class: 'tt-row' },
          r.keyClass ? h('i', { class: `key ${r.box ? 'box ' : ''}${r.keyClass}` }) : null,
          h('b', null, r.value), h('span', null, r.name))),
      );
      tip.hidden = false;
      const w = tip.offsetWidth;
      const cw = container.clientWidth;
      const left = Math.max(0, Math.min(cw - w, xPx - w / 2));
      tip.style.left = `${left}px`;
      tip.style.top = `${-tip.offsetHeight - 2}px`;
    },
    hide() { tip.hidden = true; },
  };
}

function emptyNote(container, text) {
  container.replaceChildren(h('div', { class: 'empty' }, text || 'この期間のデータはありません'));
}

function yAxis(svg, { ticks, Y, x0, x1, format }) {
  for (const t of ticks) {
    svg.appendChild(s('line', { class: 'gridline', x1: x0, x2: x1, y1: Y(t), y2: Y(t) }));
    svg.appendChild(s('text', { class: 'ticklabel', x: x0 - 6, y: Y(t) + 3.5, 'text-anchor': 'end' }, format(t)));
  }
}

function xLabels(svg, { ticks, X, y, x0, x1 }) {
  for (const t of ticks) {
    const x = X(t.v);
    const anchor = x < x0 + 14 ? 'start' : x > x1 - 14 ? 'end' : 'middle';
    svg.appendChild(s('text', { class: 'ticklabel', x, y, 'text-anchor': anchor }, t.label));
  }
}

function pathFrom(points, X, Y) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (p.y == null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`;
    pen = true;
  }
  return d;
}

// ------------------------------------------------------------ リング（スコアのメーター）
export function ring(container, { value, title, size = 68, stroke = 7, hideNumber = false }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = value == null ? 0 : Math.max(0, Math.min(1, value / 100));
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img',
    'aria-label': `${title} ${value == null ? 'データなし' : Math.round(value)}` });
  svg.appendChild(s('circle', { class: 'ring-track', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke }));
  if (frac > 0) {
    svg.appendChild(s('circle', { class: 'ring-value', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke,
      'stroke-linecap': 'round', 'stroke-dasharray': `${(c * frac).toFixed(2)} ${c.toFixed(2)}`,
      transform: `rotate(-90 ${size / 2} ${size / 2})` }));
  }
  if (!hideNumber) {
    svg.appendChild(s('text', { class: `ring-num${value == null ? ' none' : ''}`, x: size / 2, y: size / 2 + size * 0.11,
      'text-anchor': 'middle', 'font-size': Math.round(size * 0.32) }, value == null ? '—' : String(Math.round(value))));
  }
  container.replaceChildren(svg);
}

// ------------------------------------------------------------ スパークライン（指標タイルの小さな推移）
export function sparkline(container, values, { width = 72, height = 26 } = {}) {
  const vals = values.filter((v) => v != null);
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  if (vals.length >= 2) {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const X = (i) => 4 + (i / (values.length - 1)) * (width - 8);
    const Y = (v) => 4 + (1 - (v - min) / span) * (height - 8);
    svg.appendChild(s('path', { class: 'series-deemph', fill: 'none', 'stroke-width': 1.5, 'stroke-linecap': 'round',
      'stroke-linejoin': 'round', d: pathFrom(values.map((v, i) => ({ x: i, y: v })), X, Y) }));
    let last = values.length - 1;
    while (last >= 0 && values[last] == null) last -= 1;
    svg.appendChild(s('circle', { class: 'fill-accent stroke-surface', cx: X(last), cy: Y(values[last]), r: 3.2, 'stroke-width': 2 }));
  }
  container.replaceChildren(svg);
}

// ------------------------------------------------------------ 折れ線
/**
 * cfg = {
 *   height, ariaLabel,
 *   x: { min, max, ticks:[{v,label}], format:(v)=>string },
 *   y: { min?, max?, format:(v)=>string, floor0?:boolean },
 *   series: [{ name, tone:'accent'|'deemph', kind:'line'|'dots', area?:boolean, points:[{x,y}] }],
 *   band?: { lo, hi },            // 平常の範囲などの薄い帯
 *   endLabel?: boolean,           // 強調系列の最後の値を直接ラベルにする
 *   tooltip?: boolean,            // false で内蔵の吹き出しを出さない（複数グラフ連動時）
 *   onHover?: (xValue|null, valuesBySeries|null) => void,
 * }
 * 戻り値: { showAt(xValue), clear() } 他のグラフと十字線を連動させるための操作
 */
export function lineChart(container, cfg) {
  container.classList.add('chart');
  const all = [];
  for (const sr of cfg.series) for (const p of sr.points) if (p.y != null) all.push(p.y);
  if (!all.length) { emptyNote(container, cfg.emptyText); return { showAt() {}, clear() {} }; }
  container.replaceChildren();

  const W = widthOf(container);
  const H = cfg.height || 150;
  const m = { l: 36, r: cfg.endLabel ? 40 : 12, t: 10, b: 20 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  let lo = Math.min(...all, ...(cfg.band ? [cfg.band.lo] : []));
  let hi = Math.max(...all, ...(cfg.band ? [cfg.band.hi] : []));
  if (lo === hi) { lo -= 1; hi += 1; }
  const padv = (hi - lo) * 0.12;
  let ymin = cfg.y.min != null ? cfg.y.min : lo - padv;
  let ymax = cfg.y.max != null ? cfg.y.max : hi + padv;
  if (cfg.y.floor0) ymin = Math.max(0, ymin);
  const ticks = niceTicks(ymin, ymax, 3);

  const X = (v) => m.l + ((v - cfg.x.min) / (cfg.x.max - cfg.x.min || 1)) * iw;
  const Y = (v) => m.t + (1 - (v - ymin) / (ymax - ymin)) * ih;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': cfg.ariaLabel || '折れ線グラフ' });
  yAxis(svg, { ticks, Y, x0: m.l, x1: m.l + iw, format: cfg.y.format });
  xLabels(svg, { ticks: cfg.x.ticks, X, y: H - 5, x0: m.l, x1: m.l + iw });
  svg.appendChild(s('line', { class: 'axisline', x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }));

  if (cfg.band) {
    const y1 = Y(Math.min(cfg.band.hi, ymax));
    const y2 = Y(Math.max(cfg.band.lo, ymin));
    svg.appendChild(s('rect', { class: 'fill-band', x: m.l, width: iw, y: y1, height: Math.max(0, y2 - y1), rx: 2 }));
  }

  // 強調しない系列を先に、強調系列を上に描く
  const ordered = [...cfg.series].sort((a, b) => (a.tone === 'accent') - (b.tone === 'accent'));
  for (const sr of ordered) {
    const cls = sr.tone === 'accent' ? 'accent' : 'deemph';
    if (sr.kind === 'dots') {
      for (const p of sr.points) {
        if (p.y != null) svg.appendChild(s('circle', { class: `fill-${cls}`, cx: X(p.x), cy: Y(p.y), r: 2.2 }));
      }
      continue;
    }
    if (sr.area) {
      const pts = sr.points.filter((p) => p.y != null);
      if (pts.length > 1) {
        const d = `${pathFrom(pts, X, Y)}L${X(pts[pts.length - 1].x).toFixed(1)} ${m.t + ih}L${X(pts[0].x).toFixed(1)} ${m.t + ih}Z`;
        svg.appendChild(s('path', { class: 'fill-accent-wash', d }));
      }
    }
    svg.appendChild(s('path', { class: `series-${cls}`, fill: 'none', 'stroke-width': sr.tone === 'accent' ? 2 : 1.5,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', d: pathFrom(sr.points, X, Y) }));
    // 前後が欠損で線にならない孤立点は点で描く（1点だけの日が消えないように）
    sr.points.forEach((p, i) => {
      if (p.y == null) return;
      const prev = sr.points[i - 1];
      const next = sr.points[i + 1];
      if ((!prev || prev.y == null) && (!next || next.y == null)) {
        svg.appendChild(s('circle', { class: `fill-${cls}`, cx: X(p.x), cy: Y(p.y), r: 2 }));
      }
    });
  }

  const lead = cfg.series.find((sr) => sr.tone === 'accent') || cfg.series[0];
  const leadPts = lead.points.filter((p) => p.y != null);
  if (leadPts.length) {
    const p = leadPts[leadPts.length - 1];
    svg.appendChild(s('circle', { class: 'fill-accent stroke-surface', cx: X(p.x), cy: Y(p.y), r: 4, 'stroke-width': 2 }));
    if (cfg.endLabel) {
      svg.appendChild(s('text', { class: 'endlabel', x: X(p.x) + 8, y: Y(p.y) + 4 }, cfg.y.format(p.y)));
    }
  }

  // ---- 十字線と値の読み取り ----
  const xsSet = new Set();
  for (const sr of cfg.series) for (const p of sr.points) if (p.y != null) xsSet.add(p.x);
  const xs = [...xsSet].sort((a, b) => a - b);
  const lookup = cfg.series.map((sr) => new Map(sr.points.filter((p) => p.y != null).map((p) => [p.x, p.y])));

  const cross = s('line', { class: 'crosshair', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
  svg.appendChild(cross);
  const dots = cfg.series.map((sr) => {
    const c = s('circle', { class: `fill-${sr.tone === 'accent' ? 'accent' : 'deemph'} stroke-surface`, r: 4, 'stroke-width': 2, visibility: 'hidden' });
    svg.appendChild(c);
    return c;
  });
  const overlay = s('rect', { class: 'hit', x: m.l, y: 0, width: iw, height: H, fill: 'transparent', tabindex: 0,
    'aria-label': `${cfg.ariaLabel || 'グラフ'}。左右キーで値を読めます` });
  svg.appendChild(overlay);
  container.appendChild(svg);
  const tip = cfg.tooltip === false ? null : makeTooltip(container);

  const nearest = (xv) => {
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - xv) < Math.abs(xs[best] - xv)) best = i;
    return best;
  };
  const draw = (i, silent) => {
    const xv = xs[i];
    const px = X(xv);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    const values = cfg.series.map((sr, k) => (lookup[k].has(xv) ? lookup[k].get(xv) : null));
    values.forEach((v, k) => {
      if (v == null) { dots[k].setAttribute('visibility', 'hidden'); return; }
      dots[k].setAttribute('cx', px); dots[k].setAttribute('cy', Y(v)); dots[k].setAttribute('visibility', 'visible');
    });
    if (tip && !silent) {
      const rows = cfg.series.map((sr, k) => (values[k] == null ? null : { value: cfg.y.format(values[k]), name: sr.name,
        keyClass: sr.tone === 'accent' ? 'bg-accent' : 'bg-deemph' })).filter(Boolean);
      tip.show((px / W) * container.clientWidth, cfg.x.format(xv), rows);
    }
    return values;
  };
  const erase = () => {
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((c) => c.setAttribute('visibility', 'hidden'));
    if (tip) tip.hide();
  };
  attachHover(overlay, {
    count: xs.length,
    indexFromFrac: (f) => nearest(cfg.x.min + f * (cfg.x.max - cfg.x.min)),
    onShow: (i) => { const values = draw(i, false); if (cfg.onHover) cfg.onHover(xs[i], values); },
    onHide: () => { erase(); if (cfg.onHover) cfg.onHover(null, null); },
  });
  return {
    showAt(xv) { if (xs.length) return draw(nearest(xv), true); return null; },
    clear: erase,
  };
}

// ------------------------------------------------------------ 縦棒（積み上げ対応）
/**
 * cfg = {
 *   height, ariaLabel,
 *   cats: [{ title, tick }],                      // tick が null の列は目盛ラベルを出さない
 *   stacks: [{ name, cls:'accent'|'deep'|..., values:[...] }],  // 下から順に積む
 *   y: { format:(v)=>string, tick?:(v)=>string, max? },   // tick は軸の目盛だけ短く書きたい時に使う
 *   total?: { name, format } ,                    // 積み上げ時に合計を吹き出しに出す
 * }
 */
export function columnChart(container, cfg) {
  container.classList.add('chart');
  const n = cfg.cats.length;
  const totals = cfg.cats.map((_, i) => cfg.stacks.reduce((a, st) => a + (st.values[i] || 0), 0));
  const hasAny = cfg.stacks.some((st) => st.values.some((v) => v != null));
  if (!n || !hasAny) { emptyNote(container, cfg.emptyText); return; }
  container.replaceChildren();

  const W = widthOf(container);
  const H = cfg.height || 150;
  const m = { l: 36, r: 8, t: 10, b: 20 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const ymax0 = cfg.y.max != null ? cfg.y.max : Math.max(...totals, 1);
  const ticks = niceTicks(0, ymax0 * 1.05, 3);
  const ymax = Math.max(ymax0 * 1.05, ticks[ticks.length - 1]);
  const band = iw / n;
  const bw = Math.min(24, Math.max(1.5, band - 2)); // 棒は最大24px。隣との間に必ず隙間を残す
  const Y = (v) => m.t + (1 - v / ymax) * ih;
  const cx = (i) => m.l + band * (i + 0.5);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': cfg.ariaLabel || '棒グラフ' });
  yAxis(svg, { ticks, Y, x0: m.l, x1: m.l + iw, format: cfg.y.tick || cfg.y.format });
  cfg.cats.forEach((c, i) => {
    if (c.tick == null) return;
    svg.appendChild(s('text', { class: 'ticklabel', x: cx(i), y: H - 5, 'text-anchor': 'middle' }, c.tick));
  });

  const groups = cfg.cats.map((_, i) => {
    const g = s('g');
    let base = 0;
    const live = cfg.stacks.map((st) => st.values[i]).map((v) => (v != null && v > 0 ? v : 0));
    const topIndex = live.reduce((acc, v, k) => (v > 0 ? k : acc), -1);
    live.forEach((v, k) => {
      if (v <= 0) return;
      const y1 = Y(base + v);
      let y2 = Y(base);
      base += v;
      const gap = k > 0 && y2 - y1 > 3 ? 2 : 0; // 積み上げの境目は2pxの隙間で分ける（枠線は引かない）
      y2 -= gap;
      const hgt = Math.max(1, y2 - y1);
      const x = cx(i) - bw / 2;
      const cls = `fill-${cfg.stacks[k].cls}`;
      if (k === topIndex) {
        const r = Math.min(4, bw / 2, hgt);
        g.appendChild(s('path', { class: cls, d: `M${x} ${y1 + hgt}V${y1 + r}Q${x} ${y1} ${x + r} ${y1}H${x + bw - r}Q${x + bw} ${y1} ${x + bw} ${y1 + r}V${y1 + hgt}Z` }));
      } else {
        g.appendChild(s('rect', { class: cls, x, y: y1, width: bw, height: hgt }));
      }
    });
    svg.appendChild(g);
    return g;
  });
  svg.appendChild(s('line', { class: 'axisline', x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }));

  const overlay = s('rect', { class: 'hit', x: m.l, y: 0, width: iw, height: H, fill: 'transparent', tabindex: 0,
    'aria-label': `${cfg.ariaLabel || 'グラフ'}。左右キーで値を読めます` });
  svg.appendChild(overlay);
  container.appendChild(svg);
  const tip = makeTooltip(container);
  let lit = null;
  attachHover(overlay, {
    count: n,
    indexFromFrac: (f) => Math.floor(f * n),
    onShow: (i) => {
      if (lit) lit.classList.remove('bar-hover');
      lit = groups[i];
      lit.classList.add('bar-hover');
      const rows = cfg.stacks.map((st) => (st.values[i] == null ? null : { value: cfg.y.format(st.values[i]), name: st.name,
        keyClass: `bg-${st.cls}`, box: true })).filter(Boolean).reverse();
      if (cfg.total && cfg.stacks.length > 1 && totals[i] > 0) rows.unshift({ value: cfg.total.format(totals[i]), name: cfg.total.name });
      if (!rows.length) rows.push({ value: '—', name: 'データなし' });
      tip.show((cx(i) / W) * container.clientWidth, cfg.cats[i].title, rows);
    },
    onHide: () => { if (lit) lit.classList.remove('bar-hover'); lit = null; tip.hide(); },
  });
}

// ------------------------------------------------------------ 睡眠ステージの推移（ヒプノグラム）
/**
 * cfg = { segments:[{start, end, key, label}], start, end, xTicks:[{v,label}], xFormat, tooltip?, onHover? }
 * key は 'awake' | 'rem' | 'light' | 'deep' | 'other'。segments は時刻順で、1分刻みでも5分刻みでもよい
 */
export function hypnogram(container, cfg) {
  container.classList.add('chart');
  if (!cfg.segments.length) { emptyNote(container, '睡眠ステージのデータはありません'); return { showAt() {}, clear() {} }; }
  container.replaceChildren();
  const order = ['awake', 'rem', 'light', 'deep', 'other'].filter((k) => k !== 'other' || cfg.segments.some((e) => e.key === 'other'));
  const names = { awake: '覚醒', rem: 'レム', light: '浅い', deep: '深い', other: 'その他' };

  const W = widthOf(container);
  const rowH = 20;
  const m = { l: 36, r: 12, t: 6, b: 20 };
  const ih = rowH * order.length;
  const H = m.t + ih + m.b;
  const iw = W - m.l - m.r;
  const X = (t) => m.l + ((t - cfg.start) / (cfg.end - cfg.start || 1)) * iw;
  const rowY = (k) => m.t + order.indexOf(k) * rowH;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '睡眠ステージの推移' });
  order.forEach((k) => {
    svg.appendChild(s('line', { class: 'gridline', x1: m.l, x2: m.l + iw, y1: rowY(k) + rowH / 2, y2: rowY(k) + rowH / 2 }));
    svg.appendChild(s('text', { class: 'ticklabel', x: m.l - 6, y: rowY(k) + rowH / 2 + 3.5, 'text-anchor': 'end' }, names[k]));
  });
  xLabels(svg, { ticks: cfg.xTicks, X, y: H - 5, x0: m.l, x1: m.l + iw });

  // 同じステージが続く区間をまとめて1本の帯にする
  const runs = [];
  for (const e of cfg.segments) {
    const last = runs[runs.length - 1];
    if (last && last.key === e.key && e.start - last.end <= 1000) last.end = e.end;
    else runs.push({ key: e.key, label: e.label, start: e.start, end: e.end });
  }
  const bandH = 12;
  runs.forEach((r, i) => {
    const x1 = Math.max(m.l, X(r.start));
    const x2 = Math.min(m.l + iw, X(r.end));
    const prev = runs[i - 1];
    if (prev && Math.abs(prev.end - r.start) <= 1000 && prev.key !== r.key) {
      const ya = rowY(prev.key) + rowH / 2;
      const yb = rowY(r.key) + rowH / 2;
      svg.appendChild(s('line', { class: 'series-deemph', 'stroke-width': 1, x1, x2: x1, y1: Math.min(ya, yb), y2: Math.max(ya, yb) }));
    }
    svg.appendChild(s('rect', { class: `fill-${r.key}`, x: x1, y: rowY(r.key) + (rowH - bandH) / 2,
      width: Math.max(1.5, x2 - x1 - 0.5), height: bandH, rx: 2 }));
  });

  const cross = s('line', { class: 'crosshair', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
  svg.appendChild(cross);
  const overlay = s('rect', { class: 'hit', x: m.l, y: 0, width: iw, height: H, fill: 'transparent', tabindex: 0,
    'aria-label': '睡眠ステージの推移。左右キーで区間ごとの状態を読めます' });
  svg.appendChild(overlay);
  container.appendChild(svg);
  const tip = cfg.tooltip === false ? null : makeTooltip(container);

  // その時刻を含む区間（区間の外なら、いちばん近い区間）
  const runAt = (t) => {
    let best = 0; let bestGap = Infinity;
    for (let i = 0; i < runs.length; i++) {
      const gap = t < runs[i].start ? runs[i].start - t : t > runs[i].end ? t - runs[i].end : 0;
      if (gap < bestGap) { best = i; bestGap = gap; }
    }
    return best;
  };
  const draw = (i, t, silent) => {
    const r = runs[i];
    const at = Math.max(r.start, Math.min(r.end, t == null ? (r.start + r.end) / 2 : t));
    const px = X(at);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    if (tip && !silent) {
      tip.show((px / W) * container.clientWidth, `${cfg.xFormat(r.start)}〜${cfg.xFormat(r.end)}`,
        [{ value: r.label, name: `${Math.round((r.end - r.start) / 60000)}分`, keyClass: `bg-${r.key}`, box: true }]);
    }
    return r;
  };
  const erase = () => { cross.setAttribute('visibility', 'hidden'); if (tip) tip.hide(); };
  let hoverT = null;
  attachHover(overlay, {
    count: runs.length,
    indexFromFrac: (f) => { hoverT = cfg.start + f * (cfg.end - cfg.start); return runAt(hoverT); },
    onShow: (i) => { const t = hoverT; hoverT = null; const r = draw(i, t, false); if (cfg.onHover) cfg.onHover(t == null ? (r.start + r.end) / 2 : t, r); },
    onHide: () => { erase(); if (cfg.onHover) cfg.onHover(null, null); },
  });
  return { showAt(t) { return draw(runAt(t), t, true); }, clear: erase };
}

// ------------------------------------------------------------ 表で見る（グラフと同じ内容の表）
/** spec = { columns:[...], rows:[[...]] } */
export function dataTable(spec) {
  const table = h('table', { class: 'datatable' });
  table.appendChild(h('thead', null, h('tr', null, spec.columns.map((c) => h('th', { scope: 'col' }, c)))));
  const body = h('tbody');
  for (const r of spec.rows) body.appendChild(h('tr', null, r.map((c) => h('td', null, c == null ? '—' : String(c)))));
  table.appendChild(body);
  return h('div', { class: 'tablewrap' }, table);
}
