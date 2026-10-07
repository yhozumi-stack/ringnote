// Sleep: 睡眠の概要 → 睡眠ステージ → 夜間の心拍・心拍変動・皮膚温 → 睡眠時の呼吸 → 睡眠負債 → 規則性 → 過去14夜（設計書 5.1）。
// 情報が多いので、細かい部分（内訳と自分比、呼吸のこの夜の推移）は折りたたんでおく。
// 計算はしない。日次の値と分析エンジンの結果、5分ごとの記録をそのまま描く。
//
// 「睡眠時の呼吸」について: SOXAI の公式の説明では、睡眠中の血中酸素の低下イベントが1時間あたり何回あったかをもとに、
// 4段階（平常・許容範囲・乱れあり・大きな乱れ）で評価している。ただし、その4段階そのものは API では届かない。
// 届くのは sleep_ahi_class（日次）と sleep_odi（5分ごと）で、これらが4段階のどれに、どう対応するかは照合中（設計書 5.1）。
// 確認できるまでは、届いた値をそのまま載せるだけにする。段階への読み替え・回数（1時間あたり、一晩の合計、
// いちばん多かった1時間）への換算・良し悪しの判定・診断につながる言葉は書かない。

import { h, clock, fmtMinutes, fmtHM, fmtInt, fmtNum, shortDate, weekdayOf } from '../ui.js';
import { ring, lineChart, hypnogram, columnChart } from '../charts.js';
import { STAGE_NAMES, STAGE_LABELS } from '../engine/index.js';
import { card, chip, chartCard, miniChart, statTile, fold, lastDates, indexTicks, dateTicks, hourTicks, asyncBox } from './parts.js';
import { metricRow, plainRow } from './metrics.js';

const BREATH_NIGHTS = 28;
const HINT = 'グラフをなぞると、その時刻の値を表示します';
const FINEPRINT = 'このアプリは健康管理の参考用で、診断や治療を目的としたものではありません。';

function bigDuration(min) {
  const m = Math.round(min);
  return h('div', { class: 'big' }, String(Math.floor(m / 60)), h('span', { class: 'unit' }, '時間'), String(m % 60).padStart(2, '0'), h('span', { class: 'unit' }, '分'));
}

function unitValue(text, unit) {
  return text === '—' ? '—' : [text, h('span', { class: 'unit' }, unit)];
}

// ---------------------------------------------------------------- 夜間の推移（グラフをなぞると、全部のグラフの同じ時刻を示す）
function stageSegments(epochs) {
  const out = [];
  const push = (start, end, code) => {
    const key = STAGE_NAMES[code] || 'other';
    out.push({ start, end, key, label: STAGE_NAMES[code] ? STAGE_LABELS[key] : `その他（値 ${code}）` });
  };
  for (const e of epochs) {
    if (e.stage == null) continue;
    // 5分データの時刻は枠の終わり。1分ごとの記録があれば、1分ずつに分けて描く
    if (e.stage1) e.stage1.forEach((code, i) => push(e.t - 300000 + i * 60000, e.t - 300000 + (i + 1) * 60000, code));
    else push(e.t - 300000, e.t, e.stage);
  }
  return out;
}

const mean = (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);

/**
 * いくつかの小さなグラフの十字線を連動させる（カードをまたいでもよい）。
 * 各カードは addLabel() で「いま指している時刻」を出す場所を登録する。
 */
function linkGroup() {
  const parts = [];
  const labels = [];
  let offset = 540;
  const broadcast = (source, t) => {
    for (const el of labels) el.textContent = t == null ? HINT : `${clock(t, offset)} の値`;
    if (t == null) { for (const p of parts) { if (p !== source) p.api.clear(); p.reset(); } return; }
    for (const p of parts) if (p !== source) p.set(p.api.showAt(t));
  };
  return {
    parts, broadcast,
    setOffset: (o) => { offset = o; },
    addLabel: (box) => { const el = h('p', { class: 'sub', 'aria-live': 'polite' }, HINT); labels.push(el); box.appendChild(el); },
  };
}

