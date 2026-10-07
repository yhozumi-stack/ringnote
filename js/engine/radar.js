// 体調変化の検出（設計書 3.4）。その夜1つ分の判定を行う。
// 連続日数の扱い（2夜連続で「強い兆候」、0 が2夜連続で「平常範囲に戻りました」）は index.js が時系列で行う。
// 病気の診断はしない。

import { clamp } from './util.js';

/** 信号1つの異常度（0〜1）。評価できない時は null。絶対量の下限に届かなければ 0。 */
function signalDegree(sig, metric, cfg) {
  if (!metric || !metric.dev) return null;
  const { diff, pct, z } = metric.dev;
  const zBad = sig.dir === 'up' ? z : -z;
  const moved = sig.dir === 'up' ? diff : -diff;
  if (sig.guardAbs != null && moved < sig.guardAbs) return 0;
  if (sig.guardPct != null && (pct == null || (sig.dir === 'up' ? pct : -pct) < sig.guardPct)) return 0;
  const d = clamp((zBad - cfg.radar.degreeStart) / (cfg.radar.degreeFull - cfg.radar.degreeStart), 0, 1);
  return d * (sig.scale ?? 1);
}

/**
 * 系統ごとの異常度と、外れた系統の数を求める。
 * @param {object} metrics 指標ごとの { value, base, dev }
 */
export function radarForNight(metrics, cfg) {
  const systems = {};
  let flagged = 0;
  let evaluable = 0;
  for (const [key, sys] of Object.entries(cfg.radar.systems)) {
    const signals = [];
    let sum = 0;
    let any = false;
    for (const sig of sys.signals) {
      const degree = signalDegree(sig, metrics[sig.metric], cfg);
      if (degree == null) continue;
      any = true;
      sum += degree;
      signals.push({ metric: sig.metric, text: sig.text, degree: Math.round(degree * 100) / 100,
        z: Math.round(metrics[sig.metric].dev.z * 100) / 100 });
    }
    // 信号は別々に評価するが、系統としての寄与には上限を置く（同じ原因の二重カウントを防ぐ）
    const score = Math.min(sys.cap, sum);
    const isFlagged = any && score >= cfg.radar.systemFlagAt;
    if (any) evaluable += 1;
    if (isFlagged) flagged += 1;
    systems[key] = { label: sys.label, evaluable: any, score: Math.round(score * 100) / 100, flagged: isFlagged, signals };
  }

  // 補助（睡眠）は根拠の表示にだけ使い、系統には数えない
  const aux = [];
  for (const sig of cfg.radar.aux) {
    const m = metrics[sig.metric];
    if (!m || !m.dev) continue;
    const zBad = sig.dir === 'up' ? m.dev.z : -m.dev.z;
    const moved = sig.dir === 'up' ? m.dev.diff : -m.dev.diff;
    if (zBad >= cfg.radar.auxAt && moved >= sig.guardAbs) aux.push({ metric: sig.metric, text: sig.text });
  }

  // 皮膚温の低下は系統に数えない。「今日の変化」に載せるための印だけ返す
  const t = metrics.temp;
  const tempDrop = !!(t && t.dev && -t.dev.diff >= cfg.radar.systems.temp.signals[0].guardAbs && -t.dev.z >= 1.5);

  let level = 'none';
  if (flagged >= cfg.radar.strongSystems) level = 'strong';
  else if (flagged >= cfg.radar.mildSystems) level = 'mild';

  return { level, flagged, evaluable, systems, aux, tempDrop };
}

/** 画面と DM に出す文章。診断の言葉は使わない。 */
export function radarMessage(radar, cfg) {
  if (radar.returned) return { title: '平常範囲に戻りました', lines: ['各指標が2夜続けて平常の範囲に収まりました。'] };
  if (radar.level === 'none') return null;
  const signs = [];
  for (const sys of Object.values(radar.systems)) {
    if (!sys.flagged) continue;
    for (const s of sys.signals) if (s.degree > 0) signs.push(s.text);
  }
  for (const a of radar.aux) signs.push(a.text);
  return {
    title: `体調の変化を検出しました（${cfg.radar.levels[radar.level]}）`,
    lines: [
      signs.join('　'),
      '身体に通常と異なる負荷がかかっている可能性があります。',
      '飲酒、強い運動、寝不足、暑さでも同じ変化が起きます。',
    ],
  };
}
