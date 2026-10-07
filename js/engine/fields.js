// SOXAI API の全項目の定義（唯一の正本）。
// - 分析エンジンはここの「0 の扱い」に従って欠損を判定する（設計書 1.1）。
// - docs/soxai_fields.md もこの表から生成する（dev/gen_fields_doc.mjs）。
//   設計書とコードで欠損ルールが食い違わないよう、定義はここ1か所だけに置く。
//
// zero（0 の扱い）:
//   MISS      常に欠損。0 は「データなし」
//   MISS_TBD  欠損（暫定）。尺度が未確認で、実データを見るまで 0 は欠損として扱う
//   NIGHT     夜があれば有効。その夜の睡眠が記録されていれば 0 は本物の値
//   WORN      装着中は有効。着けていた日や時間帯なら 0 は本物の値
//   CODE      区分値。0 は区分の1つで、欠損ではない
//   ANY       常に有効
//   NA        対象外（文字列・時刻・常に空・応答に出ない）
//
// cat（分類）: S 睡眠 / R 回復 / A 活動 / T ストレス / C 体調変化 / M 管理。複数は空白区切り。

export const ZERO_LABEL = {
  MISS: '常に欠損',
  MISS_TBD: '欠損（暫定）',
  NIGHT: '夜があれば有効',
  WORN: '装着中は有効',
  CODE: '区分値',
  ANY: '常に有効',
  NA: '対象外',
};

export const CATEGORY_LABEL = { S: '睡眠', R: '回復', A: '活動', T: 'ストレス', C: '体調変化', M: '管理' };

const f = (ja, cat, zero, note = '') => ({ ja, cat, zero, note });

