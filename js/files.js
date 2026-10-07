// ファイルの保存と読み込み（主観入力・生活ログの書き出し用）。

import { h } from './ui.js';

/**
 * 文字列をファイルとして保存する。
 * iPhone などタッチ操作の端末では共有シートを開き（「ファイルに保存」を選べる）、それ以外ではダウンロードする。
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function saveTextFile({ filename, mime, text }) {
  const file = new File([text], filename, { type: mime });
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled'; // 利用者が共有シートを閉じた
      // 共有できない端末は、下のダウンロードに切り替える
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

/** 選ばれたファイルを文字列として読む。大きすぎるファイルは読まない */
export function readTextFile(file, { maxBytes = 5 * 1024 * 1024 } = {}) {
  if (!file) return Promise.reject(new Error('ファイルが選ばれていません'));
  if (file.size > maxBytes) return Promise.reject(new Error('ファイルが大きすぎます'));
  return file.text();
}
