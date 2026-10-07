// AI 分析用の書き出し（設計書 5.6）。
//
// 目的は「後から、今とは別のやり方で分析し直せること」。そのために:
// - SOXAI から届いた日次データは、届いた形のまま載せる（丸めない・項目を選ばない・0 を欠損に直さない）。
// - 主観入力・生活ログは、入力した値のまま載せる（区分にまとめない。未入力はキーを持たせない）。
// - このアプリが計算した値（派生値、平常値との差、点数、体調変化の検出）は、別の枠に分けて載せる。
//   どれが元データで、どれが計算結果かを、後から区別できるようにするため。
// - 計算に使った設定値も一緒に載せる（同じ結果を再現できるようにするため）。
//
// 5分ごとのデータは量が多いので、別のファイルにする（buildDetailExport）。

import { CONFIG } from './config.js';
import { SUBJECTIVE_FIELDS, COLD_SYMPTOMS, sanitizeSubjective, energyCaffeineMg, lastTimeAt, iqosGapMin } from './subjective.js';
import { DAILY_FIELDS, DETAIL_FIELDS } from './fields.js';

export const ANALYSIS_FORMAT = 'ringnote-analysis';
export const DETAIL_FORMAT = 'ringnote-detail';
export const ANALYSIS_VERSION = 1;

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const round = (v, digits) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** digits) / 10 ** digits);
// 設定値には Infinity が入っている。JSON にすると null になって意味が変わるので、文字で残す
const jsonSafe = (obj) => JSON.parse(JSON.stringify(obj, (k, v) => (v === Infinity ? 'Infinity' : v)));

function metricBlock(m) {
  const base = m.base && m.base.ready ? m.base : null;
  return {
    value: m.value ?? null,
    baseline_median: base ? base.median : null,
    baseline_spread: base ? round(base.spread, 4) : null,
    baseline_nights: m.base ? m.base.n : 0,
    diff: m.dev ? round(m.dev.diff, 4) : null,
    ratio: m.dev && m.dev.pct != null ? round(m.dev.pct, 4) : null,
    z: m.dev ? round(m.dev.z, 3) : null,
  };
}

function dayBlock(date, raw, day, r, record, night) {
  const out = { date, soxai_daily: raw || null, lifelog: record || null };
  if (!day || !r) return { ...out, computed: null };
  const metrics = {};
  for (const [key, m] of Object.entries(r.metrics)) metrics[key] = metricBlock(m);
  const radar = r.radar;
  out.computed = {
    night: {
      class: r.night.class, baseline_eligible: r.night.baselineEligible,
      sleep_start: iso(day.sleepStart), sleep_end: iso(day.sleepEnd), utc_offset_minutes: day.offset,
      night_skin_temp_median: day.nightTemp, night_odi_mean: day.nightOdi, min_hr_position: day.minHrPos, coverage: day.nightCoverage,
      stage_minutes: night && night.stageMinutes ? night.stageMinutes : null,
    },
    lifelog_derived: record ? {
      energy_caffeine_mg: energyCaffeineMg(record),
      caffeine_last_at: iso(lastTimeAt(day, 'caffeineLast')),
      iqos_last_at: iso(lastTimeAt(day, 'iqosLast')),
      iqos_minutes_before_sleep: iqosGapMin(day),
    } : null,
    learning_stage: r.stage.key, baseline_nights: r.stage.nights,
    confidence: { level: r.confidence.level, reasons: r.confidence.reasons },
    metrics,
    sleep: {
      debt_status: r.sleep.debt.status, debt_minutes: r.sleep.debt.minutes ?? null, debt_band: r.sleep.debt.band ?? null,
      regularity_sd_minutes: r.sleep.regularity.sdMin ?? null, weekend_gap_minutes: r.sleep.weekendGapMin ?? null, need_minutes: r.sleep.needMin,
    },
    condition: r.recovery.status === 'ok'
      ? { status: 'ok', score: r.recovery.score, band: r.recovery.band, label: r.recovery.label, components: r.recovery.components, missing: r.recovery.missing }
      : { status: r.recovery.status, score: null },
    radar: {
      status: radar.status, level: radar.level, label: radar.label, returned: !!radar.returned, consecutive: !!radar.consecutive,
      flagged_systems: radar.flagged ?? null,
      systems: radar.systems ? Object.fromEntries(Object.entries(radar.systems).map(([k, s]) => [k, { flagged: s.flagged, score: s.score, signals: s.signals.map((x) => ({ metric: x.metric, degree: x.degree })) }])) : null,
    },
    guidance: { level: r.guidance.level, label: r.guidance.label, based_on: r.guidance.basedOn, reasons: r.guidance.reasons },
  };
  return out;
}