/** 日次データ（/api/v2/DailyInfoData）の全項目 */
export const DAILY_FIELDS = {
  _time: f('日付（その日の0時UTC刻印）', 'M', 'NA'),
  uid: f('利用者ID', 'M', 'NA'),
  ML_ver: f('解析モデルの版', 'M', 'NA', '版が変わると値の傾向が変わりうる。変更日を検知して信頼度を下げる'),
  fw_ver: f('リングのファームウェア版', 'M', 'NA'),
  qol_score: f('QoLスコア（SOXAI算出の総合）', 'R', 'MISS', '参考表示。独自スコアの材料にはしない'),
  activity_score: f('活動スコア（SOXAI算出）', 'A', 'MISS', '参考表示'),
  activity_ree_calories: f('基礎代謝', 'A', 'MISS', '未装着の日も値が入る。装着の判定には使わない'),
  activity_calories: f('活動カロリー', 'A R', 'WORN', '前日の身体負荷の材料'),
  activity_steps: f('歩数', 'A R', 'WORN', '前日の身体負荷の材料'),
  activity_mets: f('活動強度（METs）', 'A R', 'MISS', '安静でも約1になるため、0 は欠損'),
  health_score: f('体調スコア（SOXAI算出）', 'R', 'MISS', '参考表示。独自スコアと並べて比較する'),
  health_hr_day_mean: f('日中の平均心拍', 'T C', 'MISS'),
  health_hr_day_max: f('日中の最高心拍', 'A', 'MISS'),
  health_hr_day_min: f('日中の最低心拍', 'R', 'MISS'),
  health_hrv_day_mean: f('日中の心拍変動の平均', 'T', 'MISS'),
  health_hrv_day_max: f('日中の心拍変動の最高', 'T', 'MISS'),
  health_hrv_day_min: f('日中の心拍変動の最低', 'T', 'MISS'),
  health_spo2: f('日中の血中酸素の平均', 'C', 'MISS'),
  health_spo2_max: f('日中の血中酸素の最高', '', 'MISS', '分析には使わない'),
  health_spo2_min: f('日中の血中酸素の最低', 'C', 'MISS'),
  health_stress: f('ストレスの1日平均', 'T', 'MISS_TBD', '尺度の定義が仕様書に無い。実データで分布を確認してから扱いを確定する'),
  health_stress_max: f('ストレスの最高', 'T', 'MISS_TBD'),
  health_stress_min: f('ストレスの最低', 'T', 'MISS_TBD', '最低値が本当に 0 になりうるかを実データで確認する'),
  health_temperature: f('皮膚温の1日平均', 'C R', 'MISS', '日中は外気の影響が大きい。夜間の皮膚温は5分データから別に作る'),
  health_temperature_max: f('皮膚温の最高', '', 'MISS', '分析には使わない'),
  health_temperature_min: f('皮膚温の最低', '', 'MISS', '分析には使わない'),
  health_bodytemperature: f('体温', '', 'NA', '常に空（仕様書に明記）'),
  health_bodytemperature_max: f('体温の最高', '', 'NA', '常に空'),
  health_bodytemperature_min: f('体温の最低', '', 'NA', '常に空'),
  sleep_score: f('睡眠スコア（SOXAI算出）', 'S', 'MISS', 'そのまま睡眠スコアとして使う'),
  sleep_time_in_bed: f('ベッドにいた時間', 'S', 'MISS', '0 は「その夜の記録が無い」'),
  sleep_total_sleep_time: f('睡眠時間', 'S R C', 'MISS', '0 は「その夜の記録が無い」。夜の有無の判定に使う'),
  sleep_awake_time: f('途中で起きていた時間', 'S C', 'NIGHT', '一度も起きなかった夜は本当に 0'),
  sleep_rem_sleep_time: f('レム睡眠の時間', 'S', 'NIGHT', '検出されなかった夜は 0'),
  sleep_light_sleep_time: f('浅い睡眠の時間', 'S', 'NIGHT'),
  sleep_deep_sleep_time: f('深い睡眠の時間', 'S', 'NIGHT', '検出されなかった夜は 0'),
  sleep_nap_time: f('昼寝（15分以上の日中の睡眠）', 'S', 'WORN', '昼寝をしなかった日は 0。睡眠負債の計算に加える'),
  sleep_latency: f('寝つきまでの時間', 'S', 'NIGHT', 'すぐ眠った夜は 0 に近い'),
  sleep_efficiency: f('睡眠効率', 'S C', 'MISS', '実データでは 0〜1 の比率で返る（仕様書の単位は %）。エンジンで % に直して使う'),
  sleep_start_time_true: f('就寝時刻', 'S', 'NA', '規則性の材料'),
  sleep_end_time_true: f('起床時刻', 'S', 'NA', '規則性の材料'),
  sleep_hr_mean: f('睡眠中の平均心拍', 'R C', 'MISS', '**回復と体調変化の中心指標**'),
  sleep_hr_min: f('睡眠中の最低心拍', 'R', 'MISS', '補助指標。最低心拍が出た位置とあわせて、夜間の回復の様子を見る。点数には入れない'),
  sleep_hr_max: f('睡眠中の最高心拍', '', 'MISS', '分析には使わない'),
  sleep_hrv_mean: f('睡眠中の心拍変動の平均', 'R C', 'MISS', '**回復と体調変化の中心指標**'),
  sleep_hrv_min: f('睡眠中の心拍変動の最低', '', 'MISS', '分析には使わない'),
  sleep_hrv_max: f('睡眠中の心拍変動の最高', '', 'MISS', '分析には使わない'),
  sleep_spo2_mean: f('睡眠中の血中酸素の平均', 'C', 'MISS', '体調変化の材料'),
  sleep_spo2_min: f('睡眠中の血中酸素の最低', 'C', 'MISS'),
  sleep_spo2_max: f('睡眠中の血中酸素の最高', '', 'MISS', '分析には使わない'),
  sleep_debt: f('睡眠負債（SOXAI算出）', 'S', 'NIGHT', '負債なしは 0。算出方法が仕様書に無いので独自計算と並べて確認する'),
  sleep_ahi_class: f('無呼吸低呼吸の指標の最大', 'C', 'NIGHT', '0 は区分の最小。参考表示のみで、判定の文言には使わない。SOXAI アプリの4段階評価との対応は照合中'),
  sleep_respiration_rate_mean: f('睡眠中の呼吸数の平均', 'C', 'MISS', '体調変化の材料'),
  utc_offset_mins: f('UTCとの時差（分）', 'M', 'ANY', '旅行時の時差の検知に使う'),
};

