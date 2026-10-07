// 接続先の決定。
// 本番: SOXAI 公式 API に直接つなぐ。
// 模擬: このページ自体が localhost で開かれていて、かつ URL に ?mock=1 が付いている時だけ有効。
//       公開後のサイトでは絶対に模擬へ切り替わらない（接続先を外から差し替えられないようにするため）。

export const APP_NAME = 'リングノート';
export const APP_VERSION = '0.1.0';

const isLocalHost = ['localhost', '127.0.0.1'].includes(location.hostname);
const wantsMock = new URLSearchParams(location.search).get('mock') === '1';

export const MODE = isLocalHost && wantsMock ? 'mock' : 'prod';
export const API_BASE = MODE === 'mock' ? `${location.origin}/mock` : 'https://web-api.soxai.site';

// 取得の決まりごと（公式仕様の上限に合わせる）
export const DAILY_MAX_DAYS = 366;      // 1ユーザーの日次データは1回366日まで
export const DAILY_FALLBACK_DAYS = 31;  // 上限エラーが返った時の安全側の窓
export const BACKFILL_MAX_WINDOWS = 12; // 初回取得でさかのぼる最大回数（打ち切り時は画面に警告を出す）
export const REFRESH_TAIL_DAYS = 14;    // 毎回取り直す直近日数（当日分などは後から値が変わるため）
export const RESYNC_AFTER_MS = 10 * 60 * 1000; // アプリに戻った時、これより古ければ取り直す
export const STALE_DAYS = 2;            // データ最終日がこれより古ければ警告
export const BASELINE_WINDOW = 14;      // 平常値の計算に使う過去日数
export const BASELINE_MIN = 5;          // 平常値を出すのに必要な最小日数
