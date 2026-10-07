// 設定: 必要な睡眠時間、記録のバックアップ、AI 分析用データの書き出し、データの取り直し、デモ表示、ログアウト

import { h, fmtMinutes } from '../ui.js';
import { APP_NAME, APP_VERSION, MODE } from '../config.js';
import * as data from '../data.js';
import { saveTextFile, readTextFile } from '../files.js';
import { card } from './parts.js';

// 書き出し・読み込みの途中経過（この起動のあいだだけ覚える）
const io = { message: '', error: false, preview: null }; // ① 記録のバックアップ
const ai = { message: '', error: false };                // ② AI 分析用データ
const lo = { message: '', error: false, confirming: false }; // ログアウトの確認

function timeOf(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 書き出しの共通処理。make はファイルの中身を作る関数（時間のかかるものは Promise を返す） */
function exporter(ctx, box, make, { backup = false } = {}) {
  const say = (message, error = false) => { box.message = message; box.error = error; ctx.rerender(); };
  return async () => {
    try {
      say('準備しています…');
      const file = await make();
      if (!file.days) return say('まだ書き出せる記録がありません。');
      const how = await saveTextFile(file);
      if (how === 'cancelled') return say('書き出しを取りやめました。');
      if (backup) data.markLifelogExported();
      const lost = file.missing ? ` 取得できなかった日が ${file.missing}日あり、ファイルの中に日付を書いてあります。` : '';
      say(how === 'shared' ? `${file.days}日分を書き出しました。共有先で「ファイルに保存」を選ぶと、iPhone に残せます。${lost}` : `${file.days}日分を ${file.filename} として保存しました。${lost}`);
    } catch (e) {
      say(`書き出せませんでした: ${(e && e.message) || '原因不明'}`, true);
    }
  };
}

const messageBox = (box) => (box.message ? h('div', { class: `importbox${box.error ? ' error' : ''}`, role: box.error ? 'alert' : 'status' }, box.message) : null);

// ① 記録のバックアップ: 主観入力・生活ログとアプリの設定。JSON は読み込んで元に戻せる
function backupCard(ctx) {
  const st = ctx.state;
  const days = Object.keys(st.subjective).length;
  const last = st.prefs.lastExport;
  const since = data.daysSinceExport();
  const say = (message, error = false) => { io.message = message; io.error = error; ctx.rerender(); };

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': '読み込む JSON ファイルを選ぶ' });
  fileInput.addEventListener('change', async () => {
    io.preview = null;
    try {
      const preview = data.previewLifelogImport(await readTextFile(fileInput.files[0]));
      if (!preview.ok) return say(preview.error, true);
      io.preview = preview;
      say('');
    } catch (e) {
      say(`読み込めませんでした: ${(e && e.message) || '原因不明'}`, true);
    }
  });

  let previewBox = null;
  if (io.preview) {
    const p = io.preview;
    const old = p.legacy && (p.legacy.capped || p.legacy.mental)
      ? ` 古い形式のファイルです。コーヒー「4杯以上」・エナジードリンク「3本以上」として記録された日が ${p.legacy.capped}日あり、4杯・3本として読み込みます。精神的ストレスの記録 ${p.legacy.mental}日分は、今朝のものとして入力されたものです。`
      : '';
    previewBox = h('div', { class: 'importbox' },
      `ファイルの記録: ${p.count}日分。新しく加わる日 ${p.added}日、今の記録を書き換える日 ${p.updated}日、同じ内容の日 ${p.unchanged}日。`,
      p.settings ? ' 必要な睡眠時間の設定も読み込みます。' : '',
      p.skipped ? ` 読めなかった行が ${p.skipped} 件あります（その行は読み込みません）。` : '',
      old,
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn', type: 'button', onclick: () => {
          const ok = data.applyLifelogImport(p);
          io.preview = null;
          say(ok ? `${p.added + p.updated}日分を読み込みました。` : 'この端末に保存できませんでした。', !ok);
        } }, 'この内容で読み込む'),
        h('button', { class: 'btn secondary', type: 'button', onclick: () => { io.preview = null; say(''); } }, 'やめる')));
  }

  return card('記録のバックアップ', '主観入力・生活ログと、このアプリの設定です。この端末にしか無い記録なので、機種変更やデータ消去に備えて、ときどき書き出してください。JSON は読み込んで元に戻せます。',
    h('dl', { class: 'kv' },
      h('dt', null, '記録のある日'), h('dd', null, `${days} 日`),
      h('dt', null, '最後に書き出した日'), h('dd', null, last ? `${timeOf(last.at)}${since ? `（その後 ${since}日分の入力）` : ''}` : 'まだ書き出していません')),
    h('div', { class: 'btnrow top' },
      h('button', { class: 'btn secondary', type: 'button', onclick: exporter(ctx, io, () => data.buildLifelogExport('json'), { backup: true }) }, '書き出す（JSON・復元用）'),
      h('button', { class: 'btn secondary', type: 'button', onclick: exporter(ctx, io, () => data.buildLifelogExport('csv'), { backup: true }) }, '書き出す（CSV・表計算用）'),
      st.demo ? null : h('label', { class: 'btn secondary filebtn' }, '読み込む（JSON）', fileInput)),
    st.demo ? h('p', { class: 'explain' }, 'デモ表示中は、読み込みはできません。書き出されるのは作り物の記録です。') : null,
    previewBox,
    messageBox(io));
}

