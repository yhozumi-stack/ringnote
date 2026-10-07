// 5分ごとの生データの保管庫（端末の中。IndexedDB）。
//
// 目的は「後から、今とは別のやり方で分析し直せること」（設計書 5.6）。
// SOXAI から届いた行を、そのままの形で、1日ぶんずつ保管する（丸めない・項目を選ばない）。
// localStorage は容量が小さい（約5MB）ので、量の多い5分データはこちらに置く。1日ぶんは約150KB。
// 本番と模擬で保管庫を分け、模擬のデータが本番に混ざらないようにする。

import { MODE } from './config.js';

const DB_NAME = `ringnote.v1.${MODE}.archive`;
const STORE = 'detail';
let opening = null;

function open() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('この端末では、保管用の領域を使えません')); return; }
      const rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: 'date' });
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error || new Error('保管用の領域を開けませんでした'));
    });
    opening.catch(() => { opening = null; }); // 失敗は覚えない（次の機会にやり直す）
  }
  return opening;
}

function run(mode, work) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const rq = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(rq ? rq.result : undefined);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('保管用の領域に書き込めませんでした'));
  }));
}

export const archive = {
  /** 1日ぶんを保管する。rec = { date, rows, fetchedAt, complete } */
  put(rec) { return run('readwrite', (s) => s.put(rec)); },
  /** 1日ぶんを読む。無ければ undefined */
  get(date) { return run('readonly', (s) => s.get(date)); },
  /** 保管してある日付の一覧 */
  dates() { return run('readonly', (s) => s.getAllKeys()); },
  /** 全部消す（ログアウトの時） */
  clear() { return run('readwrite', (s) => s.clear()); },
};
