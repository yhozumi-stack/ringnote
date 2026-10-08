// 主観入力・生活ログ（設計書 5.3）。
//
// 2つのまとまりがある。どちらも「今朝の日付」の1件の記録に保存する（今朝の日付 = 昨夜の睡眠記録の日付）。
// - 今日の状態（今朝のこと）: 体調・疲労感・筋肉痛・風邪っぽい症状
// - 前日・昨夜の行動（昨夜の睡眠記録に紐付ける）: 昨日の精神的ストレス・飲酒・前日の筋トレ負荷（と終えた時刻）・カフェイン・IQOS
//
// 決まり:
// - 「未入力」は独立した状態。押していない項目は、記録にキーを持たせない。「なし」「普通」「0杯」とはみなさない。
// - 杯数・本数は、実際の数を整数で保存する（「4杯以上」のように丸めない）。区分は集計の時に計算するだけ。
// - どの項目も、コンディションの点数と体調変化の検出には混ぜない。
// - 今日の運動の目安に反映するのは、config.js の guidance.subjective にあるものだけ。

import { CONFIG } from './config.js';
import { addDays, localMidnightMs } from './util.js';

export const FIELD_GROUPS = [
  { key: 'state', label: '今日の状態' },
  { key: 'behavior', label: '前日・昨夜の行動' },
];

// options は [値, 画面の短い表記]。long は、要約や書き出しで使う長い表記（省略時は短い表記と同じ）
// kind: 'count' は、選択肢ではなく杯数・本数を数で入れる項目（未入力と 0 を別に扱う）。
// quick は、1タップで入れられる数。それより多い時は、数を直接入れる（保存するのは常に実際の数）
export const SUBJECTIVE_FIELDS = {
  condition: { group: 'state', label: '体調', options: [['good', '良い'], ['normal', '普通'], ['bad', '悪い']] },
  fatigue: { group: 'state', label: '疲労感', options: [['low', '少ない'], ['normal', '普通'], ['high', '強い']] },
  // 筋肉痛は「まったく無い」日がふつうなので、「なし」と「少ない」を分ける（2026-10-08 に4段階にした。それ以前の「少ない」には「なし」の日も含まれる）
  soreness: { group: 'state', label: '筋肉痛', options: [['none', 'なし'], ['low', '少ない'], ['normal', '普通'], ['high', '強い']] },
  cold: { group: 'state', label: '風邪っぽい症状', options: [['none', 'なし'], ['slight', '少し'], ['yes', 'あり']] },
  mental: { group: 'behavior', label: '昨日の精神的ストレス', short: '昨日のストレス', options: [['low', '低い'], ['normal', '普通'], ['high', '高い']] },
  alcohol: { group: 'behavior', label: '飲酒', options: [['none', 'なし'], ['some', '少量'], ['much', '多め']] },
  training: { group: 'behavior', label: '前日の筋トレ負荷', options: [['none', 'なし'], ['light', '軽い'], ['normal', '普通'], ['hard', '強い']] },
  coffee: { group: 'behavior', label: 'コーヒー', unit: '杯', kind: 'count', min: 0, max: 99, quick: [0, 1, 2, 3] },
  energy: { group: 'behavior', label: 'エナジードリンク', unit: '本', kind: 'count', min: 0, max: 99, quick: [0, 1, 2] },
  iqos: { group: 'behavior', label: 'IQOS', unit: '本', kind: 'count', min: 0, max: 99 },
};

/** 風邪っぽい症状の中身（任意・複数選択）。症状を「少し」「あり」にした時だけ聞く */
export const COLD_SYMPTOMS = [['throat', '喉'], ['nose', '鼻'], ['cough', '咳'], ['fever', '熱っぽさ'], ['malaise', 'だるさ'], ['headache', '頭痛']];

const SYMPTOM_KEYS = COLD_SYMPTOMS.map(([k]) => k);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 選択肢の表記。long=true で長い表記（「2杯」など） */
export function optionLabel(field, value, { long = false } = {}) {
  const def = SUBJECTIVE_FIELDS[field];
  if (!def) return null;
  if (def.kind === 'count') return validCount(def, value) ? `${value}${def.unit}` : null;
  const i = def.options.findIndex(([v]) => v === value);
  if (i < 0) return null;
  return long && def.long ? def.long[i] : def.options[i][1];
}

const validCount = (def, v) => Number.isInteger(v) && v >= def.min && v <= def.max;

