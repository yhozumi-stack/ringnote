// 端末内の保存領域（localStorage / sessionStorage）。
// - パスワードは保存しない。保存するのは更新用トークンと取得済みデータだけ。
// - 本番と模擬でキーを分け、模擬のデータが本番の表示に混ざらないようにする。
// - 保存に失敗しても（容量超過・プライベートブラウズ等）アプリは動き続ける。

import { MODE } from './config.js';

const NS = `ringnote.v1.${MODE}.`;
const DETAIL_KEEP = 14; // 夜の5分ごとの記録を端末に残す夜数（睡眠タブの夜間グラフ用）

function read(area, key, fallback) {
  try {
    const v = area.getItem(NS + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function write(area, key, value) {
  try {
    area.setItem(NS + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(area, key) {
  try { area.removeItem(NS + key); } catch { /* 何もしない */ }
}

export const store = {
  // ---- 認証 ----
  getAuth() { return read(localStorage, 'auth', null); },
  setAuth(auth) { return write(localStorage, 'auth', auth); },
  clearAuth() { remove(localStorage, 'auth'); remove(sessionStorage, 'session'); },

  getSession() { return read(sessionStorage, 'session', null); },
  setSession(session) { write(sessionStorage, 'session', session); },
  clearSession() { remove(sessionStorage, 'session'); },

  // ---- 日次データ ----
  getDaily() { return read(localStorage, 'daily', { rows: {}, syncedAt: 0, backfilled: false, truncated: false }); },
  setDaily(daily) { return write(localStorage, 'daily', daily); },

  // ---- 5分ごとのデータ（新しい順に DETAIL_KEEP 日分だけ残す） ----
  getDetail(date) { return read(localStorage, `detail.${date}`, null); },
  setDetail(date, payload) {
    const index = read(localStorage, 'detail.index', []).filter((d) => d !== date);
    index.unshift(date);
    while (index.length > DETAIL_KEEP) remove(localStorage, `detail.${index.pop()}`);
    let ok = write(localStorage, `detail.${date}`, payload);
    if (!ok) {
      // 容量超過時は古い日を全部捨ててもう一度だけ試す
      for (const d of index.slice(1)) remove(localStorage, `detail.${d}`);
      index.length = 1;
      ok = write(localStorage, `detail.${date}`, payload);
    }
    write(localStorage, 'detail.index', ok ? index : index.filter((d) => d !== date));
    return ok;
  },

  // ---- 夜の派生値（5分データから作った、夜ごとの皮膚温など。日付 → 値） ----
  getNights() { return read(localStorage, 'nights', {}); },
  setNights(nights) { return write(localStorage, 'nights', nights); },

  // ---- 日中のストレスの、日ごとの要約（度数と中央値だけ。日付 → 要約） ----
  getStress() { return read(localStorage, 'stress', {}); },
  setStress(map) { return write(localStorage, 'stress', map); },

  // ---- 5分ごとの生データの保管庫の目次（日付 → { n: 行数, c: 確定したか, at: 取得時刻 }）。中身は archive.js が持つ ----
  getArchiveIndex() { return read(localStorage, 'archive.index', {}); },
  setArchiveIndex(index) { return write(localStorage, 'archive.index', index); },

  // ---- 主観入力・生活ログ（日付 → 入力した値）。この端末にしか無いデータ ----
  getSubjective() { return read(localStorage, 'subjective', {}); },
  setSubjective(map) { return write(localStorage, 'subjective', map); },

  // ---- 設定 ----
  getPrefs() { return read(localStorage, 'prefs', {}); },
  setPrefs(prefs) { write(localStorage, 'prefs', prefs); },

  /** 取得済みデータだけ消す（ログイン状態は残す） */
  clearData() {
    for (const d of read(localStorage, 'detail.index', [])) remove(localStorage, `detail.${d}`);
    remove(localStorage, 'detail.index');
    remove(localStorage, 'daily');
    remove(localStorage, 'nights');
    remove(localStorage, 'stress');
    // 主観入力は取り直せないデータなので、ここでは消さない（clearAll でだけ消す）
  },

  /** この端末に保存したものを全部消す */
  clearAll() {
    this.clearData();
    this.clearAuth();
    remove(localStorage, 'subjective');
    remove(localStorage, 'prefs');
    remove(localStorage, 'archive.index');
  },
};