/** 5分ごとのデータ（/api/v2/DailyDetailData）の全項目 */
export const DETAIL_FIELDS = {
  _time: f('時刻（5分ごと）', 'M', 'NA'),
  uid: f('利用者ID', 'M', 'NA'),
  API_ver: f('APIの版', 'M', 'NA'),
  fw_ver: f('ファームウェア版', 'M', 'NA'),
  activity_zcm: f('体動の回数（生値）', 'A', 'WORN', '単位の記載なし。v1 では使わない'),
  activity_pim: f('活動量（生値）', 'A', 'WORN', '単位の記載なし。v1 では使わない'),
  activity_jerk: f('加速度の変化', '', 'NA', '仕様書に「応答には出ない」と記載'),
  activity_mets: f('活動強度（METs）', 'A T', 'MISS', '運動中かどうかの判定に使う'),
  activity_sleep_awake: f('睡眠か覚醒か（生値）', 'S', 'CODE', '値の意味の記載なし。実データで確認'),
  activity_calorie: f('消費カロリー', 'A', 'WORN'),
  activity_steps: f('歩数', 'A T', 'WORN', '動いていない5分間は本当に 0。運動中かどうかの判定に使う'),
  activity_confirm: f('データ確定フラグ（1=確定 0=未確定）', 'M', 'CODE', '未確定の時間帯は信頼度を下げる'),
  activity_type: f('活動の種類（0安静 1歩行 2走行 3その他 9不明）', 'A T', 'CODE', '0 は「安静」。実データでは値が入っていなかった。運動の判定は歩数と METs で行う'),
  activity_strength: f('活動の強さの指標', 'A', 'WORN'),
  activity_act_mlc: f('リング内処理の活動区分', '', 'CODE', 'v1 では使わない'),
  health_T: f('皮膚温', 'C R', 'MISS', '睡眠中の有効な値の中央値で「夜間の皮膚温」を作る'),
  health_cbt: f('深部体温', '', 'NA', '常に空（仕様書に明記）'),
  health_hr: f('心拍', 'T R', 'MISS', '最低心拍が出た位置の算出にも使う'),
  health_hrv: f('心拍変動（RMSSD）', 'T R', 'MISS'),
  health_lf: f('心拍変動の低周波成分', '', 'MISS', '単位の記載なし。v1 のストレス評価には使わない'),
  health_hf: f('心拍変動の高周波成分', '', 'MISS', '同上'),
  health_spo2: f('血中酸素', 'C', 'MISS'),
  health_stress: f('ストレス値', 'T', 'MISS_TBD', '尺度の定義は未公開。実データでは 0 は現れなかった（1 以上の値だけ）。v1 は相対的な高・中・低の補助表示にとどめる'),
  health_hr_dB: f('心拍信号の強さ（生値）', 'M', 'NA', '意味が未確認。計測品質の目安の候補'),
  sleep_hr: f('睡眠中の心拍', 'R S', 'MISS', '夜間の推移'),
  sleep_hrv: f('睡眠中の心拍変動', 'R S', 'MISS', '夜間の推移'),
  sleep_spo2: f('睡眠中の血中酸素', 'C S', 'MISS', '眠っていない行は空（仕様書に明記）'),
  sleep_stage: f('睡眠ステージ（0深い 1浅い 2レム 3覚醒）', 'S', 'CODE', '**0 は「深い睡眠」**。欠損にしてはいけない。区分は実データで確認したもので、仕様書の「2覚醒 3不明」とは異なる'),
  sleep_stage_1min: f('1分ごとの睡眠ステージ（5分ぶんを数字5桁で表す）', 'S', 'CODE', '例: 33111 は「覚醒3分のあと浅い睡眠2分」。先頭の 0 は省かれて届くので、5桁に戻して読む'),
  sleep_odi: f('酸素飽和度低下の指標（3%ODI）', 'C', 'NIGHT', '低下が無かった時間は 0。呼吸の系統の補助に使う。足し合わせた値を「回数」として表示しない（単位が未確認）'),
  sleep_respiration: f('呼吸数', 'C S', 'MISS'),
  utc_offset_mins: f('UTCとの時差（分）', 'M', 'ANY'),
};