function addLine(box, group, night, { label, unit, digits = 0, pick }) {
  const points = night.epochs.map((e) => ({ x: e.t - 150000, y: pick(e) }));
  const vals = points.map((p) => p.y).filter((v) => v != null);
  if (!vals.length) return;
  const fmt = (v) => (digits ? fmtNum(v, digits) : fmtInt(v));
  const defaultText = `平均 ${fmt(mean(vals))} ${unit}`;
  const mc = miniChart(label, defaultText);
  box.appendChild(mc.el);
  const part = { api: null,
    set: (values) => { const v = values && values[0]; mc.head.textContent = v == null ? '—' : `${fmt(v)} ${unit}`; },
    reset: () => { mc.head.textContent = defaultText; } };
  part.api = lineChart(mc.box, {
    height: 92, ariaLabel: `夜間の${label}`, tooltip: false,
    x: { min: night.start, max: night.end, ticks: hourTicks(night.start, night.end, night.offset), format: (t) => clock(t, night.offset) },
    y: { format: fmt },
    series: [{ name: label, tone: 'accent', points }],
    onHover: (t, values) => { if (t != null) part.set(values); group.broadcast(part, t); },
  });
  group.parts.push(part);
}

const noNight = (box) => box.appendChild(h('div', { class: 'empty' }, 'この夜の5分ごとの記録はまだありません'));
const hasNight = (night) => !!(night && night.epochs.length);

// ---------------------------------------------------------------- 1. 睡眠の概要
function detailRows(ctx) {
  const { day, result } = ctx;
  const pos = day.minHrPos;
  const where = pos == null ? null : pos < 1 / 3 ? '夜の前半' : pos < 2 / 3 ? '夜の中ほど' : '夜の後半';
  return h('div', { class: 'rows' },
    result.stage.key === 'normal' ? h('p', { class: 'sub' }, '自分の平常値（直前28日の中央値）との比較です。') : null,
    metricRow(ctx, 'sleep'),
    metricRow(ctx, 'eff'),
    metricRow(ctx, 'awake'),
    metricRow(ctx, 'latency', { label: '寝つくまで' }),
    plainRow('最低心拍', day.v.sleep_hr_min == null ? '—' : `${fmtInt(day.v.sleep_hr_min)} bpm`, where ? `最低になったのは${where}` : null),
    day.v.sleep_nap_time ? plainRow('昼寝', fmtMinutes(day.v.sleep_nap_time)) : null);
}

function overviewCard(ctx) {
  const { day } = ctx;
  const ringBox = h('div');
  ring(ringBox, { value: day.v.sleep_score, title: 'SOXAI の睡眠スコア', size: 76, stroke: 8 });
  const times = day.sleepStart != null ? `${clock(day.sleepStart, day.offset)} 就寝 → ${clock(day.sleepEnd, day.offset)} 起床` : '';
  const extra = [
    day.v.sleep_time_in_bed != null ? `ベッドにいた時間 ${fmtMinutes(day.v.sleep_time_in_bed)}` : null,
    day.v.sleep_efficiency != null ? `効率 ${fmtInt(day.v.sleep_efficiency)}%` : null,
  ].filter(Boolean).join(' ・ ');
  const details = fold('内訳と自分比', (box) => box.appendChild(detailRows(ctx)));
  return h('section', { class: 'card' },
    h('div', { class: 'hero' },
      h('div', { class: 'grow' },
        h('div', { class: 'cap' }, '睡眠時間'),
        bigDuration(day.v.sleep_total_sleep_time),
        h('div', { class: 'cap' }, times),
        extra ? h('div', { class: 'cap' }, extra) : null),
      h('div', { class: 'ringside' }, ringBox, h('div', { class: 'cap center' }, 'SOXAI の', h('br'), '睡眠スコア'))),
    details.el);
}

// ---------------------------------------------------------------- 2. 睡眠ステージ
function stageCard(ctx, group) {
  const { day } = ctx;
  const parts = [
    { key: 'deep', label: '深い睡眠', min: day.v.sleep_deep_sleep_time },
    { key: 'light', label: '浅い睡眠', min: day.v.sleep_light_sleep_time },
    { key: 'rem', label: 'レム睡眠', min: day.v.sleep_rem_sleep_time },
    { key: 'awake', label: '途中で起きていた', min: day.v.sleep_awake_time },
  ].filter((p) => p.min != null);
  const total = parts.reduce((a, p) => a + p.min, 0);
  const kids = [];
  if (total) {
    const bar = h('div', { class: 'stagebar', role: 'img',
      'aria-label': `睡眠ステージの内訳。${parts.map((p) => `${p.label} ${fmtMinutes(p.min)}`).join('、')}` });
    for (const p of parts) {
      if (p.min <= 0) continue;
      const seg = h('span', { class: `bg-${p.key}` });
      seg.style.flex = `${p.min} 1 0`;
      bar.appendChild(seg);
    }
    kids.push(bar, h('div', { class: 'stagelegend' }, parts.map((p) => h('div', { class: 'item' },
      h('i', { class: `sw bg-${p.key}` }), h('span', { class: 'nm' }, p.label), h('b', null, fmtMinutes(p.min)),
      h('span', { class: 'pc' }, `${Math.round((p.min / total) * 100)}%`)))));
  }
  kids.push(h('h3', { class: 'subhead' }, '夜の中での移り変わり'), asyncBox(ctx.loadNight(ctx.date), (box, night) => {
    if (!hasNight(night)) return noNight(box);
    group.setOffset(night.offset);
    group.addLabel(box);
    const mc = miniChart('睡眠ステージ', '');
    box.appendChild(mc.el);
    const hyp = { api: null, set: (r) => { mc.head.textContent = r ? r.label : ''; }, reset: () => { mc.head.textContent = ''; } };
    hyp.api = hypnogram(mc.box, { segments: stageSegments(night.epochs), start: night.start, end: night.end, tooltip: false,
      xTicks: hourTicks(night.start, night.end, night.offset), xFormat: (t) => clock(t, night.offset),
      onHover: (t, r) => { hyp.set(r); group.broadcast(hyp, t); } });
    group.parts.push(hyp);
  }));
  return card('睡眠ステージ', 'ベッドにいた時間に対する割合', ...kids);
}

