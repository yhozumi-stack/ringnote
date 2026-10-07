// 欠損の判定（設計書 1.1）と、API の応答を分析用の形に直す処理。
// 「0 をどう扱うか」は fields.js の定義だけを見る。ここに項目名ごとの特例は書かない。

import { DAILY_FIELDS, DETAIL_FIELDS } from './fields.js';
import { toNum, toMs, localMidnightMs } from './util.js';

const DAILY_NUMERIC = Object.keys(DAILY_FIELDS).filter((k) => DAILY_FIELDS[k].zero !== 'NA');
// 「装着日」の判定に使う項目（設計書 1.1）。基礎代謝は未装着でも入るので使わない
const WORN_SIGNALS = ['health_hr_day_mean', 'health_hrv_day_mean', 'health_spo2', 'health_temperature'];

/**
 * 日次レコード1件を正規化する。
 * 戻り値の v[項目名] は、欠損なら null、有効なら数値（0 が本物の値なら 0 のまま）。
 */
export function normalizeDaily(raw) {
  const date = String(raw._time || '').slice(0, 10);
  const num = {};
  for (const k of DAILY_NUMERIC) num[k] = toNum(raw[k]);

  const hasNight = (num.sleep_total_sleep_time ?? 0) > 0;
  const worn = hasNight || WORN_SIGNALS.some((k) => (num[k] ?? 0) > 0) || (num.activity_steps ?? 0) > 0;

  const v = {};
  for (const k of DAILY_NUMERIC) {
    let x = num[k];
    if (x === 0) {
      switch (DAILY_FIELDS[k].zero) {
        case 'MISS':
        case 'MISS_TBD': x = null; break;
        case 'NIGHT': if (!hasNight) x = null; break;
        case 'WORN': if (!worn) x = null; break;
        default: break; // CODE / ANY は 0 のまま
      }
    } else if (x != null && DAILY_FIELDS[k].zero === 'NIGHT' && !hasNight) {
      x = null; // 夜の記録が無いのに夜の項目だけ値がある場合は使わない
    }
    v[k] = x;
  }
  // 睡眠効率は、実データでは 0〜1 の比率で返る（仕様書の単位は %）。% にそろえる
  if (v.sleep_efficiency != null && v.sleep_efficiency <= 1.5) v.sleep_efficiency = Math.round(v.sleep_efficiency * 10000) / 100;

  const offset = toNum(raw.utc_offset_mins) ?? 540;
  let sleepStart = hasNight ? toMs(raw.sleep_start_time_true) : null;
  let sleepEnd = hasNight ? toMs(raw.sleep_end_time_true) : null;
  if (sleepStart == null || sleepEnd == null || sleepEnd <= sleepStart) { sleepStart = null; sleepEnd = null; }
  const midnight = /^\d{4}-\d{2}-\d{2}$/.test(date) ? localMidnightMs(date, offset) : null;

  return {
    date,
    offset,
    mlVer: raw.ML_ver != null ? String(raw.ML_ver) : null,
    fwVer: raw.fw_ver != null ? String(raw.fw_ver) : null,
    v,
    hasNight,
    worn,
    sleepStart,
    sleepEnd,
    // 睡眠の中央時刻（その日の0時からの分。前日のうちなら負の値）
    midSleepMin: sleepStart != null && midnight != null ? Math.round(((sleepStart + sleepEnd) / 2 - midnight) / 60000) : null,
    // 5分データから作る派生値（features.js が埋める。5分データが無ければ null のまま）
    nightTemp: null,
    nightOdi: null,
    minHrPos: null,
    nightCoverage: null,
    // 主観入力（任意。呼び出し側が渡す）
    subjective: null,
  };
}

const DETAIL_MAP = {
  hr: 'health_hr', hrv: 'health_hrv', spo2: 'health_spo2', stress: 'health_stress', temp: 'health_T',
  steps: 'activity_steps', kcal: 'activity_calorie', mets: 'activity_mets', type: 'activity_type',
  sHr: 'sleep_hr', sHrv: 'sleep_hrv', sSpo2: 'sleep_spo2', stage: 'sleep_stage', resp: 'sleep_respiration', odi: 'sleep_odi',
};

/**
 * 1分ごとの睡眠ステージを読む。5分ぶんが数字5桁で届く（例: 33111）。
 * 数値として届くので先頭の 0 が落ちている（00003 は 3 になる）。5桁に戻して1分ずつの配列にする。
 */
export function decodeStage1min(raw) {
  const n = toNum(raw);
  if (n == null || n < 0 || n > 99999 || !Number.isInteger(n)) return null;
  return [...String(n).padStart(5, '0')].map(Number);
}

/**
 * 5分データ1件を正規化する。
 * 「装着中」= その枠に心拍が入っている。「夜の枠」= 睡眠ステージが入っている。
 */
export function normalizeEpoch(raw) {
  const t = toMs(raw._time);
  if (t == null) return null;
  const num = {};
  for (const [short, key] of Object.entries(DETAIL_MAP)) num[short] = toNum(raw[key]);
  const worn = (num.hr ?? 0) > 0 || (num.sHr ?? 0) > 0;
  const inNight = num.stage != null;
  const e = { t };
  for (const [short, key] of Object.entries(DETAIL_MAP)) {
    let x = num[short];
    if (x === 0) {
      switch (DETAIL_FIELDS[key].zero) {
        case 'MISS':
        case 'MISS_TBD': x = null; break;
        case 'NIGHT': if (!inNight) x = null; break;
        case 'WORN': if (!worn) x = null; break;
        default: break; // CODE（睡眠ステージの 0 = 深い睡眠 など）は 0 のまま
      }
    }
    e[short] = x;
  }
  e.stage1 = inNight ? decodeStage1min(raw.sleep_stage_1min) : null;
  e.worn = worn;
  return e;
}

/** 5分データの配列を正規化し、時刻順に並べて重複を除く */
export function normalizeEpochs(rawRows) {
  const byT = new Map();
  for (const r of rawRows || []) {
    const e = normalizeEpoch(r);
    if (e) byT.set(e.t, e);
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}
