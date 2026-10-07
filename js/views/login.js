// ログイン画面。パスワードは SOXAI へのログインに使うだけで、保存しない。

import { h } from '../ui.js';
import { APP_NAME, MODE } from '../config.js';
import * as api from '../api.js';

export function loginView({ message, onLoggedIn, onDemo }) {
  const error = h('div', { class: 'formerror', role: 'alert' }, message || '');
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', required: true });
  const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'ログイン');

  const form = h('form', { novalidate: true },
    h('label', { class: 'field' }, 'SOXAI アプリのメールアドレス', email),
    h('label', { class: 'field' }, 'SOXAI アプリのパスワード', password),
    error, submit);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!email.value.trim() || !password.value) { error.textContent = 'メールアドレスとパスワードを入力してください'; return; }
    submit.disabled = true;
    submit.textContent = 'ログインしています…';
    error.textContent = '';
    try {
      await api.login(email.value.trim(), password.value);
      password.value = '';
      onLoggedIn();
    } catch (e) {
      error.textContent = e && e.message ? e.message : 'ログインできませんでした';
      submit.disabled = false;
      submit.textContent = 'ログイン';
    }
  });

  return h('div', { class: 'login' },
    h('h1', null, APP_NAME),
    h('p', null, 'SOXAI RING のデータを、いつもの自分と比べて見るための個人用アプリです。SOXAI の公式アプリではありません。'),
    MODE === 'mock' ? h('div', { class: 'banner demo' }, h('div', { class: 'grow' }, '模擬サーバーにつないでいます（開発用）。本物の SOXAI には接続しません。')) : null,
    form,
    h('div', { class: 'btnrow' }, h('button', { class: 'btn secondary', type: 'button', onclick: onDemo }, 'ログインせずにデモを見る')),
    h('div', { class: 'fineprint' },
      h('ul', null,
        h('li', null, 'パスワードは SOXAI へのログインに使うだけで、保存しません。'),
        h('li', null, 'データは SOXAI からこの端末に直接届きます。ほかのサーバーは通りません。'),
        h('li', null, 'Google や Apple のログインで作ったアカウントは使えません。'))));
}