/** カフェインを摂ったと入力されているか（コーヒーかエナジードリンクが1以上） */
export const hadCaffeine = (s) => !!s && ((s.coffee ?? 0) > 0 || (s.energy ?? 0) > 0);

/** コーヒーとエナジードリンクの両方に 0 と入力されているか（どちらかが未入力なら false） */
export const noCaffeine = (s) => !!s && s.coffee === 0 && s.energy === 0;

/** エナジードリンクのカフェイン量（mg）。1本 120mg で換算（実際の本数から計算する）。未入力なら null */
export function energyCaffeineMg(s, cfg = CONFIG) {
  return s && s.energy != null ? s.energy * cfg.lifelog.energyMgPerCan : null;
}

/**
 * 保存されていた記録を、知っている項目と値だけに絞る（端末の保存領域や読み込んだファイルから来るので、形を信用しない）。
 * 未入力の項目はキーごと持たせない。何も残らなければ null。
 */
export function sanitizeSubjective(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [field, def] of Object.entries(SUBJECTIVE_FIELDS)) {
    if (def.kind === 'count') { if (validCount(def, raw[field])) out[field] = raw[field]; continue; }
    if (def.options.some(([v]) => v === raw[field])) out[field] = raw[field];
  }
  if ((out.cold === 'slight' || out.cold === 'yes') && Array.isArray(raw.coldSymptoms)) {
    const symptoms = SYMPTOM_KEYS.filter((k) => raw.coldSymptoms.includes(k));
    if (symptoms.length) out.coldSymptoms = symptoms;
  }
  // 最後に摂った時刻は、摂った日だけ意味がある
  if (hadCaffeine(out) && typeof raw.caffeineLast === 'string' && TIME_RE.test(raw.caffeineLast)) out.caffeineLast = raw.caffeineLast;
  if ((out.iqos ?? 0) > 0 && typeof raw.iqosLast === 'string' && TIME_RE.test(raw.iqosLast)) out.iqosLast = raw.iqosLast;
  // 筋トレを終えた時刻は、筋トレをした日（負荷が「なし」以外）だけ意味がある
  if (out.training && out.training !== 'none' && typeof raw.trainingEnd === 'string' && TIME_RE.test(raw.trainingEnd)) out.trainingEnd = raw.trainingEnd;
  return Object.keys(out).length ? out : null;
}

/** まとまり（今日の状態 / 前日・昨夜の行動）の項目名 */
export function fieldsOf(group) {
  return Object.keys(SUBJECTIVE_FIELDS).filter((k) => SUBJECTIVE_FIELDS[k].group === group);
}

/** そのまとまりで、まだ入力していない項目名 */
export function missingFields(record, group) {
  return fieldsOf(group).filter((k) => !record || record[k] == null);
}

/**
 * 「最後に○○した時刻」（エポックミリ秒）。key は 'caffeineLast'・'iqosLast'・'trainingEnd'。
 * 入力は時刻だけなので、昨夜の就寝より前で、いちばん遅い時刻として読む（0時を過ぎてからの場合にも対応）。
 * 就寝時刻が分からない日や、時刻が未入力の日は null。
 */
export function lastTimeAt(day, key) {
  const s = day && day.subjective;
  if (!s || !s[key] || day.sleepStart == null) return null;
  const [hh, mm] = s[key].split(':').map(Number);
  const midnight = localMidnightMs(day.date, day.offset);
  const minutes = (hh * 60 + mm) * 60000;
  for (const base of [midnight, midnight - 86400000]) {
    if (base + minutes <= day.sleepStart + 30 * 60000) return base + minutes; // 入力の誤差を30分まで見る
  }
  return null;
}

export const lastCaffeineAt = (day) => lastTimeAt(day, 'caffeineLast');

/** 最後にカフェインを摂った時刻の区分（前日の0時から数えた時刻で分ける）。分からなければ null */
export function caffeineTimeBand(day, cfg = CONFIG) {
  const at = lastCaffeineAt(day);
  if (at == null) return null;
  const hour = (at - (localMidnightMs(day.date, day.offset) - 86400000)) / 3600000;
  const band = cfg.lifelog.caffeineBands.find((b) => hour < b.before);
  return band ? band.key : null;
}

/** 杯数・本数を、集計用の区分にする。未入力なら null（0 は「0」の区分） */
export function countBand(value, bands) {
  return value == null ? null : bands.find((b) => value <= b.max).key;
}

