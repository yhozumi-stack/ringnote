// Stress: 日中のストレス（設計書 3.3 / 5.1）。
// 表示するのは、SOXAI のストレス値を「自分の直近14日の分布」で 高・中・低 に分けた相対的な区分。
// 尺度の定義が公開されていないので、低い値を「回復」とは呼ばない。運動中とその後10分は数えない。
// 独自の指標は裏で計算するだけで、画面には出さない（設計書 5.1）。

import { h, clock, fmtMinutes, fmtInt, shortDate, weekdayOf } from '../ui.js';
import { lineChart } from '../charts.js';
import { card, chartCard, statTile, lastDates, indexTicks, hourTicks, asyncBox } from './parts.js';

const GAP_MS = 10 * 60000; // これより間が空いたら、線をつながない（着けていない時間・睡眠・運動）

function summaryCard(a) {
  if (a.status === 'learning') {
    return card('高・中・低の区分', null,
      h('div', { class: 'hero' }, h('div', { class: 'big' }, String(a.daysInBaseline), h('span', { class: 'unit' }, `/ ${a.daysNeeded} 日`))),
      h('p', { class: 'sentence' }, `自分の分布を作るのに、日中の記録が${a.daysNeeded}日分必要です。それまでは、下の1日の曲線だけを表示します。`));
  }
  if (a.status === 'flat') return card('高・中・低の区分', null, h('p', { class: 'sentence' }, a.note));
  const excluded = a.exerciseMin + a.cooldownMin;
  return card('高・中・低の時間', '自分の直近14日の分布で分けた、相対的な区分です（上位25%が高、下位25%が低）。',
    h('div', { class: 'tiles' },
      statTile('「高」の時間', fmtMinutes(a.minutes.high), a.longestHighMin ? `続いた最長 ${fmtMinutes(a.longestHighMin)}` : null),
      statTile('「低」の時間', fmtMinutes(a.minutes.low)),
      statTile('「中」の時間', fmtMinutes(a.minutes.mid)),
      statTile('運動として除いた時間', fmtMinutes(excluded), '運動中と、その後10分')),
    h('p', { class: 'explain' }, 'SOXAI のストレス値は尺度の定義が公開されていないため、低い値を「回復」とは呼びません。'));
}

function exerciseRuns(series, offset) {
  const runs = [];
  for (const p of series) {
    if (p.zone !== 'exercise' && p.zone !== 'cooldown') continue;
    const last = runs[runs.length - 1];
    if (last && p.t - last.end <= 300000) last.end = p.t; else runs.push({ start: p.t - 300000, end: p.t });
  }
  return runs.map((r) => `${clock(r.start, offset)}〜${clock(r.end, offset)}`);
}

function curveCard(data) {
  const a = data.analysis;
  const pts = [];
  let prevT = null;
  for (const p of a.series) {
    const rest = p.zone !== 'exercise' && p.zone !== 'cooldown' && p.stress != null;
    if (prevT != null && p.t - prevT > GAP_MS) pts.push({ x: prevT + 1, y: null });
    pts.push({ x: p.t - 150000, y: rest ? p.stress : null });
    prevT = p.t;
  }
  const measured = pts.filter((p) => p.y != null);
  // 横軸は、起きてから最後の記録まで（正時に丸める。短い日でも3時間ぶんは確保する）
  const HOUR = 3600000;
  const shift = data.offset * 60000;
  const firstT = a.series.length ? a.series[0].t - 300000 : data.dayStart;
  const lastT = a.series.length ? a.series[a.series.length - 1].t : data.dayStart;
  const start = Math.max(data.dayStart, Math.floor((firstT + shift) / HOUR) * HOUR - shift);
  const end = Math.min(data.dayEnd, Math.max(start + 3 * HOUR, Math.ceil((lastT + shift) / HOUR) * HOUR - shift));
  const box = h('div');
  lineChart(box, {
    height: 170, ariaLabel: '日中のストレス値の推移', emptyText: 'この日の起きている時間の記録はまだありません',
    x: { min: start, max: end, ticks: hourTicks(start, end, data.offset), format: (t) => clock(t, data.offset) },
    y: { format: (v) => fmtInt(v), floor0: true },
    band: a.thresholds ? { lo: a.thresholds.low, hi: a.thresholds.high } : null,
    series: [{ name: 'ストレス値', tone: 'accent', points: pts }],
  });
  const runs = exerciseRuns(a.series, data.offset);
  const notes = [];
  if (a.thresholds) notes.push(`薄い帯は「中」の範囲（${fmtInt(a.thresholds.low)}〜${fmtInt(a.thresholds.high)}）。帯より上が「高」、下が「低」です。`);
  notes.push('眠っている時間と、運動中・運動直後は線を引いていません。');
  if (runs.length) notes.push(`運動として除いた時間帯: ${runs.slice(0, 6).join('、')}${runs.length > 6 ? ' ほか' : ''}`);
  return chartCard({ title: '1日の曲線', sub: 'SOXAI のストレス値（5分ごと）',
    tableSpec: measured.length ? () => ({ columns: ['時刻', 'ストレス値', '区分'],
      rows: a.series.filter((p) => p.stress != null).map((p) => [clock(p.t, data.offset), fmtInt(p.stress),
        { high: '高', mid: '中', low: '低', exercise: '運動', cooldown: '運動直後' }[p.zone] || '—']) }) : null },
  box, h('p', { class: 'explain' }, notes.join(' ')));
}

