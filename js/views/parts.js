// 複数の画面で使う小さな部品

import { h, icon, addDays, shortDate } from '../ui.js';
import { dataTable } from '../charts.js';

export function card(title, sub, ...kids) {
  return h('section', { class: 'card' }, title ? h('h2', null, title) : null, sub ? h('p', { class: 'sub' }, sub) : null, ...kids);
}

export function banner(tone, text, action) {
  const cls = tone === 'error' ? 'banner error' : tone === 'warn' ? 'banner warn' : tone === 'demo' ? 'banner demo' : 'banner';
  return h('div', { class: cls, role: tone === 'error' ? 'alert' : 'status' },
    icon(tone === 'info' || tone === 'demo' ? 'info' : 'warn', 'ico'),
    h('div', { class: 'grow' }, text),
    action ? h('button', { type: 'button', onclick: action.onClick }, action.label) : null);
}

/** 状態を表す小さな札。色だけに頼らず、必ず文字を添える */
export function chip(text, tone) {
  return h('span', { class: `chip ${tone || ''}` }, h('i', { class: 'dot' }), text);
}

/** 選択肢を横に並べた切り替え。選択中のものをもう一度押すと取り消せる */
export function segmented(label, options, current, onPick) {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label },
    options.map(([value, text]) => h('button', { type: 'button', 'aria-pressed': String(current === value), onclick: () => onPick(value) }, text)));
  el.style.setProperty('--n', String(options.length));
  return el;
}

/**
 * 折りたためる部分。開いた時に初めて中身を描く（閉じている間は幅が測れないため）。
 * 戻り値の fillIfOpen は、初めから開いているものを、画面に置いた後で描くために呼ぶ。
 */
export function fold(title, renderBody, { open = false, note = null } = {}) {
  const body = h('div', { class: 'foldbody' });
  let done = false;
  const fill = () => { if (done) return; done = true; renderBody(body); };
  const el = h('details', { class: 'fold', open: open || null },
    h('summary', null, h('span', { class: 'foldtitle' }, title), note ? h('span', { class: 'foldnote' }, note) : null, icon('right', 'chev')),
    body);
  el.addEventListener('toggle', () => { if (el.open) fill(); });
  return { el, fillIfOpen: () => { if (el.open) fill(); } };
}

export function placeholderCard(title, text) {
  return h('section', { class: 'card' }, h('div', { class: 'empty' }, h('strong', null, title), text));
}

/**
 * グラフ用カード。「表で見る」で同じ内容の表に切り替えられる。
 * tableSpec は () => ({columns, rows}) | null
 */
export function chartCard({ title, sub, tableSpec }, ...kids) {
  const body = h('div', null, ...kids);
  let tableEl = null;
  const btn = tableSpec ? h('button', { class: 'linkbtn', type: 'button', 'aria-expanded': 'false' }, '表で見る') : null;
  if (btn) {
    btn.addEventListener('click', () => {
      if (tableEl) { tableEl.remove(); tableEl = null; btn.textContent = '表で見る'; btn.setAttribute('aria-expanded', 'false'); return; }
      const spec = tableSpec();
      if (!spec || !spec.rows.length) return;
      tableEl = dataTable(spec);
      body.after(tableEl);
      btn.textContent = '表を閉じる';
      btn.setAttribute('aria-expanded', 'true');
    });
  }
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, title), sub ? h('p', { class: 'sub' }, sub) : null),
      btn),
    body);
}

/** 数値を大きく見せる小さな枠（2列で並べる） */
export function statTile(label, valueNode, note) {
  return h('div', { class: 'tile' }, h('div', { class: 'lbl' }, label), h('div', { class: 'val' }, valueNode), note ? h('div', { class: 'dl' }, note) : null);
}

/** 見出しつきの小さなグラフ枠。戻り値の box にグラフを描く。head は右上の値の表示 */
export function miniChart(label, headText) {
  const head = h('b', null, headText || '');
  const box = h('div');
  return { el: h('div', { class: 'minichart' }, h('div', { class: 'mc-head' }, h('span', null, label), head), box), box, head };
}

/** 直近 n 日の日付配列（選択日が右端） */
export function lastDates(date, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(date, -i));
  return out;
}

/** 日付を横軸にした折れ線用の目盛（位置は配列の添字）。右端から等間隔に最大 count 個 */
export function indexTicks(dates, count = 4) {
  const every = Math.max(1, Math.ceil(dates.length / count));
  const ticks = [];
  for (let i = dates.length - 1; i >= 0; i -= every) ticks.unshift({ v: i, label: shortDate(dates[i]) });
  return ticks;
}

/** 棒グラフの横軸ラベル。間隔を空けて日付を出す */
export function dateTicks(dates, every) {
  return dates.map((d, i) => ((dates.length - 1 - i) % every === 0 ? shortDate(d) : null));
}

/** 時刻軸の目盛（現地時刻の正時）。区間が長ければ間引く */
export function hourTicks(startMs, endMs, offsetMin) {
  const hours = (endMs - startMs) / 3600000;
  const step = hours > 16 ? 6 : hours > 9 ? 3 : hours > 5 ? 2 : 1;
  const shift = offsetMin * 60000;
  const ticks = [];
  for (let t = Math.ceil((startMs + shift) / 3600000) * 3600000; t <= endMs + shift; t += 3600000) {
    const hour = new Date(t).getUTCHours();
    if (hour % step === 0) ticks.push({ v: t - shift, label: `${hour}時` });
  }
  return ticks;
}

/** 非同期に読み込む領域。読み込み中・失敗・成功を同じ枠の中で切り替える */
export function asyncBox(promise, render, { loadingText = '読み込み中…' } = {}) {
  const box = h('div', null, h('div', { class: 'empty' }, loadingText));
  promise.then((value) => {
    if (!box.isConnected) return;
    box.replaceChildren();
    render(box, value);
  }).catch((err) => {
    if (!box.isConnected) return;
    box.replaceChildren(h('div', { class: 'empty' }, h('strong', null, '読み込めませんでした'), (err && err.message) || '時間を置いてもう一度お試しください'));
  });
  return box;
}
