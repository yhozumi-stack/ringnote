// データの同期と、分析エンジンの呼び出し。画面はここの state を読むだけにする。
// 計算はすべて engine/ に任せる（朝の DM と同じ部品。数字が食い違わないようにするため）。
//
// 決まり:
// - 毎回、直近の日を取り直す（当日分は後から値が変わるため）。しばらく開かなかった時は、最後に持っている日から取り直す。
// - 夜の派生値（皮膚温など）は5分データから作り、夜ごとに端末へ保存する。睡眠の記録が変わった夜だけ作り直す。
// - データが古い・想定外の値が来た・端末に保存できなかった、はすべて「お知らせ」に出す（黙って流さない）。

import { BACKFILL_MAX_WINDOWS, REFRESH_TAIL_DAYS, RESYNC_AFTER_MS, STALE_DAYS } from './config.js';
import { store } from './store.js';
import * as api from './api.js';
import { archive } from './archive.js';
import { APP_VERSION } from './config.js';
import { addDays, diffDays, todayStr, isoWithOffset, localMidnightMs } from './ui.js';
import { prepareDays, analyzeAll, nightFeatures, normalizeDaily, normalizeEpochs, CONFIG,
  awakeEpochs, stressDayStats, stressAnalysis, sanitizeSubjective,
  exportLifelogJson, exportLifelogCsv, parseLifelog, mergeLifelog, backupReminder,
  buildAnalysisExport, analysisExportCsv, buildDetailExport, archiveNeedsRefetch, decideArchiveUpdate } from './engine/index.js';
import { demoDaily, demoNights, demoDetail, demoSubjective } from './demo.js';

const NIGHT_WINDOW_DAYS = 29;       // 夜の派生値を持つ範囲（28日の平常値 + 当日）
const WAIT_RETRY_SEC = [15, 30, 60]; // SOXAI アプリから戻った後、自動で取り直す間隔（設計書 13.5）
const NIGHT_SERIES_DAYS = 14;       // 夜間グラフ用の5分ごとの記録を、同期のついでに保存しておく夜数
const STRESS_KEEP_DAYS = 45;        // ストレスの日ごとの要約を端末に残す日数
// 5分ごとの生データの取り直しと置き換えの決まりは、engine/archive-policy.js と engine/config.js の archive にある
const ARCHIVE_PER_SYNC = 3;         // 同期のついでに、5分ごとの生データを保管する日数（1回の同期が重くならないよう、少しずつ）