function blocksCard(a) {
  if (a.status !== 'ok') return null;
  return card('時間帯ごとの傾向', null,
    h('div', { class: 'rows' }, a.blocks.map((b) => h('div', { class: 'rowitem' },
      h('div', { class: 'name' }, b.label),
      h('div', { class: `value${b.average == null ? ' none' : ''}` }, b.average == null ? '—' : `平均 ${b.average}`),
      h('div', { class: 'note' }, h('span', null, b.measuredMin ? `「高」${fmtMinutes(b.highMin)} ／ 計測 ${fmtMinutes(b.measuredMin)}` : 'この時間帯の記録はありません'))))));
}

function renderStress(box, data) {
  const a = data.analysis;
  box.classList.add('stack');
  if (!data.awake.length) {
    box.appendChild(h('section', { class: 'card' }, h('div', { class: 'empty' }, h('strong', null, 'この日の起きている時間の記録はまだありません'),
      'SOXAI アプリでリングを同期すると、ここに表示されます。')));
    return;
  }
  // 独自のストレス指標（a.own）は、裏で計算しているだけで画面には出さない。実データが十分にたまってから SOXAI の値と比べる
  for (const el of [summaryCard(a), curveCard(data), blocksCard(a)]) if (el) box.appendChild(el);
  if (data.failed) {
    box.appendChild(h('p', { class: 'fineprint' }, `直近14日のうち ${data.failed} 日分の記録を取得できませんでした。その日を除いて区分しています。次に開いた時に取り直します。`));
  }
}

function recentCard(ctx) {
  const dates = lastDates(ctx.date, 14);
  const points = dates.map((d, i) => { const x = ctx.state.days.get(d); return { x: i, y: x ? x.v.health_stress ?? null : null }; });
  const box = h('div');
  ctx.mount(() => lineChart(box, {
    height: 140, ariaLabel: '直近14日のストレス値', emptyText: '直近14日の記録はありません', endLabel: true,
    x: { min: 0, max: dates.length - 1, ticks: indexTicks(dates, 4), format: (i) => `${shortDate(dates[i])}(${weekdayOf(dates[i])})` },
    y: { format: (v) => fmtInt(v), floor0: true },
    series: [{ name: '1日の値', tone: 'accent', points }],
  }));
  return chartCard({ title: '直近14日のストレス値', sub: 'SOXAI が算出した、日ごとの値です。',
    tableSpec: () => ({ columns: ['日付', 'ストレス値'], rows: dates.map((d, i) => [shortDate(d), points[i].y == null ? null : fmtInt(points[i].y)]).reverse() }) },
  box);
}

export function stressView(ctx) {
  const out = [];
  if (!ctx.day || !ctx.day.worn) {
    out.push(h('section', { class: 'card' }, h('div', { class: 'empty' }, h('strong', null, 'この日の計測データはありません'),
      ctx.date === ctx.today ? 'SOXAI アプリでリングを同期すると、ここに表示されます。' : 'リングを着けていないか、同期されていない日です。')));
  } else {
    out.push(asyncBox(ctx.loadStress(ctx.date), renderStress, { loadingText: '直近14日分の記録を読み込んでいます…（初回は少し時間がかかります）' }));
  }
  if (ctx.state.days.size) out.push(recentCard(ctx));
  out.push(h('p', { class: 'fineprint' }, 'このアプリは健康管理の参考用で、診断や治療を目的としたものではありません。'));
  return out;
}