// ② AI 分析用データ: SOXAI のデータ・主観入力と生活ログ・このアプリの計算結果を、日付で結合したもの
function analysisCard(ctx) {
  const st = ctx.state;
  const a = data.archiveSummary();
  const held = st.demo ? 'デモ表示中は保管しません' : a.days ? `${a.days} 日分（${a.first.slice(5).replace('-', '/')}〜${a.last.slice(5).replace('-', '/')}）` : 'まだありません';
  return card('AI 分析用データの書き出し', 'SOXAI から届いたデータ（そのままの値）、主観入力・生活ログ、このアプリが計算した値を、日付でまとめて書き出します。後から別のやり方で分析し直すためのものです。',
    h('dl', { class: 'kv' },
      h('dt', null, '日ごとのデータ'), h('dd', null, `${Object.keys(st.raw).length} 日分`),
      h('dt', null, '5分ごとの生データの保管'), h('dd', null, held),
      !st.demo && a.waiting ? h('dt', null, 'これから保管する日') : null, !st.demo && a.waiting ? h('dd', null, `${a.waiting} 日（同期のたびに少しずつ進みます）`) : null),
    h('div', { class: 'btnrow top' },
      h('button', { class: 'btn secondary', type: 'button', onclick: exporter(ctx, ai, () => data.buildAnalysisFile('json')) }, '日ごとのデータ（JSON）'),
      h('button', { class: 'btn secondary', type: 'button', onclick: exporter(ctx, ai, () => data.buildAnalysisFile('csv')) }, '日ごとのデータ（CSV）'),
      h('button', { class: 'btn secondary', type: 'button', onclick: exporter(ctx, ai, () => data.buildDetailFile(30)) }, '5分ごとのデータ（直近30日・別ファイル）'),
      h('button', { class: 'btn secondary', type: 'button', onclick: exporter(ctx, ai, () => data.buildDetailFile(100000)) }, '5分ごとのデータ（全期間・別ファイル）')),
    h('p', { class: 'explain' }, '健康に関するデータそのものが入ります。ファイルを渡す相手や置き場所は、ご自身で選んでください。5分ごとのデータは、端末に保管していない日があると SOXAI から取り直すので、時間がかかることがあります。'),
    messageBox(ai));
}

// ---------------------------------------------------------------- ログアウト
// ログアウトすると、この端末の中の記録が消える。押し間違いで失わないよう、消えるものと、最後に書き出した日時を見せてから確かめる。
function accountCard(ctx) {
  return card('アカウント', 'ログアウトすると、この端末に保存したデータが削除されます。押した後に、消えるものを確認する画面が出ます。',
    h('div', { class: 'btnrow' }, h('button', { class: 'btn danger', type: 'button',
      onclick: () => { lo.confirming = true; lo.message = ''; ctx.rerender(); const el = document.getElementById('logout-confirm'); if (el) el.scrollIntoView({ block: 'start' }); } }, 'ログアウト…')));
}

