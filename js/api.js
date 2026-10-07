// SOXAI 公式 Web API クライアント（読み取り専用）。
// 仕様の出典: https://github.com/soxaidev/web-api-docs （openapi-public.json）
//
// 方針:
// - 使うのはログイン・トークン更新・データ取得（GET）だけ。書き込み系は一切呼ばない。
// - 「通信の失敗」と「ログイン切れ」を混同しない。圏外や 5xx でログアウトさせない。
// - GET は副作用が無いので、429 と 5xx に限り 1 回だけ待って再試行する。

import { API_BASE, DAILY_MAX_DAYS, DAILY_FALLBACK_DAYS } from './config.js';
import { store } from './store.js';
import { addDays, diffDays } from './ui.js';

export class ApiError extends Error {
  /** @param {'invalid-login'|'too-many-attempts'|'disabled'|'auth-expired'|'rate-limited'|'network'|'server'|'forbidden'|'bad-request'|'unexpected'} kind */
  constructor(kind, message, extra = {}) {
    super(message);
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TIMEOUT_MS = 30000;
let dailyWindowDays = DAILY_MAX_DAYS;
let refreshing = null; // 同時に複数の更新要求が走らないようにする

async function http(method, path, { query, body, headers } = {}) {
  let url = API_BASE + path;
  if (query) url += '?' + new URLSearchParams(query).toString();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    throw new ApiError('network', e && e.name === 'AbortError' ? '応答が返ってきませんでした（時間切れ）' : 'SOXAI に接続できませんでした');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: res.status, data, retryAfter: Number(res.headers.get('Retry-After')) || 0 };
}

function errorText(data) {
  if (data && typeof data === 'object') return String(data.error_msg || data.msg || data.error || '');
  return typeof data === 'string' ? data.slice(0, 200) : '';
}

// ------------------------------------------------------------ ログイン
/** メールアドレスとパスワードでログインする。パスワードは保存しない。 */
export async function login(email, password) {
  const { status, data } = await http('POST', '/api/login', { body: { email, password, returnSecureToken: true } });
  if (status === 429) throw new ApiError('rate-limited', '短時間に試行しすぎました。少し待ってからもう一度お試しください');
  if (status >= 500) throw new ApiError('server', `SOXAI 側でエラーが起きています（${status}）`);
  // 公式仕様: ログイン失敗も HTTP 200 の本文で返る。ステータスではなく中身で判定する。
  const reason = data && data.error && typeof data.error === 'object' ? String(data.error.message || '') : '';
  if (reason) {
    if (reason.startsWith('TOO_MANY_ATTEMPTS')) throw new ApiError('too-many-attempts', '試行回数が多すぎるため、一時的にログインが止められています。時間を置いてお試しください');
    if (reason.startsWith('USER_DISABLED')) throw new ApiError('disabled', 'このアカウントは無効化されています。SOXAI サポートへご確認ください');
    throw new ApiError('invalid-login', 'メールアドレスとパスワードの組み合わせが登録内容と一致しません');
  }
  if (status !== 200 || !data || !data.idToken || !data.refreshToken || !data.localId) {
    throw new ApiError('unexpected', `ログインの応答が想定と違います（${status} ${errorText(data)}）`);
  }
  const ttl = Number(data.expiresIn) || 3600;
  store.setAuth({ refreshToken: data.refreshToken, uid: data.localId });
  store.setSession({ idToken: data.idToken, exp: Date.now() + ttl * 1000 });
  return { uid: data.localId };
}

export function logout() {
  store.clearAuth();
}

export function isLoggedIn() {
  const a = store.getAuth();
  return !!(a && a.refreshToken && a.uid);
}

async function refreshIdToken() {
  const auth = store.getAuth();
  if (!auth || !auth.refreshToken) throw new ApiError('auth-expired', 'ログインが必要です');
  // 本文は「裸の JSON 文字列」（公式仕様）
  const { status, data } = await http('POST', '/api/refreshToken', { body: auth.refreshToken });
  if (status === 200 && data && data.id_token) {
    const ttl = Number(data.expires_in) || 3600;
    if (data.refresh_token && data.refresh_token !== auth.refreshToken) {
      store.setAuth({ ...auth, refreshToken: data.refresh_token });
    }
    const session = { idToken: data.id_token, exp: Date.now() + ttl * 1000 };
    store.setSession(session);
    return session.idToken;
  }
  if (status === 400 || status === 401 || status === 403) {
    // 更新トークンそのものが失効。保存済みデータは残したまま、再ログインを求める。
    store.clearSession();
    throw new ApiError('auth-expired', 'ログインの有効期限が切れました。もう一度ログインしてください');
  }
  if (status === 429) throw new ApiError('rate-limited', 'アクセスが集中しています。少し待ってからお試しください');
  throw new ApiError('server', `SOXAI 側でエラーが起きています（${status}）`);
}

async function ensureToken(force = false) {
  const sess = store.getSession();
  if (!force && sess && sess.idToken && Date.now() < sess.exp - 60000) return sess.idToken;
  if (!refreshing) refreshing = refreshIdToken().finally(() => { refreshing = null; });
  return refreshing;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 認証付き GET。401 は1回だけトークンを取り直す。429/5xx は1回だけ待って再試行。 */
async function authedGet(path, query) {
  let token = await ensureToken();
  let retriedAuth = false;
  let retriedTransient = false;
  for (;;) {
    const { status, data, retryAfter } = await http('GET', path, { query, headers: { Authorization: `Bearer ${token}` } });
    if (status === 200) return data;
    if (status === 401 && !retriedAuth) {
      retriedAuth = true;
      token = await ensureToken(true);
      continue;
    }
    if ((status === 429 || status >= 500) && !retriedTransient) {
      retriedTransient = true;
      await sleep(Math.min(Math.max(retryAfter, 1), 20) * 1000);
      continue;
    }
    if (status === 401) throw new ApiError('auth-expired', 'ログインの有効期限が切れました。もう一度ログインしてください');
    if (status === 403) throw new ApiError('forbidden', `このデータを読む権限がありません（${errorText(data)}）`);
    if (status === 429) throw new ApiError('rate-limited', 'アクセスが集中しています。少し待ってからお試しください', { retryAfter });
    if (status === 400 || status === 422) throw new ApiError('bad-request', errorText(data) || '取得条件が受け付けられませんでした', { status });
    if (status >= 500) throw new ApiError('server', `SOXAI 側でエラーが起きています（${status}）`);
    throw new ApiError('unexpected', `想定外の応答です（${status} ${errorText(data)}）`);
  }
}

function asRows(data, what) {
  if (Array.isArray(data)) return data;
  // 公式仕様: 範囲にデータが無い時に {"msg":"No data found"} を返すエンドポイントがある
  if (data && typeof data === 'object' && typeof data.msg === 'string' && /no data/i.test(data.msg)) return [];
  throw new ApiError('unexpected', `${what}の応答が配列ではありません`);
}

// ------------------------------------------------------------ データ取得
/** 日次サマリを取得する（両端の日付を含む）。上限を超える期間は自動で分割する。 */
export async function fetchDaily(start, end) {
  const { uid } = store.getAuth();
  const rows = [];
  let from = start;
  while (from <= end) {
    const lastAllowed = addDays(from, dailyWindowDays - 1);
    const to = lastAllowed < end ? lastAllowed : end;
    try {
      const data = await authedGet(`/api/v2/DailyInfoData/${encodeURIComponent(uid)}`, { start_day: from, end_day: to });
      rows.push(...asRows(data, '日次データ'));
    } catch (e) {
      // 期間の上限が仕様書の記載より短かった場合は、短い窓に切り替えて同じ範囲をやり直す
      if (e.kind === 'bad-request' && dailyWindowDays > DAILY_FALLBACK_DAYS && diffDays(to, from) + 1 > DAILY_FALLBACK_DAYS) {
        dailyWindowDays = DAILY_FALLBACK_DAYS;
        continue;
      }
      throw e;
    }
    from = addDays(to, 1);
  }
  return rows;
}

/** 5分ごとのデータを取得する。startIso 以上 endIso 未満（オフセット付き ISO 8601）。 */
export async function fetchDetail(startIso, endIso) {
  const { uid } = store.getAuth();
  const data = await authedGet(`/api/v2/DailyDetailData/${encodeURIComponent(uid)}`, { start_day: startIso, end_day: endIso });
  return asRows(data, '詳細データ');
}

/**
 * SOXAI のクラウドが、最後にデータを処理した時刻（エポックミリ秒）。分からなければ null。
 * 応答は日本時間でタイムゾーンの表記が無い（実データで確認）。データの鮮度の表示に使う。
 * リングの同期履歴（sync-logs）は実アカウントで空だったので使わない。
 */
export async function fetchLastProcess() {
  const { uid } = store.getAuth();
  const data = await authedGet('/api/LastProcessLog', { query_uid: uid });
  const value = Array.isArray(data) && data[0] ? data[0].last_process_log_datetime : null;
  if (!value || typeof value !== 'string') return null;
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}+09:00`);
  return Number.isFinite(t) ? t : null;
}

export function dailyWindow() { return dailyWindowDays; }
