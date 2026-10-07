// 回復（独自のコンディションスコア 0〜100）。設計書 3.2。
// 重みと換算表は経験則による初期値（config.js）。主観入力は点数に混ぜない。

import { interpolate } from './util.js';

function fmtMin(min) {
  const m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60);
  return h ? `${h}時間${String(m % 60).padStart(2, '0')}分` : `${m}分`;
}

/** 望ましくない方向へのズレ → 点数。望ましい方向（負の値）は減点しない */
function zToScore(zBad, cfg) {
  return zBad < cfg.recovery.zToScore[0][0] ? 100 : interpolate(cfg.recovery.zToScore, zBad);
}

/**
 * @param {object} p
 * @param {object} p.cfg
 * @param {object} p.day     正規化済みの当日
 * @param {object} p.metrics 指標ごとの { value, base, dev, trend }
 * @param {object} p.debt    sleepDebt() の戻り値
 * @param {object|null} p.load 前日の身体負荷のズレ { z, diff }
 */
export function recoveryScore({ cfg, day, metrics, debt, load }) {
  const r = cfg.recovery;
  const parts = []; // { key, label, weight, score, phrase }

  // ---- 睡眠（昨夜 6割 + 睡眠負債 4割） ----
  const sleepMin = day.v.sleep_total_sleep_time;
  if (sleepMin != null) {
    const ratio = sleepMin / cfg.sleep.needMin;
    const durScore = interpolate(r.durationToScore, ratio);
    const eff = metrics.eff && metrics.eff.dev ? zToScore(-metrics.eff.dev.z, cfg) : null;
    const lastNight = eff == null ? durScore : r.lastNightMix.duration * durScore + r.lastNightMix.efficiency * eff;
    const debtScore = debt && debt.status === 'ok' ? interpolate(r.debtToScore, debt.minutes) : null;
    const score = debtScore == null ? lastNight : r.sleepMix.lastNight * lastNight + r.sleepMix.debt * debtScore;
    // 理由として挙げる文は、3つの材料のうち一番点数の低いものから作る
    const causes = [{ s: durScore, p: `睡眠時間が必要量より${fmtMin(cfg.sleep.needMin - sleepMin)}短め` }];
    if (eff != null) causes.push({ s: eff, p: '睡眠効率が平常より低め' });
    if (debtScore != null) causes.push({ s: debtScore, p: `睡眠負債が多め（${fmtMin(debt.minutes)}）` });
    const phrase = causes.sort((a, b) => a.s - b.s)[0].p;
    parts.push({ key: 'sleep', label: '睡眠', weight: r.weights.sleep, score, phrase, favorable: true });
  }

  // ---- 心拍変動（昨夜のズレ 7割 + 直近7日の傾向 3割） ----
  const hrv = metrics.hrv;
  if (hrv && hrv.dev) {
    const acute = zToScore(-hrv.dev.z, cfg);
    const trend = hrv.trend ? zToScore(-hrv.trend.z, cfg) : null;
    const score = trend == null ? acute : r.hrvMix.acute * acute + r.hrvMix.trend * trend;
    const pct = Math.round(Math.abs(hrv.dev.pct) * 100);
    const phrase = acute <= (trend ?? 100) || hrv.dev.diff < 0
      ? `心拍変動が平常より${pct}%低め`
      : '心拍変動がここ数日低めの傾向';
    parts.push({ key: 'hrv', label: '心拍変動', weight: r.weights.hrv, score, phrase, favorable: hrv.dev.diff >= 0 });
  }

  // ---- 睡眠中の平均心拍 ----
  const hr = metrics.hr;
  if (hr && hr.dev) {
    parts.push({ key: 'hr', label: '睡眠中の心拍', weight: r.weights.hr, score: zToScore(hr.dev.z, cfg),
      phrase: `睡眠中の心拍が平常より${Math.round(Math.abs(hr.dev.diff))}bpm高め`, favorable: hr.dev.diff <= 0 });
  }

  // ---- 夜間の皮膚温（上昇はそのまま、低下は半分の減点。0.3℃未満は減点しない） ----
  const temp = metrics.temp;
  if (temp && temp.dev) {
    const { diff, z } = temp.dev;
    let score = 100;
    if (Math.abs(diff) >= r.tempNoPenaltyBelow) {
      const full = zToScore(Math.abs(z), cfg);
      score = diff > 0 ? full : 100 - r.tempDownPenaltyRatio * (100 - full);
    }
    parts.push({ key: 'temp', label: '皮膚温', weight: r.weights.temp, score,
      phrase: `皮膚温が平常より${Math.abs(diff).toFixed(1)}℃${diff > 0 ? '高め' : '低め'}` });
  }

  // ---- 前日の身体負荷（高い時だけ減点） ----
  if (load && load.z != null) {
    parts.push({ key: 'load', label: '前日の活動量', weight: r.weights.load, score: interpolate(r.loadToScore, load.z),
      phrase: '前日の活動量が平常よりかなり多め' });
  }

  const hasHrv = parts.some((p) => p.key === 'hrv');
  const hasHr = parts.some((p) => p.key === 'hr');
  if (!hasHrv && !hasHr) {
    return { status: 'unavailable', reason: '心拍変動と睡眠中の心拍の両方が取れていないため、算出できません' };
  }

  // 取れなかった要素は外し、残りの重みで計算し直す
  const wsum = parts.reduce((a, p) => a + p.weight, 0);
  const score = Math.round(parts.reduce((a, p) => a + p.weight * p.score, 0) / wsum);
  const band = r.bands.find((b) => score >= b.min);

  // 理由の文章: 点数の低い要素を最大2つ、良かった要素を1つ
  const lows = parts.filter((p) => p.score < r.reasonLowBelow).sort((a, b) => a.score - b.score).slice(0, 2);
  // 良かった点に挙げるのは、点数が高く、かつ望ましい側にある要素だけ。
  // 平常の範囲内でも下がっている項目を「良好」と呼ぶと、下に並ぶ「今日の変化」の数字と食い違って見えるため。
  // 「前日の活動量が多すぎない」と「皮膚温が平常どおり」は、良かった点とは言えないので候補に入れない
  const good = parts.filter((p) => p.favorable && p.score >= r.reasonGoodAtLeast && !lows.includes(p))
    .sort((a, b) => b.weight - a.weight)[0] || null;
  let sentence;
  if (!lows.length) sentence = '主な指標はすべて平常の範囲でした。';
  else sentence = `${good ? `${good.label}は良好でしたが、` : ''}${lows.map((p) => p.phrase).join('、')}でした。`;

  const used = new Set(parts.map((p) => p.key));
  return {
    status: 'ok',
    score,
    band: band.key,
    label: band.label,
    sentence,
    components: parts.map((p) => ({ key: p.key, label: p.label, weight: Math.round((p.weight / wsum) * 1000) / 1000, score: Math.round(p.score) })),
    missing: Object.keys(r.weights).filter((k) => !used.has(k)),
    lows: lows.map((p) => p.key),
    good: good ? good.key : null,
  };
}
