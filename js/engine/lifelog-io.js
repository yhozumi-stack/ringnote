// 記録のバックアップ: 主観入力・生活ログと、アプリの設定の書き出しと読み込み（設計書 5.5）。
// AI 分析用の書き出し（SOXAI のデータや分析結果を日付で結合したもの）は analysis-export.js にある。
// 取り直せないデータなので、日付と入力値が欠けずに残ることを最優先にする。
// - JSON: 保管と読み込み用。未入力の項目は持たせない（読み込んだ時も未入力のまま戻る）
// - CSV: 表計算ソフトで見る用。1行が1日。未入力は空欄

import { SUBJECTIVE_FIELDS, COLD_SYMPTOMS, sanitizeSubjective, optionLabel, energyCaffeineMg } from './subjective.js';

export const LIFELOG_FORMAT = 'ringnote-lifelog';
// 版 2: コーヒーとエナジードリンクを実際の杯数・本数で持つ。精神的ストレスを「昨日」のものとして持つ。
// 版 1: コーヒーの 4 は「4杯以上」、エナジードリンクの 3 は「3本以上」。精神的ストレスは今朝のもの。
export const LIFELOG_VERSION = 2;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_KEYS = Object.keys(SUBJECTIVE_FIELDS);

/** 記録を、形を整えて日付順に並べる。中身の無い日は落とす */
function cleanDays(map) {
  const out = [];
  for (const date of Object.keys(map || {}).sort()) {
    if (!DATE_RE.test(date)) continue;
    const rec = sanitizeSubjective(map[date]);
    if (rec) out.push({ date, ...rec });
  }
  return out;
}

/**
 * JSON で書き出す。
 * @param {object} [meta] { exportedAt: ISO 8601 の文字列, timezone: 'Asia/Tokyo' などの地域名, utcOffsetMinutes: 協定世界時との差（分）,
 *                         settings: アプリの設定（必要な睡眠時間など） }
 */
export function exportLifelogJson(map, { exportedAt = null, timezone = null, utcOffsetMinutes = null, settings = null } = {}) {
  const fields = {};
  for (const [key, def] of Object.entries(SUBJECTIVE_FIELDS)) {
    fields[key] = def.kind === 'count'
      ? { label: def.label, group: def.group, kind: 'count', unit: def.unit, min: def.min, max: def.max, note: '実際の数を整数で保存（丸めていない）' }
      : { label: def.label, group: def.group, options: def.options.map(([value], i) => ({ value, label: def.long ? def.long[i] : def.options[i][1] })) };
  }
  return JSON.stringify({
    format: LIFELOG_FORMAT,
    schema_version: LIFELOG_VERSION,
    exported_at: exportedAt,
    timezone,                    // 日付と時刻は、この地域の現地時間
    utc_offset_minutes: utcOffsetMinutes,
    note: '日付は入力した朝の日付（昨夜の睡眠記録と同じ日付）。「前日・昨夜の行動」の項目は、その前日のこと。時刻は現地時間。未入力の項目は、キーを持たせていない。',
    settings: settings && settings.sleepNeedMin != null ? { sleepNeedMin: settings.sleepNeedMin } : {},
    fields,
    coldSymptoms: COLD_SYMPTOMS.map(([value, label]) => ({ value, label })),
    caffeineLast: '最後にカフェインを摂った時刻（HH:MM）',
    iqosLast: '最後に IQOS を吸った時刻（HH:MM）',
    days: cleanDays(map),
  }, null, 1);
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV で書き出す（表計算ソフトで文字化けしないよう、先頭に BOM を付ける）。値は日本語の表記 */
export function exportLifelogCsv(map) {
  const symptomLabel = new Map(COLD_SYMPTOMS);
  const header = ['日付', ...FIELD_KEYS.map((k) => SUBJECTIVE_FIELDS[k].label), '症状の内容', '最後にカフェインを摂った時刻', 'エナジードリンクのカフェイン量(mg)', '最後に IQOS を吸った時刻'];
  const lines = [header.map(csvCell).join(',')];
  for (const day of cleanDays(map)) {
    lines.push([
      day.date,
      ...FIELD_KEYS.map((k) => (day[k] == null ? '' : optionLabel(k, day[k], { long: true }))),
      (day.coldSymptoms || []).map((s) => symptomLabel.get(s)).join('・'),
      day.caffeineLast || '',
      energyCaffeineMg(day) ?? '',
      day.iqosLast || '',
    ].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * 書き出した JSON を読む。
 * @returns {{ok:true, days:Object<string,object>, count:number, skipped:number} | {ok:false, error:string}}
 */
export function parseLifelog(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'ファイルを読めませんでした（JSON の形式ではありません）' }; }
  if (!data || data.format !== LIFELOG_FORMAT) return { ok: false, error: 'リングノートの書き出しファイルではありません' };
  const version = data.schema_version ?? data.version; // 初期の書き出しは version という名前だった
  if (!(version >= 1) || version > LIFELOG_VERSION) return { ok: false, error: `このアプリでは読めない版のファイルです（版 ${version}）` };
  if (!Array.isArray(data.days)) return { ok: false, error: 'ファイルに記録が入っていません' };
  const days = {};
  let skipped = 0;
  for (const row of data.days) {
    const date = row && typeof row.date === 'string' ? row.date : '';
    const rec = DATE_RE.test(date) ? sanitizeSubjective(row) : null;
    if (rec) days[date] = rec; else skipped += 1; // 読めなかった行は数えて知らせる（黙って捨てない）
  }
  // 版 1 のファイルは、意味の違う値が入っている。捨てずに読み込み、件数を知らせる（黙って読み替えない）
  let legacy = null;
  if (version < 2) {
    const all = Object.values(days);
    legacy = {
      capped: all.filter((r) => r.coffee === 4 || r.energy === 3).length, // 「4杯以上」「3本以上」として記録されていた日
      mental: all.filter((r) => r.mental != null).length,                 // 今朝の状態として記録されていた精神的ストレス
    };
  }
  const need = data.settings && Number.isFinite(data.settings.sleepNeedMin) ? Math.round(data.settings.sleepNeedMin) : null;
  return { ok: true, days, count: Object.keys(days).length, skipped, schemaVersion: version, legacy,
    settings: need != null && need >= 240 && need <= 720 ? { sleepNeedMin: need } : null,
    exportedAt: data.exported_at ?? data.exportedAt ?? null, timezone: data.timezone ?? null };
}

/**
 * 読み込んだ記録を、今の記録に重ねる。
 * 同じ日付がある場合は、項目ごとに、ファイルにある値で上書きし、ファイルに無い項目は今の値を残す。
 * @returns {{merged:Object, added:number, updated:number, unchanged:number}}
 */
export function mergeLifelog(current, incoming) {
  const merged = { ...(current || {}) };
  let added = 0; let updated = 0; let unchanged = 0;
  for (const [date, rec] of Object.entries(incoming || {})) {
    const before = sanitizeSubjective(merged[date]);
    const after = sanitizeSubjective({ ...(before || {}), ...rec });
    if (!after) continue;
    if (!before) added += 1;
    else if (JSON.stringify(before) === JSON.stringify(after)) unchanged += 1;
    else updated += 1;
    merged[date] = after;
  }
  return { merged, added, updated, unchanged };
}