/**
 * 日ごとのデータを、日付で結合して書き出す。
 * @param {object} p
 * @param {Object<string,object>} p.rawDaily  日付 → SOXAI の日次レコード（届いた形のまま）
 * @param {Map} p.days      prepareDays() の戻り値
 * @param {Map} p.results   analyzeAll() の戻り値
 * @param {Object<string,object>} p.subjective 日付 → 主観入力・生活ログ
 * @param {Object<string,object>} [p.nights]   日付 → 夜の派生値
 * @param {object} [p.settings] { sleepNeedMin }
 * @param {object} [p.meta]     { exportedAt, timezone, utcOffsetMinutes, appVersion }
 */
export function buildAnalysisExport({ rawDaily, days, results, subjective, nights = {}, settings = {}, meta = {}, cfg = CONFIG }) {
  const dates = new Set([...Object.keys(rawDaily || {}), ...Object.keys(subjective || {})]);
  const list = [...dates].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return {
    format: ANALYSIS_FORMAT,
    schema_version: ANALYSIS_VERSION,
    exported_at: meta.exportedAt ?? null,
    timezone: meta.timezone ?? null,
    utc_offset_minutes: meta.utcOffsetMinutes ?? null,
    app_version: meta.appVersion ?? null,
    notes: [
      '日付は、睡眠が終わった朝の日付（SOXAI の日次データの日付）。',
      'soxai_daily は SOXAI から届いた値そのまま。SOXAI は「データなし」を 0 で返す項目がある（dictionary.soxai_daily の zero を参照）。',
      'lifelog は入力した値そのまま。未入力の項目はキーが無い（「なし」や 0 とは別）。前日・昨夜の行動の項目は、その前日のこと。',
      'computed はこのアプリが計算した値。metrics の diff / ratio / z は、その夜より前の28日の自分の平常値との差。',
      '相関を見るための材料であり、原因を示すものではない。診断を目的としたものではない。',
    ],
    settings: { sleep_need_minutes: settings.sleepNeedMin ?? cfg.sleep.needMin, sleep_need_is_provisional: settings.sleepNeedMin == null },
    config: jsonSafe(cfg),
    dictionary: {
      soxai_daily: Object.fromEntries(Object.entries(DAILY_FIELDS).map(([k, f]) => [k, { label: f.ja, zero: f.zero }])),
      lifelog: Object.fromEntries(Object.entries(SUBJECTIVE_FIELDS).map(([k, f]) => [k, f.kind === 'count'
        ? { label: f.label, group: f.group, kind: 'count', unit: f.unit }
        : { label: f.label, group: f.group, options: f.options.map(([value, label]) => ({ value, label })) }])),
      cold_symptoms: COLD_SYMPTOMS.map(([value, label]) => ({ value, label })),
      metrics: Object.fromEntries(Object.entries(cfg.metrics).map(([k, m]) => [k, { label: m.label, unit: m.unit, source: m.source, better: m.better }])),
    },
    days: list.map((date) => dayBlock(date, rawDaily ? rawDaily[date] : null, days.get(date), results.get(date), sanitizeSubjective((subjective || {})[date]), nights[date])),
  };
}

