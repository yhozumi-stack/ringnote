// Trends: 各指標の推移と平常範囲、今週と先週の比較、体調変化の履歴、記録との関係（設計書 5.1 / 5.4）。
// 期間の終わりは、ヘッダーで選んでいる日。

import { h, fmtInt, fmtNum, fmtMinutes, fmtHM, fmtSigned, shortDate, weekdayOf, dateLabel, addDays } from '../ui.js';
import { lineChart, dataTable } from '../charts.js';
import { OUTCOMES, COMPARISONS, COLD_SYMPTOMS, groupCompare, coldEpisodes, optionLabel, CONFIG } from '../engine/index.js';
import { card, chip, chartCard, miniChart, segmented, fold, lastDates, indexTicks } from './parts.js';
import { signed } from './metrics.js';

let range = 30; // 表示する日数（タブを離れても覚えておく）

const fmtDigits = (digits) => (v) => (digits ? fmtNum(v, digits) : fmtInt(v));

// get(result, day) → 値。metric を指定した指標は、帯（現在の平常範囲）を描く
const SERIES = [
  { title: 'コンディション', unit: '', fmt: fmtInt, y: { max: 100 }, get: (r) => (r && r.recovery.status === 'ok' ? r.recovery.score : null),
    empty: 'コンディションは、14夜分たまってから算出します' },
  { title: '睡眠時間', unit: '', fmt: (v) => fmtHM(v * 60), headFmt: (v) => fmtMinutes(v * 60), get: (r, d) => (d && d.hasNight ? d.v.sleep_total_sleep_time / 60 : null) },
  { title: '心拍変動', unit: 'ms', fmt: fmtInt, metric: 'hrv' },
  { title: '睡眠中の心拍', unit: 'bpm', fmt: fmtInt, metric: 'hr' },
  { title: '夜間の皮膚温', unit: '℃', fmt: fmtDigits(1), metric: 'temp' },
  { title: '歩数', unit: '歩', fmt: fmtInt, y: { floor0: true }, get: (r, d) => (d && d.worn ? d.v.activity_steps : null) },
];