export const state = {
  demo: false,
  raw: {},             // 日付 → API の日次レコード
  nights: {},          // 日付 → 夜の派生値
  subjective: {},      // 日付 → 主観入力
  settings: {},        // { sleepNeedMin }
  prefs: {},           // 画面まわりの覚え書き { lastExport: { at, days } }
  days: new Map(),     // 日付 → 正規化済みの日
  results: new Map(),  // 日付 → 分析結果
  syncedAt: 0,
  syncing: false,
  error: null,
  truncated: false,
  lastProcess: null,   // SOXAI のクラウドが最後にデータを処理した時刻（ms）
  storageFailed: false,
  unknownStages: [],   // 想定外の睡眠ステージ値
  waiting: false,      // 昨夜のデータの到着を待って、自動で取り直している最中か
  archiveFailed: false, // 5分ごとの生データを、端末に保管できなかったか
  archiveConfirmed: [], // 行が減った版を、SOXAI 側の訂正として反映した日（この起動のあいだのお知らせ用）
  archiveIndex: {},    // 保管庫の目次（日付 → { n: 行数, h: 照合用の値, at: 最後に確かめた時刻, cand?: 更新候補 }）
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

function recompute() {
  state.days = prepareDays(Object.values(state.raw), { nightByDate: state.nights, subjectiveByDate: state.subjective });
  state.results = analyzeAll(state.days, state.settings);
  const unknown = new Set();
  for (const n of Object.values(state.nights)) for (const c of n.unknownStages || []) unknown.add(c);
  state.unknownStages = [...unknown].sort((a, b) => a - b);
}

/** 起動直後に、端末に保存済みのデータで画面を出すための読み込み */
export function loadCache() {
  state.subjective = store.getSubjective();
  state.settings = store.getPrefs().settings || {};
  state.prefs = store.getPrefs().ui || {};
  state.archiveIndex = store.getArchiveIndex();
  if (state.demo) return;
  const c = store.getDaily();
  state.raw = c.rows || {};
  state.syncedAt = c.syncedAt || 0;
  state.lastProcess = c.lastProcess || null;
  state.truncated = !!c.truncated;
  state.nights = store.getNights();
  recompute();
}

export function setDemo(on) {
  state.demo = on;
  nightMem.clear(); nightPending.clear(); stressMem.clear(); // デモの作り物と実データを混ぜない
  state.error = null;
  state.waiting = false;
  if (on) {
    const today = todayStr();
    state.raw = demoDaily(today);
    state.nights = demoNights(today);
    state.subjective = demoSubjective(today);
    state.syncedAt = Date.now();
    state.lastProcess = null;
    state.truncated = false;
    recompute();
  } else {
    loadCache();
  }
  emit();
}

function mergeRows(target, rows) {
  for (const r of rows) {
    const date = String(r._time || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const { uid, ...rest } = r; // 利用者IDは端末に重複保存しない
    target[date] = rest;
  }
}

/** その夜の記録が変わったかを見分けるための印 */
const nightSig = (d) => `${d.sleepStart}|${d.sleepEnd}|${d.v.sleep_total_sleep_time}`;

/** 夜の派生値を、足りない夜と記録が変わった夜だけ作り直す */
async function syncNights(rows, today) {
  const nights = { ...state.nights };
  const since = addDays(today, -NIGHT_WINDOW_DAYS);
  for (const date of Object.keys(nights)) if (date <= since) delete nights[date]; // 範囲の外は捨てる
  let failed = 0;
  for (const date of Object.keys(rows).sort()) {
    if (date <= since) continue;
    const d = normalizeDaily(rows[date]);
    if (!d.hasNight || d.sleepStart == null) { delete nights[date]; continue; }
    const sig = nightSig(d);
    if (nights[date] && nights[date].sig === sig) continue;
    try {
      const epochs = await fetchEpochs(d.sleepStart - 600000, d.sleepEnd + 600000, d.offset);
      nights[date] = { ...nightFeatures(d, epochs), sig };
      if (diffDays(today, date) < NIGHT_SERIES_DAYS) saveNightSeries(date, sig, epochs);
    } catch (e) {
      if (e.kind === 'auth-expired') throw e;
      failed += 1; // 取れなかった夜は、次の同期でやり直す。古い値があればそのまま使う
    }
  }
  return { nights, failed };
}

// ---------------------------------------------------------------- 5分ごとの記録
/** 5分データを取って正規化する。デモ表示では作り物を返す */
async function fetchEpochs(startMs, endMs, offset) {
  if (state.demo) return normalizeEpochs(demoDetail(startMs, endMs, todayStr()));
  return normalizeEpochs(await api.fetchDetail(isoWithOffset(startMs, offset), isoWithOffset(endMs, offset)));
}

// 夜間グラフに使う値だけを、短い配列にして保存する
const NIGHT_COLS = ['t', 'stage', 'sHr', 'sHrv', 'sSpo2', 'temp', 'resp', 'odi'];
const packNight = (epochs) => epochs.map((e) => [...NIGHT_COLS.map((k) => (k === 'sHr' ? e.sHr ?? e.hr : k === 'sHrv' ? e.sHrv ?? e.hrv : e[k]) ?? null),
  e.stage1 ? e.stage1.join('') : null]);
const unpackNight = (rows) => rows.map((r) => {
  const e = {};
  NIGHT_COLS.forEach((k, i) => { e[k] = r[i]; });
  e.stage1 = typeof r[NIGHT_COLS.length] === 'string' ? [...r[NIGHT_COLS.length]].map(Number) : null;
  return e;
});

const nightMem = new Map(); // 日付 → { sig, epochs }
const nightPending = new Map(); // `${date}|${sig}` → 取得中の Promise（描き直しのたびに取り直さないため）
function saveNightSeries(date, sig, epochs) {
  const packed = packNight(epochs);
  nightMem.set(date, { sig, epochs: unpackNight(packed) });
  if (!state.demo) store.setDetail(date, { sig, rows: packed }); // 保存できなくても、この回の表示には困らない
}

/**
 * その夜の5分ごとの記録（睡眠タブの夜間グラフ用）。
 * @returns {Promise<{epochs:object[], start:number, end:number, offset:number}|null>} 睡眠の記録が無い日は null
 */
export async function loadNight(date) {
  const d = state.days.get(date);
  if (!d || !d.hasNight || d.sleepStart == null) return null;
  const sig = nightSig(d);
  // 睡眠ステージが入っている枠だけを使う（起床直後の日中の枠が端に混ざると、グラフの端が跳ねる）
  const out = (epochs) => ({ epochs: epochs.filter((e) => e.t > d.sleepStart && e.t <= d.sleepEnd && e.stage != null), start: d.sleepStart, end: d.sleepEnd, offset: d.offset });
  const held = nightMem.get(date);
  if (held && held.sig === sig) return out(held.epochs);
  const saved = state.demo ? null : store.getDetail(date);
  if (saved && saved.sig === sig && Array.isArray(saved.rows)) {
    const epochs = unpackNight(saved.rows);
    nightMem.set(date, { sig, epochs });
    return out(epochs);
  }
  const key = `${date}|${sig}`;
  if (!nightPending.has(key)) {
    const p = fetchEpochs(d.sleepStart - 600000, d.sleepEnd + 600000, d.offset).then((epochs) => { saveNightSeries(date, sig, epochs); });
    p.catch((e) => { if (e && e.kind === 'auth-expired') { state.error = e; emit(); } }).finally(() => nightPending.delete(key));
    nightPending.set(key, p);
  }
  await nightPending.get(key);
  return out(nightMem.get(date).epochs);
}

function sleepIntervalsAround(date) {
  return [date, addDays(date, 1)].map((k) => state.days.get(k))
    .filter((d) => d && d.sleepStart != null).map((d) => ({ start: d.sleepStart, end: d.sleepEnd }));
}

// ---------------------------------------------------------------- 5分ごとの生データの保管（設計書 5.6）
/** その日の、現地時間の 0:00〜24:00（エポックミリ秒） */
function daySpan(date) {
  const d = state.days.get(date);
  const s = localMidnightMs(date, d ? d.offset : 540);
  return [s, s + 86400000];
}

/** 中身が変わったかを見分けるための照合用の値（FNV-1a）。安全のための値ではない */
function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** その日の保管を、いま取り直すべきか */
function needsRefetch(date, now = Date.now()) {
  return archiveNeedsRefetch(state.archiveIndex[date], diffDays(todayStr(), date), now);
}

function setIndex(date, entry) {
  state.archiveIndex = { ...state.archiveIndex, [date]: entry };
  if (!store.setArchiveIndex(state.archiveIndex)) state.archiveFailed = true;
}

async function heldRows(date) {
  try { const rec = await archive.get(date); return rec && Array.isArray(rec.rows) ? rec.rows : null; } catch { return null; }
}

/**
 * その日の5分ごとの生データ（SOXAI から届いた行のまま）。iPhone が持つのは、最も信頼できる最新版の1つだけ。
 * - 取り直す必要が無ければ、保管庫のものを返す。
 * - 取り直した時にどう扱うかは、engine/archive-policy.js の決まりに従う:
 *     同じ中身 → 何もしない / 行数が同じか増えて中身が変わった → 最新版にする /
 *     行が減った → 今の記録を残して更新候補にし、同じ内容が繰り返し確認できたら置き換える
 * - 取りに行けなかった時は、保管してあるものがあればそれを返す（確認の回数には数えない）。
 * デモ表示では作り物を返し、保管はしない。
 */
async function dayRawRows(date) {
  const [s, e] = daySpan(date);
  const offset = (state.days.get(date) || { offset: 540 }).offset;
  if (state.demo) return demoDetail(s, e, todayStr());
  const held = state.archiveIndex[date];
  if (held && !needsRefetch(date)) {
    const rows = await heldRows(date);
    if (rows) return rows; // 読めなければ、下で取り直す
  }
  let raw;
  try {
    raw = await api.fetchDetail(isoWithOffset(s, offset), isoWithOffset(e, offset));
  } catch (err) {
    const rows = held && err.kind !== 'auth-expired' ? await heldRows(date) : null;
    if (rows) return rows;
    throw err;
  }
  const rows = raw.map(({ uid, ...rest }) => rest).sort((a, b) => (String(a._time) < String(b._time) ? -1 : 1)); // 利用者IDは端末に重複保存しない
  const decision = decideArchiveUpdate(held, { h: hashText(JSON.stringify(rows)), n: rows.length }, Date.now());
  if (decision.action === 'same') { setIndex(date, decision.entry); return rows; }
  if (decision.action === 'candidate') {
    const kept = await heldRows(date);
    if (kept) { setIndex(date, decision.entry); return kept; }
    // 保管してあるはずのものが読めない時は、届いたものを使う（下で保管し直す）
  }
  try {
    await archive.put({ date, rows, fetchedAt: decision.entry.at, hash: decision.entry.h });
    setIndex(date, { n: rows.length, h: decision.entry.h, at: decision.entry.at });
    if (decision.action === 'confirm' && !state.archiveConfirmed.includes(date)) state.archiveConfirmed = [...state.archiveConfirmed, date];
  } catch {
    state.archiveFailed = true; // 保管できなくても、この回の表示には使う。お知らせに出す
  }
  return rows;
}

/** 計測のある日のうち、取り直す必要のある日（新しい順）。recent は直近の日、older はそれより前の、まだ保管していない日 */
function archiveBacklog() {
  const today = todayStr();
  const todo = [...state.days.values()].filter((d) => d.worn && d.date <= today && needsRefetch(d.date)).map((d) => d.date).sort().reverse();
  const recentDays = CONFIG.archive.refreshDays;
  return { recent: todo.filter((d) => diffDays(today, d) <= recentDays), older: todo.filter((d) => diffDays(today, d) > recentDays) };
}

/**
 * 保管を進める。直近の日は毎回すべて取り直し、それより前の日は limit 日ぶんずつ進める。
 * 戻り値は { done, failed, left }
 */
export async function archiveMore(limit = ARCHIVE_PER_SYNC) {
  if (state.demo || !api.isLoggedIn()) return { done: 0, failed: 0, left: 0 };
  const { recent, older } = archiveBacklog();
  let done = 0; let failed = 0;
  for (const date of [...recent, ...older.slice(0, limit)]) {
    try { await dayRawRows(date); done += 1; } catch (e) {
      if (e && e.kind === 'auth-expired') throw e;
      failed += 1;
    }
  }
  return { done, failed, left: Math.max(0, older.length - limit) };
}

/** 5分ごとの生データの保管庫を空にする（ログアウトの時） */
export function clearArchive() {
  state.archiveIndex = {};
  store.setArchiveIndex({});
  return archive.clear().catch(() => { /* 消せなくても、目次を空にしてあるので使われない */ });
}

/** 保管庫の状況（設定画面用） */
export function archiveSummary() {
  const dates = Object.keys(state.archiveIndex).sort();
  return { days: dates.length, first: dates[0] || null, last: dates[dates.length - 1] || null, waiting: state.demo ? 0 : archiveBacklog().older.length };
}

const stressMem = new Map(); // `${date}|${syncedAt}` → Promise
/**
 * その日の日中のストレスの分析（ストレスタブ用）。
 * 「自分の直近14日の分布」を作るため、足りない日の5分データを1日ずつ取りに行く。
 * 一度取った日は、度数と中央値だけの要約にして端末に保存し、次からは使い回す。
 */
export function loadStress(date) {
  const key = `${date}|${state.syncedAt}|${state.demo}`;
  if (!stressMem.has(key)) {
    if (stressMem.size > 12) stressMem.clear();
    const p = computeStress(date);
    p.catch((e) => {
      stressMem.delete(key); // 失敗は覚えない（次に開いた時にやり直す）
      if (e && e.kind === 'auth-expired') { state.error = e; emit(); }
    });
    stressMem.set(key, p);
  }
  return stressMem.get(key);
}

async function computeStress(date) {
  const cfg = CONFIG;
  const day = state.days.get(date);
  const offset = day ? day.offset : 540;
  const span = daySpan;
  const awakeOf = async (k) => {
    const [s, e] = span(k);
    const epochs = normalizeEpochs(await dayRawRows(k));
    return awakeEpochs(epochs, { dayStart: s, dayEnd: e, sleepIntervals: sleepIntervalsAround(k), cfg });
  };

  const saved = state.demo ? {} : store.getStress();
  const stats = { ...saved };
  const prior = [];
  let failed = 0; let changed = false;
  for (let i = cfg.stress.windowDays; i >= 1; i--) {
    const k = addDays(date, -i);
    const d = state.days.get(k);
    if (!d || !d.worn) continue;
    const held = stats[k];
    const idx = state.archiveIndex[k];
    // 要約は、元にした生データが同じ間だけ使い回す（生データを取り直す必要がある日は、取り直してから作り直す）
    if (!state.demo && held && idx && held.h === idx.h && !needsRefetch(k)) { prior.push(held); continue; }
    try {
      const awake = await awakeOf(k);
      const h = state.demo ? null : (state.archiveIndex[k] || {}).h || null;
      if (held && h && held.h === h) { prior.push(held); continue; } // 取り直したが、中身は同じだった
      stats[k] = { ...stressDayStats(k, awake), at: Date.now(), h };
      changed = true;
      prior.push(stats[k]);
    } catch (e) {
      if (e.kind === 'auth-expired') throw e;
      failed += 1;
      if (held) prior.push(held); // 取り直せなかった日は、前に取った要約があればそれを使う
    }
  }
  if (changed && !state.demo) {
    const oldest = addDays(todayStr(), -STRESS_KEEP_DAYS);
    for (const k of Object.keys(stats)) if (k < oldest) delete stats[k];
    if (!store.setStress(stats)) state.storageFailed = true;
  }

  const [dayStart, dayEnd] = span(date);
  const awake = day && day.worn ? await awakeOf(date) : [];
  return { date, offset, dayStart, dayEnd, awake, failed, analysis: stressAnalysis(awake, prior, { offset, cfg }) };
}

/** 日次データと夜の派生値を同期する。full=true で全期間を取り直す。 */
export async function syncAll({ full = false } = {}) {
  if (state.demo || state.syncing) return;
  state.syncing = true;
  state.error = null;
  emit();
  try {
    const today = todayStr();
    const cache = store.getDaily();
    const rows = full ? {} : { ...(cache.rows || {}) };
    let truncated = full ? false : !!cache.truncated;

    if (full || !cache.backfilled) {
      // 過去分: 新しい方から窓を後ろへずらし、計測のある日が1件も無い窓に当たったら止める
      truncated = true;
      let end = today;
      for (let i = 0; i < BACKFILL_MAX_WINDOWS; i++) {
        const start = addDays(end, -(api.dailyWindow() - 1));
        const got = await api.fetchDaily(start, end);
        mergeRows(rows, got);
        const hasMeasured = got.some((r) => normalizeDaily(r).worn);
        if (!got.length || (!hasMeasured && i > 0)) { truncated = false; break; }
        end = addDays(start, -1);
      }
    } else {
      const dates = Object.keys(rows).sort();
      const lastHeld = dates.length ? dates[dates.length - 1] : today;
      const tail = addDays(today, -REFRESH_TAIL_DAYS);
      mergeRows(rows, await api.fetchDaily(lastHeld < tail ? lastHeld : tail, today));
    }
    if (full) { state.nights = {}; nightMem.clear(); stressMem.clear(); store.setStress({}); }

    const { nights, failed } = await syncNights(rows, today);
    const syncedAt = Date.now();
    let lastProcess = null;
    try { lastProcess = await api.fetchLastProcess(); } catch { /* 補助情報。取れなくても同期は成功として扱う */ }
    const okDaily = store.setDaily({ rows, syncedAt, backfilled: true, truncated, lastProcess });
    const okNights = store.setNights(nights);
    state.storageFailed = !okDaily || !okNights;
    state.raw = rows;
    state.nights = nights;
    state.syncedAt = syncedAt;
    state.truncated = truncated;
    state.nightFailures = failed;
    state.lastProcess = lastProcess;
    recompute();
    // 5分ごとの生データを、新しい日から少しずつ保管する（失敗しても同期そのものは成功として扱い、次の同期でやり直す）
    try { await archiveMore(); } catch (e) { if (e && e.kind === 'auth-expired') throw e; }
  } catch (e) {
    state.error = e;
  } finally {
    state.syncing = false;
    emit();
  }
}

/** 前回の同期から時間が経っていれば同期する（アプリを開いた時・戻ってきた時） */
export function syncIfStale() {
  if (state.demo || !api.isLoggedIn()) return;
  if (Date.now() - state.syncedAt > RESYNC_AFTER_MS) syncAll();
}

/** 今日の睡眠の記録が届いているか */
export function todayHasNight() {
  const d = state.days.get(todayStr());
  return !!(d && d.hasNight);
}

let waitTimers = [];
/**
 * 昨夜のデータがまだ無い時に、15秒後・30秒後・60秒後に自動で取り直す（設計書 13.5）。
 * SOXAI アプリで同期してから戻ってきた時に呼ぶ。
 */
export function retryUntilArrived() {
  if (state.demo || !api.isLoggedIn() || todayHasNight()) return;
  for (const t of waitTimers) clearTimeout(t);
  state.waiting = true;
  emit();
  waitTimers = WAIT_RETRY_SEC.map((sec, i) => setTimeout(async () => {
    if (!todayHasNight()) await syncAll();
    if (todayHasNight() || i === WAIT_RETRY_SEC.length - 1) {
      for (const t of waitTimers) clearTimeout(t);
      waitTimers = [];
      state.waiting = false;
      emit();
    }
  }, sec * 1000));
}

function saveSubjective(date, cur) {
  const clean = sanitizeSubjective(cur);
  const next = { ...state.subjective };
  if (clean) next[date] = clean; else delete next[date];
  state.subjective = next;
  if (!state.demo && !store.setSubjective(next)) state.storageFailed = true;
  recompute();
  emit();
}

/** 主観入力を保存する。field は engine/subjective.js の項目名。同じ値をもう一度選ぶと取り消し */
export function setSubjective(date, field, value) {
  const cur = { ...(state.subjective[date] || {}) };
  if (cur[field] === value) delete cur[field]; else cur[field] = value;
  saveSubjective(date, cur); // 症状を「なし」に戻した時は、症状の中身も一緒に消える
}

/** 風邪っぽい症状の中身（喉・鼻など）を付けたり外したりする */
export function toggleColdSymptom(date, key) {
  const cur = { ...(state.subjective[date] || {}) };
  const list = new Set(cur.coldSymptoms || []);
  if (list.has(key)) list.delete(key); else list.add(key);
  cur.coldSymptoms = [...list];
  saveSubjective(date, cur);
}

/** 選択肢でない値（最後にカフェインを摂った時刻）を入れる。null か空文字で未入力に戻す */
export function setLifeValue(date, field, value) {
  const cur = { ...(state.subjective[date] || {}) };
  if (value == null || value === '') delete cur[field]; else cur[field] = value;
  saveSubjective(date, cur);
}

/** その日より前で、いちばん新しく入力された値（「前回と同じ」ボタン用）。無ければ null */
export function previousValue(date, field) {
  const dates = Object.keys(state.subjective).filter((d) => d < date).sort();
  for (let i = dates.length - 1; i >= 0; i--) {
    const v = state.subjective[dates[i]][field];
    if (v != null) return v;
  }
  return null;
}

// ---------------------------------------------------------------- 主観入力・生活ログの書き出しと読み込み（設計書 5.5）
const inputDays = () => Object.keys(state.subjective).length;

function exportMeta(now = new Date()) {
  let timezone = null;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* 地域名が取れない端末では、協定世界時との差だけを書く */ }
  return { exportedAt: now.toISOString(), timezone, utcOffsetMinutes: -now.getTimezoneOffset(), appVersion: APP_VERSION };
}

const fileStamp = (now = new Date()) => `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

/**
 * AI 分析用: 日ごとのデータ（SOXAI の日次データ・主観入力と生活ログ・計算した値を、日付で結合したもの）。
 * kind は 'json' か 'csv'
 */
export function buildAnalysisFile(kind) {
  const exp = buildAnalysisExport({ rawDaily: state.raw, days: state.days, results: state.results, subjective: state.subjective, nights: state.nights,
    settings: state.settings, meta: exportMeta() });
  const name = `ringnote-analysis-${state.demo ? 'demo-' : ''}${fileStamp()}`;
  return kind === 'csv'
    ? { filename: `${name}.csv`, mime: 'text/csv', text: analysisExportCsv(exp), days: exp.days.length }
    : { filename: `${name}.json`, mime: 'application/json', text: JSON.stringify(exp, null, 1), days: exp.days.length };
}

/**
 * AI 分析用: 5分ごとの生データ（別ファイル）。直近 dayCount 日ぶん。
 * 保管庫にある日はそれを使い、無い日は SOXAI から取る。取れなかった日は、ファイルに書いておく。
 */
export async function buildDetailFile(dayCount) {
  const today = todayStr();
  const dates = [...state.days.values()].filter((d) => d.worn && d.date <= today && diffDays(today, d.date) < dayCount).map((d) => d.date).sort();
  const got = []; const missing = [];
  for (const date of dates) {
    try {
      const rows = await dayRawRows(date);
      const held = state.archiveIndex[date];
      // 直近の日は、後から行が増えたり直ったりすることがあるので、「まだ変わりうる」と印を付ける
      got.push({ date, rows, fetchedAt: held ? held.at : Date.now(), complete: diffDays(today, date) > CONFIG.archive.refreshDays && !(state.archiveIndex[date] && state.archiveIndex[date].cand) });
    } catch (e) {
      if (e && e.kind === 'auth-expired') { state.error = e; emit(); throw e; }
      missing.push(date);
    }
  }
  const exp = buildDetailExport(got, { meta: exportMeta(), missing });
  const name = `ringnote-detail-${state.demo ? 'demo-' : ''}${fileStamp()}`;
  emit(); // 保管庫の日数の表示を更新する
  return { filename: `${name}.json`, mime: 'application/json', text: JSON.stringify(exp), days: got.length, missing: missing.length };
}

/** 書き出すファイルの中身を作る。kind は 'json' か 'csv' */
export function buildLifelogExport(kind) {
  const now = new Date();
  const name = `ringnote-backup-${state.demo ? 'demo-' : ''}${fileStamp(now)}`;
  if (kind === 'csv') return { filename: `${name}.csv`, mime: 'text/csv', text: exportLifelogCsv(state.subjective), days: inputDays() };
  return { filename: `${name}.json`, mime: 'application/json', text: exportLifelogJson(state.subjective, { ...exportMeta(now), settings: state.settings }), days: inputDays() };
}

/** 書き出しが済んだことを覚えておく（設定画面に「最後に書き出した日」を出すため） */
export function markLifelogExported() {
  if (state.demo) return;
  setPref('lastExport', { at: Date.now(), days: inputDays(), dates: Object.keys(state.subjective).sort().slice(-1)[0] || null });
}

/** 最後の書き出しより後に、入力した日が何日増えたか。一度も書き出していなければ null */
/** 記録のバックアップを、今日の画面で知らせるかどうか（知らせない時は null。デモ表示中は知らせない） */
export function backupNotice(now = Date.now()) {
  if (state.demo) return null;
  const last = state.prefs.lastExport;
  const first = Object.keys(state.subjective).sort()[0];
  return backupReminder({ lastExportAt: last ? last.at : null, exportedDays: last ? (last.days || 0) : 0, inputDays: inputDays(),
    firstInputAt: first ? new Date(`${first}T00:00:00`).getTime() : null, now });
}

export function daysSinceExport() {
  const last = state.prefs.lastExport;
  if (!last) return null;
  return Math.max(0, inputDays() - (last.days || 0));
}

/**
 * 読み込むファイルの中身を確かめる（まだ保存しない）。
 * @returns {{ok:false, error:string} | {ok:true, count, skipped, added, updated, unchanged, merged}}
 */
export function previewLifelogImport(text) {
  const parsed = parseLifelog(text);
  if (!parsed.ok) return parsed;
  if (!parsed.count) return { ok: false, error: 'ファイルに、読み込める記録がありませんでした' };
  return { ok: true, count: parsed.count, skipped: parsed.skipped, legacy: parsed.legacy, settings: parsed.settings, ...mergeLifelog(state.subjective, parsed.days) };
}

/** previewLifelogImport() の結果を保存する */
export function applyLifelogImport(preview) {
  if (state.demo || !preview || !preview.ok) return false;
  state.subjective = preview.merged;
  const ok = store.setSubjective(state.subjective);
  if (!ok) state.storageFailed = true;
  // アプリの設定（必要な睡眠時間）も、ファイルにあれば戻す
  if (preview.settings) { state.settings = { ...state.settings, ...preview.settings }; store.setPrefs({ ...store.getPrefs(), settings: state.settings }); }
  recompute();
  emit();
  return ok;
}

/** 画面まわりの覚え書きを保存する */
export function setPref(key, value) {
  state.prefs = { ...state.prefs, [key]: value };
  if (!state.demo) store.setPrefs({ ...store.getPrefs(), ui: state.prefs });
  emit();
}

/** 必要な睡眠時間（分）を設定する。null で暫定値（7時間30分）に戻す */
export function setSleepNeed(minutes) {
  state.settings = { ...state.settings };
  if (minutes == null) delete state.settings.sleepNeedMin; else state.settings.sleepNeedMin = minutes;
  if (!state.demo) store.setPrefs({ ...store.getPrefs(), settings: state.settings });
  recompute();
  emit();
}

/** 画面上部に出すお知らせ。{tone:'info'|'warn'|'error', text} */
export function notices() {
  const out = [];
  const today = todayStr();
  if (state.error) {
    const k = state.error.kind;
    if (k === 'network') out.push({ tone: 'warn', text: `${state.error.message}。保存済みのデータを表示しています。` });
    else if (k !== 'auth-expired') out.push({ tone: 'error', text: `更新できませんでした: ${state.error.message}` });
  }
  const dates = [...state.days.values()].filter((d) => d.worn).map((d) => d.date);
  const last = dates.length ? dates[dates.length - 1] : null;
  if (!state.demo && state.syncedAt && last && diffDays(today, last) > STALE_DAYS) {
    out.push({ tone: 'warn', text: `計測データが ${diffDays(today, last)} 日間届いていません（最終: ${last}）。SOXAI アプリを開いてリングを同期してください。` });
  }
  if (state.truncated) out.push({ tone: 'warn', text: '古いデータの取得を途中で止めています。設定の「全期間を取り直す」で再取得できます。' });
  if (state.nightFailures) out.push({ tone: 'warn', text: `${state.nightFailures} 夜分の5分ごとの記録を取得できませんでした。次の更新でやり直します。` });
  if (state.unknownStages.length) out.push({ tone: 'warn', text: `想定外の睡眠ステージの値（${state.unknownStages.join(', ')}）を受信しました。「その他」として数えています。` });
  if (state.storageFailed) out.push({ tone: 'warn', text: 'この端末の保存領域に書き込めませんでした。次回起動時は取り直しになります。' });
  const pending = Object.keys(state.archiveIndex).filter((d) => state.archiveIndex[d].cand).sort();
  if (pending.length) out.push({ tone: 'info', text: `SOXAI から届いた5分ごとの記録が、前より少ない日があります（${pending.join('、')}）。一時的な取得の乱れか、SOXAI 側の訂正かを確かめています。同じ内容がもう一度確認できるまで、今の記録を使います。` });
  if (state.archiveConfirmed.length) out.push({ tone: 'info', text: `5分ごとの記録を、SOXAI 側の訂正に合わせて更新しました（${state.archiveConfirmed.join('、')}）。` });
  if (state.archiveFailed) out.push({ tone: 'warn', text: '5分ごとの生データを、この端末に保管できませんでした。空き容量を確認してください。SOXAI 側には残っているので、次の同期でやり直します。' });
  return out;
}

export function clearLocalData() {
  store.clearData();
  // 5分ごとの生データの保管庫は、取り直しでは消さない（消すのはログアウトの時だけ）
  nightMem.clear(); nightPending.clear(); stressMem.clear();
  state.raw = {};
  state.nights = {};
  state.syncedAt = 0;
  state.truncated = false;
  state.lastProcess = null;
  recompute();
  emit();
}