function csvCell(v) {
  const s = v == null ? '' : Array.isArray(v) ? v.join('|') : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 同じ内容を、1行が1日の表（CSV）にする。列の名前は英字（項目名そのまま）。
 * 列: date / soxai_* （届いた項目すべて）/ lifelog_* / 計算した値
 */
export function analysisExportCsv(exp) {
  const rawKeys = new Set();
  for (const d of exp.days) for (const k of Object.keys(d.soxai_daily || {})) rawKeys.add(k);
  const raws = [...rawKeys].sort();
  const life = [...Object.keys(SUBJECTIVE_FIELDS), 'coldSymptoms', 'caffeineLast', 'iqosLast'];
  const metricKeys = Object.keys(exp.dictionary.metrics);
  const header = ['date', ...raws.map((k) => `soxai_${k}`), ...life.map((k) => `lifelog_${k}`),
    'night_class', 'baseline_eligible', 'night_skin_temp_median', 'night_odi_mean', 'min_hr_position', 'iqos_minutes_before_sleep', 'energy_caffeine_mg',
    ...metricKeys.flatMap((k) => [`${k}_value`, `${k}_baseline`, `${k}_diff`, `${k}_z`]),
    'sleep_debt_minutes', 'condition_score', 'condition_band', 'radar_status', 'radar_level', 'radar_flagged_systems', 'guidance_level'];
  const lines = [header.map(csvCell).join(',')];
  for (const d of exp.days) {
    const c = d.computed;
    lines.push([
      d.date,
      ...raws.map((k) => (d.soxai_daily ? d.soxai_daily[k] : null)),
      ...life.map((k) => (d.lifelog ? d.lifelog[k] : null)),
      c ? c.night.class : null, c ? c.night.baseline_eligible : null, c ? c.night.night_skin_temp_median : null, c ? c.night.night_odi_mean : null, c ? c.night.min_hr_position : null,
      c && c.lifelog_derived ? c.lifelog_derived.iqos_minutes_before_sleep : null, c && c.lifelog_derived ? c.lifelog_derived.energy_caffeine_mg : null,
      ...metricKeys.flatMap((k) => { const m = c ? c.metrics[k] : null; return m ? [m.value, m.baseline_median, m.diff, m.z] : [null, null, null, null]; }),
      c ? c.sleep.debt_minutes : null, c ? c.condition.score : null, c ? c.condition.band ?? null : null,
      c ? c.radar.status : null, c ? c.radar.level : null, c ? c.radar.flagged_systems : null, c ? c.guidance.level : null,
    ].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * 5分ごとのデータを、別のファイルとして書き出す。行は SOXAI から届いた形のまま。
 * @param {{date:string, rows:object[], fetchedAt?:number, complete?:boolean}[]} dayRows
 * @param {string[]} [missing] 取得できなかった日（黙って落とさず、ファイルに書いておく）
 */
export function buildDetailExport(dayRows, { meta = {}, missing = [] } = {}) {
  return {
    format: DETAIL_FORMAT,
    schema_version: ANALYSIS_VERSION,
    exported_at: meta.exportedAt ?? null,
    timezone: meta.timezone ?? null,
    utc_offset_minutes: meta.utcOffsetMinutes ?? null,
    notes: [
      '行は SOXAI から届いた5分ごとの値そのまま。_time は、各5分枠の「終わり」の時刻。',
      '1日は、現地時間の 0:00 以上 24:00 未満に _time が入る行。',
      'complete が false の日は、直近の日（リングの同期が後から行われると、行が増えたり値が直ったりすることがある）。',
    ],
    dictionary: Object.fromEntries(Object.entries(DETAIL_FIELDS).map(([k, f]) => [k, { label: f.ja, zero: f.zero }])),
    missing_dates: [...missing].sort(),
    days: [...dayRows].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => ({
      date: d.date, complete: !!d.complete, fetched_at: d.fetchedAt ? new Date(d.fetchedAt).toISOString() : null, rows: d.rows,
    })),
  };
}