const mean = (vals) => { const v = vals.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const valueOf = (ctx, def, date) => {
  const r = ctx.state.results.get(date);
  const d = ctx.state.days.get(date);
  return def.metric ? (r ? r.metrics[def.metric].value : null) : def.get(r, d) ?? null;
};

function chartsCard(ctx) {
  const dates = lastDates(ctx.date, range);
  const box = h('div');
  ctx.mount(() => {
    for (const def of SERIES) {
      const points = dates.map((d, i) => ({ x: i, y: valueOf(ctx, def, d) }));
      const avg = mean(points.map((p) => p.y));
      const headFmt = def.headFmt || ((v) => `${def.fmt(v)}${def.unit ? ` ${def.unit}` : ''}`);
      const mc = miniChart(def.title, avg == null ? '' : `平均 ${headFmt(avg)}`);
      box.appendChild(mc.el);
      const base = def.metric && ctx.result ? ctx.result.metrics[def.metric].base : null;
      const band = base && base.ready ? { lo: base.median - base.spread, hi: base.median + base.spread } : null;
      lineChart(mc.box, {
        height: 104, ariaLabel: `${def.title}の推移`, emptyText: def.empty || 'この期間の記録はありません',
        x: { min: 0, max: dates.length - 1, ticks: indexTicks(dates, 4), format: (i) => `${shortDate(dates[i])}(${weekdayOf(dates[i])})` },
        y: { format: def.fmt, ...(def.y || {}) },
        band,
        series: [{ name: def.title, tone: 'accent', points }],
      });
    }
  });
  const pick = segmented('表示する期間', [[14, '14日'], [30, '30日'], [90, '90日']], range, (v) => { range = v; ctx.rerender(); });
  return chartCard({ title: '推移', sub: '薄い帯は、自分の現在の平常範囲（中央値 ± ふだんのばらつき）です。',
    tableSpec: () => ({ columns: ['日付', ...SERIES.map((s) => s.title)],
      rows: dates.map((d) => [shortDate(d), ...SERIES.map((s) => { const v = valueOf(ctx, s, d); return v == null ? null : (s.headFmt || s.fmt)(v); })]).reverse() }) },
  h('div', { class: 'filters' }, pick), box);
}

// ---------------------------------------------------------------- 今週と先週
function weekCard(ctx) {
  const rows = [
    { label: 'コンディション', def: SERIES[0], diff: (d) => signed(d) },
    { label: '睡眠時間', def: SERIES[1], show: (v) => fmtMinutes(v * 60), round: (v) => Math.round(v * 60) / 60, diff: (d) => (Math.round(d * 60) === 0 ? '±0分' : `${d > 0 ? '+' : '−'}${fmtMinutes(Math.abs(d * 60))}`) },
    { label: '心拍変動', def: SERIES[2], show: (v) => `${fmtInt(v)} ms`, diff: (d) => `${signed(d)} ms` },
    { label: '睡眠中の心拍', def: SERIES[3], show: (v) => `${fmtInt(v)} bpm`, diff: (d) => `${signed(d)} bpm` },
    { label: '歩数', def: SERIES[5], show: (v) => `${fmtInt(v)} 歩`, diff: (d) => `${fmtSigned(d)} 歩` },
  ];
  const avgOver = (def, from, to) => {
    const vals = [];
    for (let i = from; i <= to; i++) vals.push(valueOf(ctx, def, addDays(ctx.date, -i)));
    const have = vals.filter((v) => v != null);
    return have.length >= 3 ? mean(have) : null; // 3日分に満たない週は、平均を出さない
  };
  return card('この7日間と、その前の7日間', '日ごとの値の平均です。3日分に満たない時は出しません。',
    h('div', { class: 'rows' }, rows.map((row) => {
      // 表示と同じ丸めをしてから差を出す（表示した2つの数字と、差が食い違わないようにする）
      const round = row.round || Math.round;
      const rounded = (v) => (v == null ? null : round(v));
      const now = rounded(avgOver(row.def, 0, 6));
      const before = rounded(avgOver(row.def, 7, 13));
      const show = row.show || ((v) => fmtInt(v));
      return h('div', { class: 'rowitem' },
        h('div', { class: 'name' }, row.label),
        h('div', { class: `value${now == null ? ' none' : ''}` }, now == null ? '—' : show(now)),
        h('div', { class: 'note' }, h('span', null, before == null ? 'その前の7日間の記録が足りません'
          : now == null ? `その前の7日間 ${show(before)}` : `その前の7日間 ${show(before)}（${row.diff(now - before)}）`)));
    })));
}

// ---------------------------------------------------------------- 体調変化の履歴
function tagChips(sub) {
  if (!sub) return [];
  const out = [];
  if (sub.cold === 'slight' || sub.cold === 'yes') out.push(chip(`風邪っぽい症状 ${optionLabel('cold', sub.cold)}`));
  if (sub.alcohol === 'some' || sub.alcohol === 'much') out.push(chip(`飲酒 ${optionLabel('alcohol', sub.alcohol)}`));
  if (sub.condition === 'bad') out.push(chip('体調 悪い'));
  return out;
}

function radarHistoryCard(ctx) {
  const dates = lastDates(ctx.date, range);
  const items = [];
  for (const d of dates) {
    const r = ctx.state.results.get(d);
    if (!r || !r.radar.message || (r.radar.status !== 'active' && r.radar.status !== 'reference')) continue;
    items.push({ date: d, r });
  }
  const body = items.length
    ? h('div', { class: 'rows' }, items.reverse().map(({ date, r }) => {
      const tone = r.radar.returned ? 'good' : r.radar.level === 'strong' ? 'serious' : 'warn';
      return h('div', { class: 'rowitem' },
        h('div', { class: 'name' }, dateLabel(date)),
        h('div', { class: 'value plain' }, chip(r.radar.returned ? '平常範囲に戻りました' : r.radar.label, tone)),
        h('div', { class: 'note' }, r.radar.returned ? null : h('span', null, r.radar.message.lines[0]),
          r.radar.status === 'reference' ? chip('参考（学習中）') : null, tagChips(r.subjective)));
    }))
    : h('p', { class: 'sentence' }, 'この期間に、体調の変化は検出していません。');
  return card('体調変化の履歴', `直近${range}日。同じ日の記録（飲酒・風邪っぽい症状・体調）も並べて表示します。`, body);
}

// ---------------------------------------------------------------- 記録との関係（設計書 5.4）
// 主観入力・生活ログと数値を比べる。未入力の日は数えない。件数が少ない時は値を出さない。
let insightDays = 0;              // 集計する期間（日数）。0 は全期間
const openFolds = new Set();      // 開いている比較（描き直しても開いたままにする）

function cellText(def, cell) {
  if (!cell || cell.level === 'few' || cell.value == null) return '—';
  let text;
  if (def.share) text = `${cell.count}/${cell.n}日`;
  else if (def.base) text = `${signed(cell.value, def.digits)}${def.unit}`;
  else text = fmtNum(cell.value, def.digits);
  return cell.level === 'ref' ? `${text}※` : text;
}

function keptFold(key, title, note, render) {
  const f = fold(title, render, { open: openFolds.has(key), note });
  f.el.addEventListener('toggle', () => { if (f.el.open) openFolds.add(key); else openFolds.delete(key); });
  return f;
}

function comparisonFold(ctx, comparison, range) {
  const res = groupCompare(ctx.state.days, ctx.state.results, comparison, range);
  const total = res.groups.reduce((a, g) => a + g.n, 0);
  // 過去の記録がたまってから出せる比較（本人比）は、たまるまでの日数を案内する
  const needs = comparison.needs;
  const have = needs ? [...ctx.state.days.values()].filter((d) => d.date <= range.upTo && d.subjective && d.subjective[needs.field] != null).length : 0;
  const waiting = needs && !total;
  const note = total ? res.groups.filter((g) => g.n).map((g) => `${g.label} ${g.n}`).join('・') : waiting ? `入力した日 ${have}／${needs.minDays}日` : '記録なし';
  return keptFold(res.key, res.title, note, (box) => {
    if (waiting) {
      box.appendChild(h('p', { class: 'explain' },
        `本数を入力した日が${needs.minDays}日たまると、自分のふだんの本数を基準に「少なめ・普段どおり・多め」で比べます（今は${have}日）。基準は、その日より前の直近90日の自分の記録です。保存しているのは実際の本数で、区分は集計の時に計算します。`));
      return;
    }
    if (!total) { box.appendChild(h('p', { class: 'explain' }, 'まだ記録がありません。今日タブの入力欄で記録できます。')); return; }
    box.appendChild(dataTable({
      columns: ['', ...res.groups.map((g) => `${g.label}\n（${g.n}）`)], // 見出しは2行にして、列の幅を抑える
      rows: res.outcomes.map((o) => [OUTCOMES[o].label, ...res.groups.map((g) => cellText(OUTCOMES[o], g.values[o]))]),
    }));
    if (res.groups.every((g) => g.level === 'few')) {
      box.appendChild(h('p', { class: 'explain' }, `どの組も${CONFIG.insights.refAt}件に届いていないので、まだ値は出していません。`));
    }
  });
}

// ---------------------------------------------------------------- 風邪っぽい症状の前後（設計書 5.4）
// 1回目から「1回の記録」として見せる。回数が少ないうちは、傾向とは呼ばない。
const seenEpisodes = new Set(); // 一度見せた回（いちばん新しい回だけ、初めて見た時に開いておく）
const offsetLabel = (k) => (k === 0 ? '当日' : k === -1 ? '前日' : k === 1 ? '翌日' : k < 0 ? `${-k}日前` : `${k}日後`);
// 7日ぶんを横に並べるので、単位は行の見出しに寄せて、列の幅を抑える
const outcomeLabel = (key) => (key === 'score' ? 'コンディション' : `${OUTCOMES[key].label}${OUTCOMES[key].unit ? ` ${OUTCOMES[key].unit}` : ''}`);
const outcomeText = (key, v) => { const def = OUTCOMES[key]; return v == null ? '—' : def.base ? signed(v, def.digits) : fmtNum(v, def.digits); };
const radarText = (radar) => (radar ? `${radar.label.replace('兆候', '')}${radar.reference ? '*' : ''}` : '—');

/** 横に長い表を、真ん中（当日の前後）が見える位置から始める */
function centered(table) {
  requestAnimationFrame(() => { table.scrollLeft = Math.max(0, (table.scrollWidth - table.clientWidth) / 2); });
  return table;
}

function episodeFold(e, ep, isLatest) {
  const key = `ep:${ep.onset}`;
  if (isLatest && !seenEpisodes.has(key)) openFolds.add(key);
  seenEpisodes.add(key);
  const symptomNames = new Map(COLD_SYMPTOMS);
  const note = `症状 ${optionLabel('cold', ep.max)}${ep.symptoms.length ? `（${ep.symptoms.map((s) => symptomNames.get(s)).join('・')}）` : ''}`;
  const title = `${shortDate(ep.onset)}(${weekdayOf(ep.onset)}) から${ep.spanDays > 1 ? ` ${ep.spanDays}日間` : ''}`;
  return keptFold(key, title, note, (box) => {
    box.appendChild(centered(dataTable({
      columns: ['', ...ep.rows.map((r) => `${offsetLabel(r.offset)}\n${shortDate(r.date)}`)],
      rows: [
        ...e.outcomes.map((o) => [outcomeLabel(o), ...ep.rows.map((r) => outcomeText(o, r.values[o]))]),
        ['体調変化の検出', ...ep.rows.map((r) => radarText(r.radar))],
        ['症状の入力', ...ep.rows.map((r) => (r.symptom ? optionLabel('cold', r.symptom) : r.hasRecord ? '' : '—'))],
      ],
    })));
  });
}

function coldCard(ctx) {
  const e = coldEpisodes(ctx.state.days, ctx.state.results, { upTo: ctx.date });
  const ec = CONFIG.insights.episode;
  const sub = `症状が「少し」か「あり」になった最初の日を「当日」として、前後${ec.before}日の動きを並べます。数日続いた症状は、1回として数えます。`;
  if (!e.count) {
    return card('風邪っぽい症状の前後', sub, h('p', { class: 'sentence' }, 'まだ記録がありません。今日タブで風邪っぽい症状を「少し」か「あり」にした日から、ここに並びます。'));
  }
  const status = e.level === 'record' ? `${e.count}回の記録です。傾向を判断できるデータ量ではありません。`
    : e.level === 'ref' ? `${e.count}回の記録から、参考として中央値を出しています（※）。まだ傾向と言い切れる回数ではありません。`
      : `${e.count}回の記録の中央値です。`;
  const mark = e.level === 'ref' ? '※' : '';
  const kids = [h('p', { class: 'statusline' }, status),
    h('p', { class: 'explain' }, '「+」「−」の付いた値は、自分の平常値との差です。コンディションは点数そのものです。体調変化の検出は「なし・軽い・強い」で、* は学習中の参考です。表は横に動かせます。相関であって、原因を示すものではありません。')];
  if (e.aggregate) {
    kids.push(h('h3', { class: 'subhead' }, `${e.count}回の中央値`), h('div', { class: 'foldbody' }, centered(dataTable({
      columns: ['', ...e.aggregate.map((o) => offsetLabel(o.offset))],
      rows: [
        ...e.outcomes.map((o) => [outcomeLabel(o), ...e.aggregate.map((x) => (x.values[o].value == null ? '—' : `${outcomeText(o, x.values[o].value)}${mark}`))]),
        ['体調変化の検出', ...e.aggregate.map((x) => (x.detected.n ? `${x.detected.count}/${x.detected.n}回${mark}` : '—'))],
      ],
    }))));
  }
  const folds = e.episodes.map((ep, i) => episodeFold(e, ep, i === 0));
  ctx.mount(() => folds.forEach((f) => f.fillIfOpen()));
  kids.push(h('h3', { class: 'subhead' }, '1回ごとの記録'), h('div', { class: 'foldlist' }, folds.map((f) => f.el)));
  return card('風邪っぽい症状の前後', sub, ...kids);
}

function insightsCard(ctx) {
  const range = { from: insightDays ? addDays(ctx.date, -(insightDays - 1)) : null, upTo: ctx.date };
  const byKey = new Map(COMPARISONS.map((c) => [c.key, c]));
  const order = ['alcohol', 'coffee', 'energy', 'caffeineLast', 'iqos', 'iqosRelative', 'iqosLast', 'training', 'mental', 'badDay', 'conditionScore', 'fatigueScore', 'coldDetect', 'badDetect'];
  const folds = order.map((key) => comparisonFold(ctx, byKey.get(key), range));
  ctx.mount(() => folds.forEach((f) => f.fillIfOpen()));
  const pick = segmented('集計する期間', [[30, '30日'], [60, '60日'], [90, '90日'], [0, '全期間']], insightDays, (v) => { insightDays = v; ctx.rerender(); });
  return card('記録との関係', '主観入力・生活ログと数値の関係です。相関であって、原因を示すものではありません。同じ日の寝不足や運動など、ほかの要因も含んだ値です。',
    h('div', { class: 'filters' }, pick),
    h('p', { class: 'explain' },
      `数字は、その組に入る日の中央値です。「+」「−」の付いた値は、自分の平常値との差。かっこ内は件数で、未入力の日は数えていません。「—」は${CONFIG.insights.refAt}件未満、「※」は${CONFIG.insights.refAt}〜${CONFIG.insights.fullAt - 1}件の参考値です。`),
    h('div', { class: 'foldlist' }, folds.map((f) => f.el)));
}

export function trendsView(ctx) {
  if (!ctx.state.days.size) {
    return [h('section', { class: 'card' }, h('div', { class: 'empty' }, h('strong', null, 'まだ記録がありません'), 'データがたまると、ここに推移が表示されます。'))];
  }
  return [
    chartsCard(ctx),
    weekCard(ctx),
    radarHistoryCard(ctx),
    coldCard(ctx),
    insightsCard(ctx),
    h('p', { class: 'fineprint' }, 'このアプリは健康管理の参考用で、診断や治療を目的としたものではありません。'),
  ];
}
