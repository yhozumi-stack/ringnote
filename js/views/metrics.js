// 指標の見せ方と「自分比」の行。今日タブと睡眠タブで同じものを使う。
// 数字や判定は分析エンジンの結果をそのまま表示する。ここでは計算しない。

import { h, fmtInt, fmtNum, fmtMinutes, valueWithUnit, addDays } from '../ui.js';
import { sparkline } from '../charts.js';
import { CONFIG } from '../engine/index.js';
import { chip } from './parts.js';

export function signed(v, digits = 0) {
  const r = Number(v.toFixed(digits));
  if (r === 0) return '±0';
  return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(digits);
}

const signedMinutes = (v) => {
  const r = Math.round(v);
  return r === 0 ? '±0分' : `${r > 0 ? '+' : '−'}${fmtMinutes(Math.abs(r))}`;
};

export const METRIC_VIEW = {
  hrv: { label: '心拍変動', unit: 'ms', value: (v) => fmtInt(v), dev: (d) => `${signed(d.pct * 100)}%`, base: (b) => `${fmtInt(b)}ms` },
  hr: { label: '睡眠中の心拍', unit: 'bpm', value: (v) => fmtInt(v), dev: (d) => `${signed(d.diff)}bpm`, base: (b) => `${fmtInt(b)}bpm` },
  temp: { label: '夜間の皮膚温', unit: '℃', value: (v) => fmtNum(v, 1), dev: (d) => `${signed(d.diff, 1)}℃`, base: (b) => `${fmtNum(b, 1)}℃` },
  spo2: { label: '血中酸素', unit: '%', value: (v) => (Number.isInteger(v) ? fmtInt(v) : fmtNum(v, 1)), dev: (d) => signed(d.diff, 1), base: (b) => `${fmtNum(b, 1)}%` },
  resp: { label: '呼吸数', unit: '回/分', value: (v) => fmtNum(v, 1), dev: (d) => signed(d.diff, 1), base: (b) => `${fmtNum(b, 1)}回/分` },
  sleep: { label: '睡眠時間', unit: '', value: (v) => fmtMinutes(v), dev: (d) => signedMinutes(d.diff), base: (b) => fmtMinutes(b) },
  eff: { label: '睡眠効率', unit: '%', value: (v) => fmtInt(v), dev: (d) => signed(d.diff), base: (b) => `${fmtInt(b)}%` },
  awake: { label: '途中で起きていた時間', unit: '', value: (v) => fmtMinutes(v), dev: (d) => signedMinutes(d.diff), base: (b) => fmtMinutes(b) },
  odi: { label: '酸素低下の指標', unit: '', value: (v) => fmtNum(v, 1), dev: (d) => signed(d.diff, 1), base: (b) => fmtNum(b, 1) },
  latency: { label: '寝つくまでの時間', unit: '', value: (v) => fmtMinutes(v), dev: (d) => signedMinutes(d.diff), base: (b) => fmtMinutes(b) },
};

/** ズレの大きさを、文字つきの札にする。望ましい向きはエンジンの設定に従う */
export function deviationChip(key, dev) {
  const az = Math.abs(dev.z);
  if (az < 1) return chip('平常の範囲');
  const up = dev.diff > 0;
  const text = up ? '平常より高め' : '平常より低め';
  const better = CONFIG.metrics[key].better;
  if (better === 'steady') return chip(text, az >= 1.5 ? 'warn' : '');
  const favorable = (better === 'higher') === up;
  return chip(text, favorable ? 'good' : az >= 1.5 ? 'warn' : '');
}

/** 値・直近14夜の小さな推移・平常との差を1行にまとめる */
export function metricRow(ctx, key, { label, spark = true } = {}) {
  const view = METRIC_VIEW[key];
  const m = ctx.result.metrics[key];
  const v = m.value;
  let sparkEl = null;
  if (spark) {
    sparkEl = h('div', { class: 'spark' });
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const r = ctx.state.results.get(addDays(ctx.date, -i));
      series.push(r ? r.metrics[key].value : null);
    }
    sparkline(sparkEl, series);
  }
  const note = h('div', { class: 'note' });
  if (v == null) note.append('この夜の値はありません');
  else if (m.dev) {
    note.append(deviationChip(key, m.dev), h('span', null, `平常 ${view.base(m.base.median)}（${view.dev(m.dev)}）`));
    if (ctx.result.stage.key === 'provisional') note.append(h('span', { class: 'muted' }, '暫定'));
  } else {
    // 今夜の分も「たまった夜」に数える（上の「n/14夜」の数え方とそろえる）
    const have = (m.base ? m.base.n : 0) + (ctx.result.night.baselineEligible ? 1 : 0);
    const need = Math.max(1, CONFIG.baseline.minValues - have);
    note.append(h('span', { class: 'muted' }, `自分比は、あと${need}夜分たまると表示されます`));
  }
  return h('div', { class: 'rowitem' },
    h('div', { class: 'name' }, label || view.label),
    h('div', { class: 'valuewrap' }, sparkEl, h('div', { class: `value${v == null ? ' none' : ''}` }, valueWithUnit(v == null ? '—' : view.value(v), view.unit))),
    note);
}

/** 自分比を付けない、値だけの行 */
export function plainRow(label, valueText, noteText) {
  return h('div', { class: 'rowitem' },
    h('div', { class: 'name' }, label),
    h('div', { class: `value${valueText === '—' ? ' none' : ''}` }, valueText),
    noteText ? h('div', { class: 'note' }, h('span', null, noteText)) : null);
}