/** IQOS の本数の区分。未入力なら null（0本は「0」の区分） */
export function iqosCountBand(s, cfg = CONFIG) {
  return s ? countBand(s.iqos ?? null, cfg.lifelog.iqosBands) : null;
}

/** その日までに、IQOS の本数を入力した日が何日あるか */
export function iqosInputDays(days, upTo = null) {
  let n = 0;
  for (const [date, d] of days) if ((!upTo || date <= upTo) && d.subjective && d.subjective.iqos != null) n += 1;
  return n;
}

/**
 * IQOS の本数の本人比: 'low' 少なめ / 'usual' 普段どおり / 'high' 多め。
 * その日より前の自分の記録（直前90日のうち、本数を入力した日）の分布で分ける。その日より後の記録は使わない。
 * 入力した日が30日に満たない間と、その日の本数が未入力の日は null。
 */
export function iqosRelativeBand(days, date, cfg = CONFIG) {
  const rc = cfg.lifelog.iqosRelative;
  const day = days.get(date);
  const v = day && day.subjective ? day.subjective.iqos : null;
  if (v == null) return null;
  const prior = [];
  for (let i = 1; i <= rc.windowDays; i++) {
    const d = days.get(addDays(date, -i));
    if (d && d.subjective && d.subjective.iqos != null) prior.push(d.subjective.iqos);
  }
  if (prior.length < rc.minDays) return null;
  prior.sort((a, b) => a - b);
  const quantile = (q) => { const pos = (prior.length - 1) * q; const lo = Math.floor(pos); const hi = Math.ceil(pos); return prior[lo] + (prior[hi] - prior[lo]) * (pos - lo); };
  return v < quantile(rc.lowQuantile) ? 'low' : v > quantile(rc.highQuantile) ? 'high' : 'usual';
}

/** 最後に IQOS を吸ってから就寝までの時間（分）。分からなければ null */
export function iqosGapMin(day) {
  const at = lastTimeAt(day, 'iqosLast');
  return at == null ? null : Math.max(0, Math.round((day.sleepStart - at) / 60000));
}

/** 最後に IQOS を吸った時刻の区分（就寝時刻との差で自動計算）。吸わなかった日は 'zero'。分からなければ null */
export function iqosGapBand(day, cfg = CONFIG) {
  const s = day && day.subjective;
  if (!s || s.iqos == null) return null;
  if (s.iqos === 0) return 'zero';
  const gap = iqosGapMin(day);
  return gap == null ? null : cfg.lifelog.iqosGapBands.find((b) => gap <= b.within).key;
}

/** 筋トレを終えてから就寝までの時間（分）。分からなければ null */
export function trainingGapMin(day) {
  const at = lastTimeAt(day, 'trainingEnd');
  return at == null ? null : Math.max(0, Math.round((day.sleepStart - at) / 60000));
}

/**
 * 筋トレを終えた時刻の区分（就寝時刻との差で自動計算）。筋トレをしなかった日は 'zero'。
 * 負荷が未入力の日と、筋トレをしたが時刻が分からない日は null（どの区分にも入れない）。
 */
export function trainingGapBand(day, cfg = CONFIG) {
  const s = day && day.subjective;
  if (!s || s.training == null) return null;
  if (s.training === 'none') return 'zero';
  const gap = trainingGapMin(day);
  return gap == null ? null : cfg.lifelog.trainingGapBands.find((b) => gap <= b.within).key;
}

/**
 * 数値の変化を読み解くための一言（画面に添える）。判定そのものは変えない。
 * 飲酒の記録がある夜に、心拍変動・心拍・皮膚温が望ましくない向きへ動いていた時だけ返す。
 */
export function contextNotes({ subjective, metrics, radar }) {
  const out = [];
  if (!subjective) return out;
  if (subjective.alcohol === 'some' || subjective.alcohol === 'much') {
    const z = (key) => (metrics[key] && metrics[key].dev ? metrics[key].dev.z : 0);
    const moved = z('hrv') <= -1 || z('hr') >= 1 || z('temp') >= 1 || (radar && radar.level !== 'none');
    if (moved) {
      out.push({ key: 'alcohol', text: `昨夜は飲酒（${optionLabel('alcohol', subjective.alcohol)}）の記録があります。心拍変動・睡眠中の心拍・皮膚温は、飲酒でも同じ向きに動きます。` });
    }
  }
  return out;
}