function logoutConfirmCard(ctx) {
  const st = ctx.state;
  const logDays = Object.keys(st.subjective).length;
  const last = st.prefs.lastExport;
  const since = data.daysSinceExport();
  const unsaved = logDays > 0 && (!last || since > 0); // まだ書き出していない記録があるか
  const a = data.archiveSummary();
  const backupLine = !logDays ? '主観入力・生活ログの記録はありません。'
    : !last ? 'まだ一度も書き出していません。'
      : since ? `${timeOf(last.at)}（その後に入力した ${since}日分は、まだ書き出していません）` : `${timeOf(last.at)}（その後の入力はありません）`;
  const close = () => { lo.confirming = false; lo.message = ''; ctx.rerender(); };
  return h('section', { class: `card ${unsaved ? 'notice-serious' : 'notice-warn'}`, id: 'logout-confirm', role: 'alertdialog', 'aria-label': 'ログアウトの確認' },
    h('h2', null, 'この端末に保存したデータが削除されます'),
    h('p', { class: 'line' }, 'ログアウトすると、次のものがこの端末から消えます。'),
    h('dl', { class: 'kv' },
      h('dt', null, '主観入力・生活ログ'), h('dd', null, `${logDays} 日分（取り直せません）`),
      h('dt', null, '5分ごとの生データの保管'), h('dd', null, `${a.days} 日分`),
      h('dt', null, '日ごとのデータ'), h('dd', null, `${Object.keys(st.raw).length} 日分`),
      h('dt', null, 'ログイン情報と設定'), h('dd', null, '削除')),
    h('p', { class: 'explain' }, 'SOXAI 側にあるデータは消えません。日ごとのデータと5分ごとのデータは、もう一度ログインすれば取り直せます。主観入力・生活ログは、この端末にしか無いので、書き出していない分は戻せません。'),
    h('dl', { class: 'kv backupline' },
      h('dt', null, '最後にバックアップした日時'), h('dd', null, backupLine)),
    h('div', { class: 'btnrow top' },
      logDays ? h('button', { class: 'btn', type: 'button', onclick: exporter(ctx, lo, () => data.buildLifelogExport('json'), { backup: true }) }, '先にバックアップを書き出す（JSON）') : null,
      h('button', { class: 'btn secondary', type: 'button', onclick: close }, 'やめる'),
      h('button', { class: 'btn danger', type: 'button', onclick: () => { lo.confirming = false; lo.message = ''; ctx.actions.logout(); } },
        unsaved ? 'バックアップせずに、削除してログアウト' : '削除してログアウト')),
    messageBox(lo));
}

export function settingsView(ctx) {
  const st = ctx.state;
  const out = [];

  // ---- 必要な睡眠時間（暫定値 7時間30分。自動の推定はしない） ----
  const current = st.settings.sleepNeedMin ?? 450;
  const select = h('select', { class: 'select', 'aria-label': '必要な睡眠時間' },
    Array.from({ length: 13 }, (_, i) => 360 + i * 15).map((min) => h('option', { value: min, selected: min === current || null }, fmtMinutes(min))));
  select.addEventListener('change', () => ctx.actions.setSleepNeed(Number(select.value) === 450 && st.settings.sleepNeedMin == null ? null : Number(select.value)));
  out.push(card('必要な睡眠時間', st.settings.sleepNeedMin == null ? '今は暫定値の7時間30分です。睡眠負債の計算に使います。' : '睡眠負債の計算に使います。',
    h('div', { class: 'filters' }, select,
      st.settings.sleepNeedMin != null ? h('button', { class: 'linkbtn', type: 'button', onclick: () => ctx.actions.setSleepNeed(null) }, '暫定値に戻す') : null)));

  // ---- 書き出し: ① 記録のバックアップ（復元用） ② AI 分析用データ ----
  out.push(backupCard(ctx), analysisCard(ctx));

  // ---- データ ----
  const nights = [...st.days.values()].filter((d) => d.hasNight).length;
  out.push(card('SOXAI のデータ', null,
    h('dl', { class: 'kv' },
      h('dt', null, 'リングのデータが SOXAI に届いた時刻'), h('dd', null, timeOf(st.lastProcess)),
      h('dt', null, 'このアプリが取得した時刻'), h('dd', null, timeOf(st.syncedAt)),
      h('dt', null, '睡眠の記録がある夜'), h('dd', null, `${nights} 夜`)),
    st.demo ? null : h('div', { class: 'btnrow top' },
      h('button', { class: 'btn secondary', type: 'button', disabled: st.syncing || null, onclick: ctx.actions.refresh }, st.syncing ? '更新しています…' : '今すぐ更新'),
      h('button', { class: 'btn secondary', type: 'button', disabled: st.syncing || null, onclick: ctx.actions.refreshAll }, '全期間を取り直す'))));

  // ---- デモ表示 ----
  out.push(card('デモ表示', '作り物のデータで、データがたまった後の画面を確認できます。実際のデータとは混ざりません。',
    h('div', { class: 'btnrow' },
      h('button', { class: 'btn secondary', type: 'button', onclick: () => ctx.actions.setDemo(!st.demo) }, st.demo ? 'デモ表示を終わる' : 'デモ表示にする'))));

  // ---- アカウント ----
  if (ctx.loggedIn) out.push(lo.confirming ? logoutConfirmCard(ctx) : accountCard(ctx));

  out.push(h('div', { class: 'fineprint' },
    h('p', null, `${APP_NAME} ${APP_VERSION}${MODE === 'mock' ? '（模擬サーバーに接続中）' : ''}`),
    h('ul', null,
      h('li', null, 'SOXAI の公式アプリではありません。'),
      h('li', null, '健康管理の参考用で、診断や治療を目的としたものではありません。'),
      h('li', null, 'データは SOXAI からこの端末に直接届き、この端末の中にだけ保存されます。'))));
  return out;
}
