// デモ表示用の架空データ。
// 実データがまだ少ない時期に、画面の完成形を確認するためだけに使う。
// ここで作る値はすべて乱数による作り物で、端末にも保存しない（メモリ上だけ）。
// 形は、実アカウントで確認した SOXAI の応答に合わせてある（睡眠効率は 0〜1 の比率、
// 睡眠ステージは 0深い 1浅い 2レム 3覚醒、5分データの時刻は枠の終わり、活動の種類は無し）。

import { addDays, localMidnightMs } from './ui.js';

const OFFSET = 540;
const DAYS = 45;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r, mean, sd) {
  const u = Math.max(r(), 1e-9);
  const v = r();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function ordinal(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function iso(ms) {
  const d = new Date(ms + OFFSET * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00+09:00`;
}

/** デモの筋書き: 5〜3日前に体調を崩し、その後は戻っている。昨日は寝不足。それ以外に、数日おきに飲酒の夜がある */
function scenario(date, today) {
  const age = ordinal(today) - ordinal(date);
  if (age >= 3 && age <= 5) return 'sick';
  if (age === 1) return 'short';
  if (age >= 7 && ordinal(date) % 5 === 1) return 'drink';
  return 'normal';
}

function worn(date, today) {
  const age = ordinal(today) - ordinal(date);
  if (age < 0 || age > DAYS) return false;
  if (age <= 7) return true;
  return rng(ordinal(date) * 13 + 7)() > 0.06;
}

/**
 * 前日・昨夜の行動（作り物）。記録する日付は、その行動の翌朝。
 * 夕方以降のカフェインで寝つきが悪くなる、強い筋トレの翌朝は心拍変動が少し下がる、という筋書きにしてある。
 */
function lifestyle(date, today) {
  const o = ordinal(date);
  const r = rng(o * 97 + 11);
  const sc = scenario(date, today);
  const weekday = new Date(o * 86400000).getUTCDay();
  const training = sc === 'sick' ? 'none' : ['hard', 'none', 'normal', 'light', 'hard', 'none', 'normal'][weekday];
  const coffee = Math.max(0, Math.round(gauss(r, 2.2, 1.2)));  // 実際の杯数（多い日は5〜6杯になる）
  const pick = r();
  const energy = pick < 0.03 ? 4 : pick < 0.08 ? 2 : pick < 0.32 ? 1 : 0;
  const lateRoll = r();
  const slot = r();
  const half = r() < 0.5 ? '00' : '30';
  const hour = coffee + energy === 0 ? null : lateRoll < 0.35 ? 16 + Math.floor(slot * 5) : 9 + Math.floor(slot * 6);
  const mentalRoll = r();
  const mental = sc === 'sick' ? 'normal' : mentalRoll < 0.2 ? 'high' : mentalRoll < 0.5 ? 'low' : 'normal';
  // IQOS: 1日10本前後。寝る直前まで吸う日と、早めに切り上げる日がある
  const iqos = sc === 'sick' ? Math.max(0, Math.round(gauss(r, 3, 2))) : Math.max(0, Math.round(gauss(r, 10, 3)));
  const iqosRoll = r();
  const iqosMinute = Math.floor(r() * 6) * 10;
  const iqosHour = iqos === 0 ? null : iqosRoll < 0.45 ? 23 : iqosRoll < 0.75 ? 22 : 20 + Math.floor(iqosRoll * 2);
  const iqosLast = iqosHour == null ? null : `${iqosHour}:${String(iqosMinute).padStart(2, '0')}`;
  return { training, coffee, energy, hour, last: hour == null ? null : `${String(hour).padStart(2, '0')}:${half}`, late: hour != null && hour >= 16, mental,
    iqos, iqosLast, iqosLate: iqosHour === 23 };
}

function sleepPlan(date, today) {
  const o = ordinal(date);
  const r = rng(o * 17 + 1);
  const sc = scenario(date, today);
  const weekday = new Date(o * 86400000).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const startMin = Math.round(gauss(r, weekend ? 24 * 60 + 20 : 23 * 60 + 35, 25)) + (sc === 'short' ? 95 : 0);
  const totalBase = sc === 'short' ? 300 : weekend ? 455 : 420;
  const deep = Math.max(25, Math.round(gauss(r, sc === 'sick' ? 55 : 80, 14)));
  const rem = Math.max(35, Math.round(gauss(r, 92, 18)));
  const total = Math.max(240, Math.round(gauss(r, totalBase, 28)));
  const light = Math.max(80, total - deep - rem);
  const life = lifestyle(date, today);
  const awake = Math.max(6, Math.round(gauss(r, sc === 'sick' ? 48 : 26, 8))) + (life.late ? 9 : 0);
  const latency = Math.max(2, Math.round(gauss(r, 12, 4))) + (life.late ? 10 : 0) + (life.mental === 'high' ? 4 : 0) + (life.iqosLate ? 5 : 0);
  const start = localMidnightMs(addDays(date, -1), OFFSET) + Math.round(startMin / 5) * 5 * 60000;
  const tib = deep + rem + light + awake;
  return { start, end: start + Math.round(tib / 5) * 5 * 60000, deep, rem, light, awake, latency, total: deep + rem + light, tib };
}

function dailyRow(date, today) {
  const base = { _time: `${date}T00:00:00+00:00`, ML_ver: 'demo', fw_ver: 0, utc_offset_mins: OFFSET, activity_ree_calories: 1574.52 };
  if (!worn(date, today)) {
    return { ...base, qol_score: 0, sleep_score: 0, health_score: 0, activity_score: 0, activity_steps: 0, activity_calories: 0, activity_mets: 0,
      sleep_total_sleep_time: 0, sleep_time_in_bed: 0, health_hr_day_mean: 0, health_temperature: 0, sleep_efficiency: 0 };
  }
  const o = ordinal(date);
  const r = rng(o * 31 + 3);
  const sc = scenario(date, today);
  const sp = sleepPlan(date, today);
  const sick = sc === 'sick';
  const drink = sc === 'drink';
  const life = lifestyle(date, today);
  const hard = life.training === 'hard';
  const hr = Math.round(gauss(r, (sick ? 61 : drink ? 58 : 54) + (hard ? 1.5 : 0) + (life.iqosLate ? 1.5 : 0), 1.6));
  const hrv = Math.round(gauss(r, (sick ? 44 : drink ? 53 : 62) - (hard ? 5 : 0) - (life.energy ? 2 : 0), 4.5));
  const clamp = (v, lo, hi) => Math.round(Math.max(lo, Math.min(hi, v)));
  const eff = sp.total / sp.tib;
  const sleepScore = clamp(gauss(r, 60 + (sp.total - 360) / 5 + (eff * 100 - 88) - (sick ? 8 : 0), 4), 30, 98);
  const frac = date === today ? 0.3 : 1;
  const steps = Math.round(Math.max(400, gauss(r, sick ? 4200 : 8200, 1900)) * frac);
  // 「昨日の精神的ストレス」は翌朝の記録に入るので、その日の SOXAI のストレス値は、翌朝の記録と対応させる
  const felt = lifestyle(addDays(date, 1), today).mental;
  const stress = clamp(gauss(r, (sick ? 46 : 30) + (felt === 'high' ? 9 : felt === 'low' ? -3 : 0), 5), 6, 90);
  return {
    ...base,
    qol_score: clamp(sleepScore * 0.45 + (sick ? 58 : 84) * 0.55, 20, 99),
    sleep_score: sleepScore, health_score: clamp(gauss(r, sick ? 62 : 86, 4), 30, 99),
    activity_score: date === today ? 0 : clamp(gauss(r, 40 + steps / 220, 6), 15, 98),
    activity_steps: steps, activity_calories: Math.round(steps * 0.045 + gauss(r, 50, 15)), activity_mets: date === today ? 0 : Math.round((1.2 + steps / 20000) * 100) / 100,
    health_hr_day_mean: hr + 14, health_hr_day_max: Math.round(gauss(r, 116, 10)), health_hr_day_min: hr - 3,
    health_hrv_day_mean: Math.round(hrv * 0.8), health_hrv_day_max: hrv + 40, health_hrv_day_min: Math.round(hrv * 0.45),
    health_spo2: Math.round(gauss(r, 96.4, 0.5) * 10) / 10, health_spo2_max: 99, health_spo2_min: Math.round(gauss(r, 92.5, 1) * 10) / 10,
    health_stress: stress, health_stress_max: Math.min(98, stress + 36), health_stress_min: Math.max(1, stress - 24),
    health_temperature: Math.round(gauss(r, sick ? 34.6 : 34.1, 0.2) * 100) / 100, health_temperature_max: 35.4, health_temperature_min: 32.2,
    health_bodytemperature: null, health_bodytemperature_max: null, health_bodytemperature_min: null,
    sleep_time_in_bed: sp.tib, sleep_total_sleep_time: sp.total, sleep_awake_time: sp.awake,
    sleep_rem_sleep_time: sp.rem, sleep_light_sleep_time: sp.light, sleep_deep_sleep_time: sp.deep,
    sleep_nap_time: 0, sleep_latency: sp.latency, sleep_efficiency: Math.round(eff * 1e10) / 1e10,
    sleep_start_time_true: iso(sp.start), sleep_end_time_true: iso(sp.end),
    sleep_hr_mean: hr, sleep_hr_min: hr - 4, sleep_hr_max: hr + 9,
    sleep_hrv_mean: hrv, sleep_hrv_min: Math.max(12, hrv - 24), sleep_hrv_max: hrv + 34,
    sleep_spo2_mean: Math.round(gauss(r, sick ? 95.2 : 96.8, 0.4)), sleep_spo2_min: 93, sleep_spo2_max: 99,
    sleep_ahi_class: Math.round(gauss(r, 9, 3)), sleep_respiration_rate_mean: Math.round(gauss(r, sick ? 15.6 : 13.6, 0.35) * 10) / 10,
  };
}

/** 日付 → 生レコード の対応表（API の応答と同じ形） */
export function demoDaily(today) {
  const out = {};
  for (let i = DAYS; i >= 0; i--) {
    const date = addDays(today, -i);
    out[date] = dailyRow(date, today);
  }
  return out;
}

/** 夜ごとの派生値（本来は5分データから作る値）。デモでは直接作る */
export function demoNights(today) {
  const out = {};
  for (let i = 30; i >= 0; i--) {
    const date = addDays(today, -i);
    if (!worn(date, today)) continue;
    const r = rng(ordinal(date) * 53 + 9);
    const sc = scenario(date, today);
    const sick = sc === 'sick';
    const sp = sleepPlan(date, today);
    out[date] = {
      nightTemp: Math.round(gauss(r, sick ? 35.45 : sc === 'drink' ? 35.0 : 34.85, 0.1) * 100) / 100,
      nightOdi: Math.round(Math.max(0, gauss(r, sc === 'drink' ? 0.9 : 0.5, 0.2)) * 100) / 100,
      minHrPos: Math.round(Math.max(0.1, Math.min(0.95, gauss(r, sick ? 0.8 : 0.45, 0.12))) * 100) / 100,
      nightCoverage: 0.98,
      stageMinutes: { deep: sp.deep, light: sp.light, rem: sp.rem, awake: sp.awake, other: 0 },
      unknownStages: [],
    };
  }
  return out;
}

/**
 * 主観入力・生活ログのデモ。直近40日ぶん（今日は空けてあり、自分で入力を試せる）。
 * ところどころ未入力の項目を混ぜてある（未入力が比較に入らないことを見せるため）。
 */
export function demoSubjective(today) {
  const out = {};
  for (let i = 40; i >= 1; i--) {
    const date = addDays(today, -i);
    if (!worn(date, today)) continue;
    const sc = scenario(date, today);
    const life = lifestyle(date, today);
    const r = rng(ordinal(date) * 29 + 3);
    const sick = sc === 'sick';
    const tired = sc === 'short' || sc === 'drink';
    const rec = {
      condition: sick ? 'bad' : tired ? 'normal' : r() < 0.55 ? 'good' : 'normal',
      fatigue: sick || sc === 'short' ? 'high' : life.training === 'hard' && r() < 0.5 ? 'high' : r() < 0.5 ? 'low' : 'normal',
      soreness: life.training === 'hard' ? (r() < 0.8 ? 'high' : 'normal') : life.training === 'normal' ? 'normal' : 'low',
      cold: sick ? 'yes' : 'none',
      mental: life.mental,
      alcohol: sc === 'drink' ? (ordinal(date) % 2 ? 'some' : 'much') : 'none',
      training: life.training,
      coffee: life.coffee,
      energy: life.energy,
      iqos: life.iqos,
    };
    if (sick) rec.coldSymptoms = ['throat', 'malaise'];
    if (life.last) rec.caffeineLast = life.last;
    if (life.iqosLast) rec.iqosLast = life.iqosLast;
    // 入れ忘れの日を再現する
    if (r() < 0.12) { delete rec.mental; delete rec.soreness; }
    if (r() < 0.1) { delete rec.energy; delete rec.caffeineLast; }
    if (r() < 0.1) { delete rec.iqos; delete rec.iqosLast; }
    out[date] = rec;
  }
  return out;
}

// ---------------------------------------------------------------- 5分ごとの記録（作り物）
const STAGE_CODE = { deep: 0, light: 1, rem: 2, awake: 3 };
const planCache = new Map();

/** その夜の睡眠ステージの並び（5分枠ごと）。合計が日次の内訳とおおよそ合うように作る */
function nightPlan(date, today) {
  const key = `${date}|${today}`;
  if (planCache.has(key)) return planCache.get(key);
  let plan = null;
  if (worn(date, today)) {
    const sp = sleepPlan(date, today);
    const row = dailyRow(date, today);
    const n = Math.round((sp.end - sp.start) / 300000);
    const r = rng(ordinal(date) * 71 + 5);
    const total = { deep: Math.round(sp.deep / 5), rem: Math.round(sp.rem / 5), awake: Math.max(1, Math.round(sp.awake / 5)) };
    total.light = Math.max(0, n - total.deep - total.rem - total.awake);
    const cycles = Math.max(3, Math.round(n / 18));
    const wSum = (cycles * (cycles + 1)) / 2;
    const seq = [];
    const left = { ...total };
    const take = (name, k) => { const c = Math.max(0, Math.min(left[name], Math.round(k))); left[name] -= c; for (let i = 0; i < c; i++) seq.push(name); };
    for (let c = 0; c < cycles; c++) {
      const last = c === cycles - 1;
      const light = last ? left.light : total.light / cycles;
      take('light', light / 2);
      take('deep', last ? left.deep : (total.deep * (cycles - c)) / wSum); // 深い睡眠は前半に多い
      take('light', last ? left.light : light / 2);
      take('rem', last ? left.rem : (total.rem * (c + 1)) / wSum);          // レム睡眠は後半に多い
    }
    // 途中で起きていた時間: 寝入りばなに1枠、残りはばらばらの位置に差し込む
    seq.unshift('awake');
    for (let i = 1; i < total.awake; i++) seq.splice(1 + Math.floor(r() * (seq.length - 1)), 0, 'awake');
    while (seq.length < n) seq.push('light');
    seq.length = n;
    plan = { sp, row, seq };
  }
  planCache.set(key, plan);
  return plan;
}

/**
 * 5分ごとの記録を、API の応答と同じ形で作る。startMs より後、endMs 以下の枠（時刻は枠の終わり）。
 * 今より先の枠は作らない。
 */
export function demoDetail(startMs, endMs, today) {
  const rows = [];
  const now = Date.now();
  const first = Math.floor(startMs / 300000) * 300000 + 300000;
  for (let t = first; t <= endMs && t <= now; t += 300000) {
    const local = new Date(t + OFFSET * 60000);
    const date = local.toISOString().slice(0, 10);
    const r = rng(Math.floor(t / 300000));
    let plan = null;
    for (const cand of [date, addDays(date, 1)]) {
      const p = nightPlan(cand, today);
      if (p && t > p.sp.start && t <= p.sp.end) { plan = p; break; }
    }
    const base = { _time: new Date(t).toISOString().replace('.000Z', '+00:00'), utc_offset_mins: OFFSET };
    if (plan) {
      const { sp, row, seq } = plan;
      const idx = Math.min(seq.length - 1, Math.round((t - sp.start) / 300000) - 1);
      const frac = (t - sp.start) / (sp.end - sp.start);
      const stage = seq[idx];
      const dip = Math.sin(Math.min(1, frac * 1.15) * Math.PI); // 夜の中ほどで心拍が下がり、心拍変動が上がる
      const hr = Math.round(row.sleep_hr_mean + 5 - 8 * dip + gauss(r, 0, 1.4) + (stage === 'awake' ? 5 : 0));
      const hrv = Math.max(10, Math.round(row.sleep_hrv_mean - 9 + 14 * dip + gauss(r, 0, 4.5)));
      const odi = r() < 0.07 ? 1 + Math.floor(r() * 3) : 0;
      rows.push({ ...base,
        health_hr: hr, health_hrv: hrv, health_spo2: Math.round(gauss(r, row.sleep_spo2_mean, 0.8) * 10) / 10,
        health_stress: Math.max(1, Math.round(gauss(r, 14, 4))), health_T: Math.round((row.health_temperature + 0.7 + 0.4 * dip + gauss(r, 0, 0.08)) * 100) / 100,
        sleep_hr: hr, sleep_hrv: hrv,
        sleep_spo2: stage === 'awake' ? null : Math.round((gauss(r, row.sleep_spo2_mean, 0.8) - odi * 0.9) * 10) / 10,
        sleep_stage: STAGE_CODE[stage], sleep_stage_1min: Number(String(STAGE_CODE[stage]).repeat(5)),
        sleep_odi: odi, sleep_respiration: Math.round(gauss(r, row.sleep_respiration_rate_mean, 0.6) * 10) / 10,
        activity_steps: 0, activity_calorie: 0, activity_mets: 1.0 });
      continue;
    }
    if (!worn(date, today)) continue;
    const row = dailyRow(date, today);
    const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
    const active = hour >= 7 && hour <= 22 ? Math.max(0, Math.sin(((hour - 7) / 15) * Math.PI)) : 0;
    const training = hour >= 7.5 && hour < 8.25;                 // 朝の筋力トレーニング
    const walking = !training && r() < 0.015 + 0.03 * active;
    const meeting = hour >= 14 && hour < 15.5;                    // 午後に負荷の高い時間帯がある想定
    const steps = walking ? Math.round(Math.max(260, gauss(r, 420, 90))) : training ? Math.round(Math.max(0, gauss(r, 40, 20))) : Math.round(Math.max(0, gauss(r, 6, 8)) * active);
    const hr = Math.round(row.sleep_hr_mean + 12 + 7 * active + (training ? 34 : walking ? 22 : 0) + (meeting ? 6 : 0) + gauss(r, 0, 3));
    rows.push({ ...base,
      health_hr: hr, health_hrv: Math.max(8, Math.round(gauss(r, row.sleep_hrv_mean * 0.62 - 6 * active - (meeting ? 8 : 0), 6))),
      health_spo2: Math.round(gauss(r, 97.2, 0.7) * 10) / 10,
      health_stress: Math.max(1, Math.min(100, Math.round(gauss(r, row.health_stress - 8 + 16 * active + (meeting ? 22 : 0), 9)))),
      health_T: Math.round((row.health_temperature - 1.2 + 1.1 * active + gauss(r, 0, 0.25)) * 100) / 100,
      activity_steps: steps, activity_calorie: Math.round(steps * 0.045 * 10) / 10, activity_mets: training ? 4.2 : walking ? 3.4 : Math.round((1.1 + 0.3 * active) * 100) / 100,
      sleep_hr: null, sleep_hrv: null, sleep_spo2: null, sleep_stage: null, sleep_respiration: null });
  }
  return rows;
}
