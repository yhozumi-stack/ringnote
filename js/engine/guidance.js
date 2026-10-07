// 今日の運動の目安（設計書 4 章）。
// 段階は4つ。割合などの数字は出さない。当てはまるものの中で一番控えめなものを返す。
// 主観が悪い日は、計算結果より主観を優先する。学習中は、主観入力がある時だけ主観に基づく目安を返す。

/**
 * @param {object} p
 * @param {object} p.cfg
 * @param {object|null} p.recovery   recoveryScore() の戻り値（status が 'ok' の時だけ使う）
 * @param {object|null} p.radar      体調変化（status が 'active' の時だけ使う）
 * @param {number|null} p.sleepMin   昨夜の睡眠時間（分）。夜の記録が無ければ null
 * @param {object|null} p.subjective 主観入力（subjective.js の項目）。飲酒の印は目安に影響しない
 */
export function todayGuidance({ cfg, recovery, radar, sleepMin, subjective }) {
  const g = cfg.guidance;
  const votes = []; // { level, reason, source }

  const analysisReady = !!(recovery && recovery.status === 'ok');
  if (analysisReady) {
    const s = recovery.score;
    const level = s >= 90 ? 'good' : s >= 75 ? 'normal' : s >= 60 ? 'light' : 'recover';
    votes.push({ level, reason: `コンディション ${s}（${recovery.label}）`, source: 'analysis' });
  }
  if (radar && radar.status === 'active' && radar.level !== 'none') {
    votes.push({ level: radar.level === 'strong' ? 'recover' : 'light', reason: `体調の変化（${cfg.radar.levels[radar.level]}）`, source: 'analysis' });
  }
  if (analysisReady && sleepMin != null && sleepMin < cfg.sleep.shortSleepMin) {
    votes.push({ level: 'light', reason: '睡眠が5時間未満', source: 'analysis' });
  }
  for (const rule of g.subjective) {
    if (subjective && subjective[rule.field] === rule.value) votes.push({ level: rule.level, reason: rule.reason, source: 'subjective' });
  }

  if (!votes.length) {
    return { status: analysisReady ? 'ok' : 'learning', level: null, label: null, text: null, reasons: [], basedOn: 'none' };
  }
  const rank = (lv) => g.order.indexOf(lv);
  const top = votes.reduce((a, b) => (rank(b.level) > rank(a.level) ? b : a));
  const deciding = votes.filter((v) => v.level === top.level);
  return {
    status: 'ok',
    level: top.level,
    label: g.levels[top.level].label,
    text: g.levels[top.level].text,
    reasons: deciding.map((v) => v.reason),
    // 主観だけで決まった日（学習中を含む）は、そのことが分かるようにする
    basedOn: deciding.every((v) => v.source === 'subjective') ? 'subjective' : 'analysis',
  };
}