// ---------------------------------------------------------------- 3. 夜間の心拍・心拍変動・皮膚温
function vitalsCard(ctx, group) {
  return card('夜間の心拍・心拍変動・皮膚温', null, asyncBox(ctx.loadNight(ctx.date), (box, night) => {
    if (!hasNight(night)) return noNight(box);
    group.setOffset(night.offset);
    group.addLabel(box);
    addLine(box, group, night, { label: '心拍', unit: 'bpm', pick: (e) => e.sHr });
    addLine(box, group, night, { label: '心拍変動', unit: 'ms', pick: (e) => e.sHrv });
    addLine(box, group, night, { label: '皮膚温', unit: '℃', digits: 1, pick: (e) => e.temp });
  }));
}

// ---------------------------------------------------------------- 4. 睡眠時の呼吸
function renderBreathNight(box, night) {
  if (!hasNight(night)) return noNight(box);
  const group = linkGroup();
  group.setOffset(night.offset);
  group.addLabel(box);
  addLine(box, group, night, { label: '血中酸素', unit: '%', digits: 1, pick: (e) => e.sSpo2 });
  addLine(box, group, night, { label: '呼吸数', unit: '回/分', digits: 1, pick: (e) => e.resp });

  // 酸素低下の指標（5分ごと）。API の sleep_odi をそのまま描く（足し合わせた回数は出さない。意味が未確認のため）
  const odi = night.epochs.filter((e) => e.odi != null);
  if (odi.length) {
    const count = odi.filter((e) => e.odi > 0).length;
    const mc = miniChart('酸素低下の指標（5分ごと）', count ? `値があった枠 ${count}` : '低下の記録なし');
    box.appendChild(mc.el);
    const shift = night.offset * 60000;
    columnChart(mc.box, {
      height: 84, ariaLabel: '酸素低下の指標の夜間の推移', emptyText: 'この夜の記録はありません',
      cats: odi.map((e) => {
        const d = new Date(e.t + shift);
        const onHour = d.getUTCMinutes() === 0 && d.getUTCHours() % 2 === 0;
        return { title: `${clock(e.t - 300000, night.offset)}〜${clock(e.t, night.offset)}`, tick: onHour ? `${d.getUTCHours()}時` : null };
      }),
      stacks: [{ name: '酸素低下の指標', cls: 'accent', values: odi.map((e) => e.odi) }],
      y: { format: (v) => fmtNum(v, Number.isInteger(v) ? 0 : 1), max: Math.max(3, ...odi.map((e) => e.odi)) },
    });
  }
}

function breathTrend(box, ctx) {
  const dates = lastDates(ctx.date, BREATH_NIGHTS);
  const dayOf = (d) => { const x = ctx.state.days.get(d); return x && x.hasNight ? x : null; };
  const defs = [
    { label: '血中酸素の平均', unit: '%', digits: 1, key: 'spo2', get: (x) => x.v.sleep_spo2_mean },
    { label: '呼吸数', unit: '回/分', digits: 1, key: 'resp', get: (x) => x.v.sleep_respiration_rate_mean },
    { label: '酸素低下の指標（夜間平均）', unit: '', digits: 1, key: 'odi', get: (x) => x.nightOdi },
    { label: 'SOXAI の指標値（参考）', unit: '', digits: 0, key: null, get: (x) => x.v.sleep_ahi_class },
  ];
  for (const def of defs) {
    const points = dates.map((d, i) => { const x = dayOf(d); return { x: i, y: x ? def.get(x) ?? null : null }; });
    const fmt = (v) => (def.digits ? fmtNum(v, def.digits) : fmtInt(v));
    const today = points[points.length - 1].y;
    const mc = miniChart(def.label, today == null ? '—' : `${fmt(today)}${def.unit ? ` ${def.unit}` : ''}`);
    box.appendChild(mc.el);
    // 帯は、自分の現在の平常範囲（中央値 ± ふだんのばらつき）。SOXAI の指標値には帯も判定も付けない
    const base = def.key && ctx.result ? ctx.result.metrics[def.key].base : null;
    lineChart(mc.box, {
      height: 84, ariaLabel: `${def.label}の夜ごとの推移`, emptyText: 'この期間の記録はありません',
      x: { min: 0, max: dates.length - 1, ticks: indexTicks(dates, 4), format: (i) => `${shortDate(dates[i])}(${weekdayOf(dates[i])})` },
      y: { format: fmt, floor0: true },
      band: base && base.ready ? { lo: base.median - base.spread, hi: base.median + base.spread } : null,
      series: [{ name: def.label, tone: 'accent', points }],
    });
  }
}

