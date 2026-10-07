// 分析エンジンの調整値（設計書 v0.3）。
// 期間・下限・重み・しきい値はすべてここに集める。14日目と28日目の見直しでは、このファイルだけを変える。
// 値の根拠は設計書の該当章を参照。重みと換算表は経験則による初期値で、検証済みの値ではない（設計書 3.2）。

export const CONFIG = {
  // ---- 1.2 夜の区分 ----
  night: {
    analyzableMin: 180,        // 3時間以上で「分析できる夜」
    baselineMin: 240,          // 4時間以上で「平常値の材料にする夜」の候補
    minCoverage: 0.7,          // 睡眠中の5分データがこの割合以上そろっていること（欠け3割未満）
    tzShiftExcludeDays: 3,     // 時差のある移動から、この日数は平常値の材料にしない
  },

  // ---- 1.3 平常値 ----
  baseline: {
    windowDays: 28,            // 当日を含まない直前28日
    trendDays: 7,              // 直近の傾向は直前7日
    minValues: 7,              // 個別指標の平常値を出すのに必要な最少の夜数（暫定表示の開始）
    trendMinValues: 4,
  },

  // ---- 1.5 学習期間（平常値の材料にする夜の数） ----
  stages: {
    provisional: 7,            // 7〜13: 個別指標の自分比を暫定表示、体調変化は参考表示
    normal: 14,                // 14〜: 総合スコアと体調変化の検出を開始（信頼度 中）
    high: 21,                  // 21〜: 信頼度 高
  },

  // ---- 1.4 中心になる指標 ----
  // source: 日次項目の名前。'derived:xxx' は5分データから作る派生値
  // floorAbs / floorPct: ふだんのばらつきの下限（過敏な判定を防ぐ）
  // better: 'higher' 高い方が望ましい / 'lower' 低い方が望ましい / 'steady' 平常どおりが望ましい
  metrics: {
    hrv: { source: 'sleep_hrv_mean', label: '心拍変動', unit: 'ms', floorPct: 0.04, better: 'higher', show: 'pct' },
    hr: { source: 'sleep_hr_mean', label: '睡眠中の心拍', unit: 'bpm', floorAbs: 1.5, better: 'lower', show: 'diff' },
    temp: { source: 'derived:nightTemp', label: '皮膚温', unit: '℃', floorAbs: 0.15, better: 'steady', show: 'diff', digits: 1 },
    spo2: { source: 'sleep_spo2_mean', label: '血中酸素', unit: 'ポイント', floorAbs: 0.5, better: 'higher', show: 'diff', digits: 1 },
    resp: { source: 'sleep_respiration_rate_mean', label: '呼吸数', unit: '回/分', floorAbs: 0.4, better: 'steady', show: 'diff', digits: 1 },
    sleep: { source: 'sleep_total_sleep_time', label: '睡眠時間', unit: '分', floorAbs: 20, better: 'higher', show: 'diff' },
    eff: { source: 'sleep_efficiency', label: '睡眠効率', unit: 'ポイント', floorAbs: 2, better: 'higher', show: 'diff' },
    awake: { source: 'sleep_awake_time', label: '途中で起きていた時間', unit: '分', floorAbs: 5, better: 'lower', show: 'diff' },
    odi: { source: 'derived:nightOdi', label: '酸素低下の指標', unit: '', floorAbs: 1.0, better: 'lower', show: 'diff', digits: 1 },
    // 記録との関係（5.4）で使うために平常値を持たせる。点数と体調変化の検出には使わない
    latency: { source: 'sleep_latency', label: '寝つくまでの時間', unit: '分', floorAbs: 5, better: 'lower', show: 'diff' },
  },

  // ---- 2.2 必要な睡眠時間と睡眠負債 ----
  sleep: {
    needMin: 450,              // 7時間30分（暫定値）。設定で変更できる。v1 では自動推定しない
    debtWindowDays: 14,
    debtRecentDays: 7,         // 直近7日はそのまま、それより前は半分の重み
    debtOlderWeight: 0.5,
    debtMinNights: 5,          // 直近14日に5夜以上ある時だけ算出
    debtBands: [               // 分。Oura の公開仕様と同じ区切り
      { key: 'none', label: 'なし', max: 0 },
      { key: 'low', label: '低', max: 120 },
      { key: 'mid', label: '中', max: 300 },
      { key: 'high', label: '高', max: Infinity },
    ],
    regularityDays: 7,
    regularityMinNights: 4,
    regularityBands: [         // 睡眠中央時刻のばらつき（分）
      { key: 'stable', label: '安定', max: 30 },
      { key: 'fair', label: 'ふつう', max: 60 },
      { key: 'irregular', label: '不規則', max: Infinity },
    ],
    shortSleepMin: 300,        // 5時間未満は「軽めがおすすめ」（4章）
  },

  // ---- 3.2 回復（コンディションスコア） ----
  recovery: {
    weights: { sleep: 0.30, hrv: 0.25, hr: 0.20, temp: 0.15, load: 0.10 },
    sleepMix: { lastNight: 0.6, debt: 0.4 },
    lastNightMix: { duration: 0.7, efficiency: 0.3 },
    hrvMix: { acute: 0.7, trend: 0.3 },
    // 望ましくない方向へのズレ → 点数（間は直線でつなぐ）
    zToScore: [[0.5, 100], [1.0, 85], [1.5, 72], [2.0, 60], [3.0, 35], [4.0, 10]],
    // 必要な睡眠時間に対する充足率 → 点数
    durationToScore: [[0.4, 10], [0.5, 20], [0.7, 55], [0.85, 80], [1.0, 100]],
    // 睡眠負債（分）→ 点数
    debtToScore: [[0, 100], [120, 80], [300, 50], [480, 20]],
    // 前日の身体負荷のズレ → 点数（高い時だけ減点）
    loadToScore: [[1.0, 100], [2.0, 80], [3.0, 60], [4.0, 40]],
    tempNoPenaltyBelow: 0.3,   // 皮膚温の差が 0.3℃ 未満なら減点しない
    tempDownPenaltyRatio: 0.5, // 低下方向は半分の減点
    bands: [
      { key: 'great', label: 'かなり良好', min: 90 },
      { key: 'good', label: '良好', min: 75 },
      { key: 'lowered', label: 'やや低下', min: 60 },
      { key: 'recover', label: '回復優先', min: 0 },
    ],
    reasonLowBelow: 85,        // この点数未満の要素を「理由」として挙げる
    reasonGoodAtLeast: 90,     // この点数以上の要素を「良かった点」として挙げる（前日の活動量は対象外）
  },

  // ---- 3.4 体調変化の検出 ----
  radar: {
    degreeStart: 1.0,          // ズレがこれ以下なら異常度 0
    degreeFull: 2.0,           // これ以上なら異常度 1
    systemFlagAt: 0.5,         // 系統の異常度がこれ以上で「外れ」
    // 信号: metric = CONFIG.metrics のキー / dir = 'down' 低下を見る, 'up' 上昇を見る
    // guard = 絶対量の下限（届かなければ異常度 0）。pct は平常比
    systems: {
      auto: {
        label: '自律神経', cap: 1.5,
        signals: [
          { metric: 'hrv', dir: 'down', guardPct: 0.05, text: '心拍変動 ↓' },
          { metric: 'hr', dir: 'up', guardAbs: 2, text: '睡眠中の心拍 ↑' },
        ],
      },
      temp: {
        label: '体温', cap: 1.0,
        signals: [{ metric: 'temp', dir: 'up', guardAbs: 0.3, text: '皮膚温 ↑' }], // 上昇のみ。低下は数えない
      },
      resp: {
        label: '呼吸', cap: 1.5,
        signals: [
          { metric: 'resp', dir: 'up', guardAbs: 1.0, text: '呼吸数 ↑' },
          { metric: 'spo2', dir: 'down', guardAbs: 1.0, text: '血中酸素 ↓' },
          { metric: 'odi', dir: 'up', guardAbs: 2.0, text: '酸素低下の指標 ↑', scale: 0.25 }, // 補助。最大 0.25
        ],
      },
    },
    // 補助（根拠の表示にだけ使い、系統には数えない）
    aux: [
      { metric: 'eff', dir: 'down', guardAbs: 3, text: '睡眠効率 ↓' },
      { metric: 'awake', dir: 'up', guardAbs: 15, text: '途中覚醒 ↑' },
    ],
    auxAt: 1.5,                // 補助は、ズレがこれ以上の時に根拠として表示
    mildSystems: 2,            // 2系統で「軽い兆候」
    strongSystems: 3,          // 3系統で「強い兆候」
    consecutiveForStrong: 2,   // 「軽い兆候」以上が2夜連続でも「強い兆候」
    clearNightsToReturn: 2,    // 兆候の後、0 が2夜連続で「平常範囲に戻りました」
    levels: {
      none: '兆候なし',
      mild: '軽い兆候',
      strong: '強い兆候',
    },
  },

  // ---- 3.3 ストレス ----
  stress: {
    windowDays: 14,
    minDays: 7,                // 7日たまるまでは区分しない
    minEpochsPerDay: 24,       // その日を分布の材料にする最少の5分枠（2時間分）
    highQuantile: 0.75,
    lowQuantile: 0.25,
    exercise: { types: [1, 2], metsAtLeast: 3.0, stepsAtLeast: 250, cooldownEpochs: 2 }, // 運動中と、その後10分
    still: { maxSteps: 10, type: 0 },  // 「動いていない」5分枠（独自指標用）
    blocks: [                  // 時間帯（現地時刻の時）
      { key: 'morning', label: '朝', from: 5, to: 11 },
      { key: 'day', label: '昼', from: 11, to: 17 },
      { key: 'evening', label: '夕方', from: 17, to: 22 },
      { key: 'night', label: '夜', from: 22, to: 5 },
    ],
    ownIndex: { minHrvCoverage: 0.7, rollingEpochs: 3 }, // 独自指標の採用条件と、15分の移動中央値
  },

  // ---- 4 今日の運動の目安（割合などの数字は出さない） ----
  guidance: {
    levels: {
      recover: { label: '回復優先', text: '筋トレは休むか、散歩やストレッチ程度に' },
      light: { label: '軽めがおすすめ', text: '重量か回数を控えめにして、限界まで追い込まない' },
      normal: { label: '通常どおり', text: '予定どおりのメニューで' },
      good: { label: '状態は良好', text: '予定どおりのメニューで。体の状態は良好です' },
    },
    order: ['good', 'normal', 'light', 'recover'], // 右ほど控えめ。当てはまる中で一番控えめなものを出す
    // 主観入力の反映（この5つだけ）。飲酒・カフェイン・IQOS・精神的ストレス・筋トレ負荷は、v1 では目安を変えない
    subjective: [
      { field: 'condition', value: 'bad', level: 'recover', reason: '体調が「悪い」と入力' },
      { field: 'cold', value: 'yes', level: 'recover', reason: '風邪っぽい症状が「あり」と入力' },
      { field: 'cold', value: 'slight', level: 'light', reason: '風邪っぽい症状が「少し」と入力' },
      { field: 'fatigue', value: 'high', level: 'light', reason: '疲労感が「強い」と入力' },
      { field: 'soreness', value: 'high', level: 'light', reason: '筋肉痛が「強い」と入力' },
    ],
  },

  // ---- 5.3 主観入力・生活ログ ----
  lifelog: {
    backupRemindDays: 7,       // 記録のバックアップを、この日数書き出していなければ、今日の画面で小さく知らせる
    energyMgPerCan: 120,       // エナジードリンク1本のカフェイン量（100mL あたり 48mg、250mL）
    // 最後にカフェインを摂った時刻の区分（前日の0時から数えた時刻。before 未満がその区分）
    caffeineBands: [
      { key: 'am', before: 12 },
      { key: 'early', before: 15 },
      { key: 'late', before: 18 },
      { key: 'night', before: Infinity },
    ],
    // コーヒーとエナジードリンクの集計用の区分（max 以下がその区分）。保存するのは実際の杯数・本数で、区分は集計の時に計算するだけ
    coffeeBands: [
      { key: '0', label: '0杯', max: 0 },
      { key: '1', label: '1杯', max: 1 },
      { key: '2', label: '2杯', max: 2 },
      { key: '3', label: '3杯', max: 3 },
      { key: '4+', label: '4杯以上', max: Infinity },
    ],
    energyBands: [
      { key: '0', label: '0本', max: 0 },
      { key: '1', label: '1本', max: 1 },
      { key: '2', label: '2本', max: 2 },
      { key: '3+', label: '3本以上', max: Infinity },
    ],
    // IQOS の本数の区分（max 以下がその区分）。0本は「入力した 0」だけで、未入力とは別
    iqosBands: [
      { key: '0', label: '0本', max: 0 },
      { key: '1-5', label: '1〜5本', max: 5 },
      { key: '6-10', label: '6〜10本', max: 10 },
      { key: '11-15', label: '11〜15本', max: 15 },
      { key: '16-20', label: '16〜20本', max: 20 },
      { key: '21+', label: '21本以上', max: Infinity },
    ],
    // IQOS の本数の本人比（少なめ / 普段どおり / 多め）。その日より前の、自分の記録の分布で分ける。
    // 保存しているのは常に実際の本数で、区分は集計の時に計算するだけ
    iqosRelative: {
      minDays: 30,             // 本数を入力した日が、この日数たまってから出す
      windowDays: 90,          // 基準にするのは、直前のこの日数
      lowQuantile: 0.25,       // これ未満を「少なめ」
      highQuantile: 0.75,      // これを超えたら「多め」
    },
    // 最後に IQOS を吸った時刻と就寝時刻の差（分）の区分（within 以下がその区分）
    iqosGapBands: [
      { key: 'within1h', label: '就寝1時間以内', within: 60 },
      { key: 'within2h', label: '就寝1〜2時間前', within: 120 },
      { key: 'earlier', label: 'それより前', within: Infinity },
    ],
    // 筋トレを終えた時刻の区分（就寝までの時間。分）
    trainingGapBands: [
      { key: 'within2h', label: '就寝2時間以内', within: 120 },
      { key: 'within4h', label: '就寝2〜4時間前', within: 240 },
      { key: 'earlier', label: 'それより前', within: Infinity },
    ],
  },

  // ---- 5.6 iPhone の中の、5分ごとの生データの保管 ----
  archive: {
    refreshDays: 3,            // 今日と、直近この日数は、開くたびに取り直す
    refreshGapMin: 30,         // ただし、取り直してからこの分数は、続けて取りに行かない
    recheckDays: 14,           // この日数以内で、1日ぶんに満たない日は確かめ直す
    recheckGapHours: 24,       // その間隔
    fullDayRows: 288,          // 1日ぶんの行数（5分 × 24時間）
    // 行が減った版を、最新版として採用する条件（両方を満たした時）。一時的な取得の乱れを採用しないため
    shrinkConfirmCount: 2,     // 同じ中身を、成功した取得でこの回数以上確認した
    shrinkConfirmHours: 12,    // かつ、最初に確認してからこの時間以上たっている
  },

  // ---- 5.4 記録との関係（件数による出し分け） ----
  insights: {
    refAt: 5,                  // この件数から、参考値として出す
    fullAt: 10,                // この件数から、通常の表示
    // 風邪っぽい症状の前後（1回目から記録として見せる。回数が少ないので、件数の基準は別にする）
    episode: {
      refAt: 3,                // この回数から、中央値を「参考」として出す
      fullAt: 5,               // この回数から、通常の集計として出す
      gapDays: 3,              // 症状の日がこの日数以内に続いていれば、同じ1回として数える
      before: 3,               // 始まった日の何日前から見るか
      after: 3,                // 始まった日の何日後まで見るか
    },
  },
};

/** 設定を上書きした新しい CONFIG を返す（例: 必要な睡眠時間の手動変更） */
export function withSettings(settings = {}) {
  if (!settings || settings.sleepNeedMin == null) return CONFIG;
  return { ...CONFIG, sleep: { ...CONFIG.sleep, needMin: settings.sleepNeedMin } };
}
