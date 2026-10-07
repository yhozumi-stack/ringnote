// iPhone の中の、5分ごとの生データの保管の決まり（設計書 5.6）。通信も保存もしない、判断だけの部分。
//
// iPhone が持つのは「いま最も信頼できる最新版」の1つだけ（過去の版の履歴は Mac 側が持つ）。
// - 取得した時刻だけを理由に「確定」にはしない。直近の日は取り直す。
// - 行数が同じか増えていて、中身が変わっていれば、すぐ最新版にする。
// - 行数が減っていたら、その場では今の記録を残し、「更新候補」として覚える。
//   一時的な取得の乱れを採用しないため。同じ内容が、時間を空けて繰り返し届いたら、SOXAI 側の訂正として置き換える。
// - 取得に失敗した時は、この判断を呼ばない（確認の回数に数えない）。

import { CONFIG } from './config.js';

/**
 * その日の保管を、いま取り直すべきか。
 * @param {object|undefined} entry  目次の1件 { n: 行数, h: 照合用の値, at: 最後に確かめた時刻, cand?: 更新候補 }
 * @param {number} ageDays  今日から何日前か（今日は 0）
 */
export function archiveNeedsRefetch(entry, ageDays, now, cfg = CONFIG) {
  const a = cfg.archive;
  if (!entry) return true;
  const since = now - entry.at;
  if (entry.cand) return since > a.refreshGapMin * 60000;                 // 更新候補がある日は、決着がつくまで確かめ続ける
  if (ageDays <= a.refreshDays) return since > a.refreshGapMin * 60000;   // 直近の日は、開くたびに（間隔は空ける）
  if (ageDays <= a.recheckDays && entry.n < a.fullDayRows) return since > a.recheckGapHours * 3600000;
  return false;
}

/**
 * 取得できた1日ぶんを、今の保管と比べて、どう扱うかを決める。
 * @param {object|undefined} entry    目次の1件
 * @param {{h:string, n:number}} incoming  今回届いたものの、照合用の値と行数
 * @returns {{action:'store'|'same'|'candidate'|'confirm', entry:object}}
 *   store     保管する（初めて、または行数が同じか増えていて中身が変わった）
 *   same      今の保管と同じ中身だった（更新候補があれば取り消す。一時的な乱れだったということ）
 *   candidate 行が減っていた。今の保管を残し、更新候補として覚える
 *   confirm   同じ「行が減った版」が繰り返し確認できた。最新版として置き換える
 */
export function decideArchiveUpdate(entry, incoming, now, cfg = CONFIG) {
  const a = cfg.archive;
  const fresh = { n: incoming.n, h: incoming.h, at: now };
  if (!entry) return { action: 'store', entry: fresh };
  if (incoming.h === entry.h) return { action: 'same', entry: { n: entry.n, h: entry.h, at: now } };
  if (incoming.n >= entry.n) return { action: 'store', entry: fresh };
  const seenBefore = entry.cand && entry.cand.h === incoming.h ? entry.cand : null; // 別の中身に変わっていたら、数え直す
  const cand = seenBefore ? { ...seenBefore, seen: seenBefore.seen + 1, last: now } : { h: incoming.h, n: incoming.n, first: now, last: now, seen: 1 };
  if (cand.seen >= a.shrinkConfirmCount && now - cand.first >= a.shrinkConfirmHours * 3600000) return { action: 'confirm', entry: fresh };
  return { action: 'candidate', entry: { n: entry.n, h: entry.h, at: now, cand } };
}