function breathingCard(ctx) {
  const { day } = ctx;
  const v = day.v;
  const tiles = h('div', { class: 'tiles' },
    statTile('血中酸素の平均', unitValue(v.sleep_spo2_mean == null ? '—' : fmtNum(v.sleep_spo2_mean, Number.isInteger(v.sleep_spo2_mean) ? 0 : 1), '%'),
      v.sleep_spo2_min != null ? `最低 ${fmtInt(v.sleep_spo2_min)}%` : null),
    statTile('呼吸数', unitValue(v.sleep_respiration_rate_mean == null ? '—' : fmtNum(v.sleep_respiration_rate_mean, 1), '回/分')),
    statTile('酸素低下の指標', day.nightOdi == null ? '—' : fmtNum(day.nightOdi, 1), '5分ごとの値の夜間平均'),
    statTile('SOXAI の指標値', v.sleep_ahi_class == null ? '—' : fmtInt(v.sleep_ahi_class), '届いた値のまま'));
  const trendBox = h('div');
  ctx.mount(() => breathTrend(trendBox, ctx));
  const nightFold = fold('この夜の推移', (box) => box.appendChild(asyncBox(ctx.loadNight(ctx.date), renderBreathNight)));
  const dates = lastDates(ctx.date, BREATH_NIGHTS);
  return chartCard({ title: '睡眠時の呼吸', sub: 'この夜の値と、夜ごとの推移です。',
    tableSpec: () => ({ columns: ['日付', '血中酸素', '呼吸数', '酸素低下', 'SOXAI の値'],
      rows: dates.map((d) => { const x = ctx.state.days.get(d);
        return !x || !x.hasNight ? [shortDate(d), null, null, null, null]
          : [shortDate(d), x.v.sleep_spo2_mean, x.v.sleep_respiration_rate_mean, x.nightOdi == null ? null : fmtNum(x.nightOdi, 1), x.v.sleep_ahi_class]; }).reverse() }) },
  tiles,
  h('p', { class: 'explain' },
    'SOXAI は、睡眠中に血中酸素が下がった回数（1時間あたり）をもとに、「平常・許容範囲・乱れあり・大きな乱れ」の4段階で評価しています（SOXAI の公式の説明）。その夜がどの段階だったかは、SOXAI アプリの「睡眠時無呼吸の傾向」で確認できます。'),
  h('p', { class: 'explain' },
    '「SOXAI の指標値」と「酸素低下の指標」は、SOXAI から届いた値をそのまま載せています。これらの値が4段階のどれに当たるかは、数夜分の記録で照合している途中です。確認できるまで、このアプリでは段階や回数への読み替え、良し悪しの判定をしません。'),
  h('h3', { class: 'subhead' }, `夜ごとの推移（直近${BREATH_NIGHTS}夜）`),
  h('p', { class: 'sub' }, '薄い帯は、自分の現在の平常範囲です。'),
  trendBox,
  nightFold.el);
}

// ---------------------------------------------------------------- 5. 睡眠負債 / 6. 規則性
function debtCard(ctx) {
  const s = ctx.result.sleep;
  const debt = s.debt;
  const note = debt.status === 'ok'
    ? `直近14日の不足の合計（直近7日を重く見ます）: ${debt.minutes ? fmtMinutes(debt.minutes) : 'なし'}`
    : `あと${debt.needed - debt.nights}夜分たまると表示されます`;
  return card('睡眠負債', null,
    h('div', { class: 'rows' },
      h('div', { class: 'rowitem' },
        h('div', { class: 'name' }, '睡眠負債'),
        h('div', { class: `value${debt.status === 'ok' ? '' : ' none'}` }, debt.status === 'ok' ? debt.label : '—'),
        h('div', { class: 'note' }, h('span', null, note))),
      h('div', { class: 'rowitem' },
        h('div', { class: 'name' }, '必要な睡眠時間'),
        h('div', { class: 'value' }, fmtMinutes(s.needMin)),
        h('div', { class: 'note' },
          s.needIsProvisional ? chip('暫定値') : null,
          h('button', { class: 'linkbtn', type: 'button', onclick: () => ctx.go('settings') }, '設定で変更')))));
}

