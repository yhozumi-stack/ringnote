// 睡眠時の呼吸（設計書 5.1）。
//
// SOXAI アプリの「睡眠時無呼吸の傾向」は、睡眠中に血中酸素が下がった回数をもとにした評価で、
// アプリ内の説明に目安がある（2回未満 素晴らしい / 2〜5回未満 とても良い / 5〜14回 許容範囲 / 15回以上 注意）。
// 日次データの sleep_ahi_class にこの目安を当てはめると、アプリの表示と一致する（2026-10-09 に3夜分で確認）。
// ここでは、その当てはめだけを行う。sleep_ahi_class がどう計算されているかは分かっていないので、
// 5分ごとの sleep_odi を足したり平均したりした値を「回数」として扱うことはしない（実際に、段階と合わない夜があった）。

import { CONFIG } from './config.js';

/** SOXAI の目安での区分 { key, label }。値が無ければ null */
export function soxaiBreathingBand(value, cfg = CONFIG) {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const band = cfg.breathing.soxaiBands.find((b) => value < b.below);
  return band ? { key: band.key, label: band.label } : null;
}
