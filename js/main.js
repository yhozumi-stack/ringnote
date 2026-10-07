// アプリの枠（ヘッダー・タブ・画面の切り替え）と、同期のきっかけ。

import { h, icon, todayStr, addDays, dateLabel } from './ui.js';
import { MODE } from './config.js';
import { store } from './store.js';
import * as api from './api.js';
import * as data from './data.js';
import { todayView } from './views/today.js';
import { loginView } from './views/login.js';
import { sleepView } from './views/sleep.js';
import { stressView } from './views/stress.js';
import { trendsView } from './views/trends.js';
import { settingsView } from './views/settings.js';
import { banner } from './views/parts.js';

const root = document.getElementById('app');
const TABS = [['today', '今日', 'home'], ['sleep', '睡眠', 'moon'], ['stress', 'ストレス', 'heart'], ['trends', '推移', 'trend']];
const ROUTES = [...TABS.map((t) => t[0]), 'settings'];
const ui = { route: 'today', date: todayStr(), followToday: true, loginMessage: '' };

function routeFromHash() {
  const r = location.hash.replace(/^#\/?/, '');
  return ROUTES.includes(r) ? r : 'today';
}
const go = (route) => { location.hash = `#/${route}`; };

function setDate(date) {
  const today = todayStr();
  ui.date = date > today ? today : date;
  ui.followToday = ui.date === today;
  render();
}

const actions = {
  refresh: () => data.syncAll(),
  refreshAll: () => data.syncAll({ full: true }),
  setSubjective: data.setSubjective,
  toggleColdSymptom: data.toggleColdSymptom,
  setLifeValue: data.setLifeValue,
  previousValue: data.previousValue,
  setSleepNeed: data.setSleepNeed,
  setDemo: (on) => { data.setDemo(on); if (!on && !api.isLoggedIn()) render(); else go('today'); },
  logout: () => {
    api.logout();
    data.clearArchive();
    store.clearAll();
    data.loadCache();
    ui.loginMessage = '';
    render();
  },
};

/** データがいつの時点のものか。リングのデータが SOXAI に届いた時刻が分かればそれを、分からなければこのアプリが取得した時刻を出す */
function freshness(st, today) {
  if (ui.date !== today) return { text: '\u00a0', stale: false };
  const d = st.days.get(today);
  if (!(d && d.hasNight)) return { text: '昨夜のデータ未同期', stale: true };
  const ms = st.lastProcess || st.syncedAt;
  if (!ms) return { text: '今日', stale: false };
  const t = new Date(ms);
  const sameDay = todayStr() === `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const clockText = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  return { text: `今日・最終更新 ${sameDay ? clockText : `${t.getMonth() + 1}/${t.getDate()} ${clockText}`}`, stale: false };
}

function header(st, today) {
  if (ui.route === 'settings') {
    return h('header', { class: 'topbar' },
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': '戻る', onclick: () => go('today') }, icon('left')),
      h('div', { class: 'date' }, '設定'),
      h('span', { class: 'iconbtn', 'aria-hidden': 'true' }));
  }
  const dates = [...st.days.keys()];
  const first = dates.length ? dates[0] : today;
  const fresh = freshness(st, today);
  return h('header', { class: 'topbar' },
    h('button', { class: 'iconbtn', type: 'button', 'aria-label': '前の日', disabled: ui.date <= first || null, onclick: () => setDate(addDays(ui.date, -1)) }, icon('left')),
    h('div', { class: 'date' }, dateLabel(ui.date), h('small', { class: fresh.stale ? 'stale' : null }, fresh.stale ? icon('warn') : null, fresh.text)),
    h('button', { class: 'iconbtn', type: 'button', 'aria-label': '次の日', disabled: ui.date >= today || null, onclick: () => setDate(addDays(ui.date, 1)) }, icon('right')),
    h('button', { class: `iconbtn${st.syncing ? ' spin' : ''}`, type: 'button', 'aria-label': '更新', disabled: st.demo || st.syncing || null, onclick: actions.refresh }, icon('refresh')),
    h('button', { class: 'iconbtn', type: 'button', 'aria-label': '設定', onclick: () => go('settings') }, icon('gear')));
}

function tabbar() {
  return h('div', { class: 'tabbar' }, h('nav', { 'aria-label': '画面の切り替え' },
    TABS.map(([route, label, ic]) => h('a', { href: `#/${route}`, 'aria-current': ui.route === route ? 'page' : null }, icon(ic), label))));
}

function render() {
  // 時刻の入力欄を選んでいる間は描き直さない。描き直すと入力欄が作り直され、入力が途中で切れる
  // （iPhone では、時刻を選ぶ部品が途中で閉じてしまう）。入力欄から離れた時に、まとめて描き直す
  const active = document.activeElement;
  if (active && active.dataset && active.dataset.holdRender && root.contains(active)) { render.pending = true; return; }
  render.pending = false;
  const st = data.state;
  const loggedIn = api.isLoggedIn();

  // ログインが切れていたら、保存済みのデータは残したままログイン画面へ
  if (st.error && st.error.kind === 'auth-expired' && !st.demo) {
    api.logout();
    ui.loginMessage = st.error.message;
    st.error = null;
  }
  if (!api.isLoggedIn() && !st.demo) {
    root.replaceChildren(loginView({
      message: ui.loginMessage,
      onLoggedIn: () => { ui.loginMessage = ''; data.loadCache(); render(); data.syncAll(); },
      onDemo: () => actions.setDemo(true),
    }));
    return;
  }

  const today = todayStr();
  if (ui.followToday) ui.date = today;
  const mounts = []; // 画面に置いた後で描くグラフ（幅を測るため）
  const ctx = { date: ui.date, today, day: st.days.get(ui.date), result: st.results.get(ui.date), state: st, loggedIn, go, actions,
    loadNight: data.loadNight, loadStress: data.loadStress, mount: (fn) => mounts.push(fn), rerender: render };

  const notices = [];
  if (st.demo) notices.push(banner('demo', 'デモ表示中です。作り物のデータで、実際の記録ではありません。', { label: '終わる', onClick: () => actions.setDemo(false) }));
  if (MODE === 'mock') notices.push(banner('demo', '模擬サーバーに接続しています（開発用）。'));
  for (const n of data.notices()) notices.push(banner(n.tone, n.text));

  let body;
  if (ui.route === 'today') body = todayView(ctx);
  else if (ui.route === 'sleep') body = sleepView(ctx);
  else if (ui.route === 'stress') body = stressView(ctx);
  else if (ui.route === 'trends') body = trendsView(ctx);
  else body = settingsView(ctx);

  const scroll = window.scrollY;
  root.replaceChildren(header(st, today), h('main', { class: 'content' }, ...notices, ...body), tabbar());
  for (const fn of mounts) fn();
  if (render.lastRoute === ui.route) window.scrollTo(0, scroll); else window.scrollTo(0, 0);
  render.lastRoute = ui.route;
}

// ---------------------------------------------------------------- きっかけ
root.addEventListener('focusout', (ev) => {
  // 少し待つのは、入力欄の隣のボタンを押した時に、その押下を取りこぼさないため
  if (ev.target && ev.target.dataset && ev.target.dataset.holdRender) setTimeout(() => { if (render.pending) render(); }, 200);
});
window.addEventListener('hashchange', () => { ui.route = routeFromHash(); render(); });
data.onChange(render);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  render(); // 日付が変わっていた時のため
  data.syncIfStale();
  // SOXAI アプリで同期してから戻ってきた時: 昨夜のデータがまだ無ければ、自動で取り直す（設計書 13.5）
  if (!data.todayHasNight()) data.retryUntilArrived();
});

// 主観入力・生活ログは取り直せないので、端末の保存領域を消されにくくするよう申請する（効かない端末でも害は無い）
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

ui.route = routeFromHash();
data.loadCache();
render();
if (api.isLoggedIn()) data.syncAll();