function regularityCard(ctx) {
  const reg = ctx.result.sleep.regularity;
  const gap = ctx.result.sleep.weekendGapMin;
  const note = reg.status === 'ok'
    ? `直近7日の睡眠の中央時刻のばらつき: ${reg.sdMin}分`
    : `あと${reg.needed - reg.nights}夜分たまると表示されます`;
  return card('規則性', null,
    h('div', { class: 'rows' },
      h('div', { class: 'rowitem' },
        h('div', { class: 'name' }, '就寝と起床の規則性'),
        h('div', { class: `value${reg.status === 'ok' ? '' : ' none'}` }, reg.status === 'ok' ? reg.label : '—'),
        h('div', { class: 'note' }, h('span', null, note))),
      gap == null ? null : plainRow('平日と休日の差', gap === 0 ? '差なし' : fmtMinutes(Math.abs(gap)),
        gap === 0 ? null : `休日の睡眠の中央時刻は、平日より${gap > 0 ? '遅い' : '早い'}`)));
}

// ---------------------------------------------------------------- 7. 過去14夜
function recentCard(ctx) {
  const dates = lastDates(ctx.date, 14);
  const get = (key) => dates.map((d) => { const x = ctx.state.days.get(d); return x && x.hasNight && x.v[key] != null ? x.v[key] / 60 : null; });
  const stacks = [
    { name: '深い', cls: 'deep', values: get('sleep_deep_sleep_time') },
    { name: '浅い', cls: 'light', values: get('sleep_light_sleep_time') },
    { name: 'レム', cls: 'rem', values: get('sleep_rem_sleep_time') },
  ];
  const box = h('div');
  ctx.mount(() => columnChart(box, {
    height: 160, ariaLabel: '過去14夜の睡眠時間', emptyText: '過去14夜の睡眠の記録はありません',
    cats: dates.map((d, i) => ({ title: `${shortDate(d)}(${weekdayOf(d)})`, tick: dateTicks(dates, 3)[i] })),
    stacks,
    y: { format: (v) => fmtMinutes(v * 60), tick: (v) => fmtHM(v * 60) },
    total: { name: '合計', format: (v) => fmtMinutes(v * 60) },
  }));
  const legend = h('div', { class: 'legend' }, stacks.map((st) => h('span', { class: 'item' }, h('i', { class: `sw bg-${st.cls}` }), st.name)));
  return chartCard({ title: '過去14夜の睡眠時間', sub: '深い・浅い・レムの積み上げ',
    tableSpec: () => ({ columns: ['日付', '深い', '浅い', 'レム', '合計'],
      rows: dates.map((d) => { const x = ctx.state.days.get(d); const ok = x && x.hasNight;
        return [shortDate(d), ok ? fmtMinutes(x.v.sleep_deep_sleep_time) : null, ok ? fmtMinutes(x.v.sleep_light_sleep_time) : null,
          ok ? fmtMinutes(x.v.sleep_rem_sleep_time) : null, ok ? fmtMinutes(x.v.sleep_total_sleep_time) : null]; }).reverse() }) },
  box, legend);
}

export function sleepView(ctx) {
  const { day, result } = ctx;
  if (!day || !day.hasNight || !result) {
    return [
      h('section', { class: 'card' }, h('div', { class: 'empty' }, h('strong', null, 'この日の睡眠の記録はありません'),
        ctx.date === ctx.today
          ? '起きた後に SOXAI アプリでリングを同期すると、昨夜の睡眠がここに表示されます。'
          : 'リングを着けずに眠ったか、同期されていない日です。')),
      ctx.state.days.size ? recentCard(ctx) : null,
    ].filter(Boolean);
  }
  const group = linkGroup(); // 睡眠ステージと、心拍・心拍変動・皮膚温のグラフを連動させる
  return [
    overviewCard(ctx),
    stageCard(ctx, group),
    vitalsCard(ctx, group),
    breathingCard(ctx),
    debtCard(ctx),
    regularityCard(ctx),
    recentCard(ctx),
    h('p', { class: 'fineprint' }, FINEPRINT),
  ];
}
