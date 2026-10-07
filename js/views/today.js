// Today: その日の状態を1画面で伝える（設計書 5.1）。
// 並び: コンディション（または学習の進み具合）→ 体調の変化（ある日だけ）→ 今日の運動の目安
//       → 主観入力・生活ログ → 昨夜の値と自分比 → 参考: SOXAI 公式スコア
// 数字や判定はすべて分析エンジンの結果をそのまま表示する。ここでは計算しない。

import { h, clock, fmtMinutes } from '../ui.js';
import { ring } from '../charts.js';
import { SUBJECTIVE_FIELDS, FIELD_GROUPS, COLD_SYMPTOMS, optionLabel, fieldsOf, missingFields, hadCaffeine, energyCaffeineMg } from '../engine/index.js';
import { card, chip, segmented } from './parts.js';
import * as data from '../data.js';
import { metricRow } from './metrics.js';

// SOXAI アプリを直接開く方法は公開されていないので、App Store の SOXAI RING のページを開く（そこから「開く」を押せる）
const SOXAI_APP_URL = 'https://apps.apple.com/jp/app/soxai-ring/id6741848747';

// ---------------------------------------------------------------- 上段: コンディション
function waitingCard(ctx) {
  const st = ctx.state;
  return h('section', { class: 'card' },
    h('div', { class: 'empty' },
      h('strong', null, '昨夜のデータがまだ SOXAI に同期されていません'),
      'SOXAI アプリを開いてリングを同期すると、1分ほどで反映されます。'),
    h('div', { class: 'btnrow' },
      h('a', { class: 'btn', href: SOXAI_APP_URL, target: '_blank', rel: 'noopener noreferrer' }, 'SOXAI アプリを開く'),
      h('button', { class: 'btn secondary', type: 'button', disabled: st.syncing || null, onclick: ctx.actions.refresh },
        st.syncing ? '取り直しています…' : '今すぐ取り直す')),
    h('p', { class: 'sub center' }, st.waiting ? '自動で取り直しています（15秒後、30秒後、60秒後）' : 'SOXAI アプリから戻ると、自動で取り直します'));
}

function learningCard(result) {
  const need = result.stage.needed;
  const collected = Math.min(need, result.stage.nights + (result.night.baselineEligible ? 1 : 0));
  const dots = h('div', { class: 'dots14', role: 'img', 'aria-label': `${need}夜のうち${collected}夜分がたまりました` },
    Array.from({ length: need }, (_, i) => h('i', { class: i < collected ? 'on' : '' })));
  const left = need - collected;
  const note = result.stage.key === 'provisional'
    ? `あと${left}夜で、コンディションの点数と体調変化の検出が始まります。下の自分比は暫定です。`
    : `あと${left}夜で、コンディションの点数と体調変化の検出が始まります。7夜たまると、個別の指標の自分比が出ます。`;
  return h('section', { class: 'card' },
    h('div', { class: 'cap' }, 'ベースライン学習中'),
    h('div', { class: 'hero' }, h('div', { class: 'big' }, String(collected), h('span', { class: 'unit' }, `/ ${need} 夜`))),
    dots,
    h('p', { class: 'sub' }, note));
}

function conditionCard(result) {
  const rec = result.recovery;
  const box = h('div');
  ring(box, { value: rec.score, title: 'コンディション', size: 88, stroke: 9, hideNumber: true });
  const toneOf = { great: 'good', good: 'good', lowered: 'warn', recover: 'serious' };
  return h('section', { class: 'card' },
    h('div', { class: 'hero' },
      h('div', null, box),
      h('div', { class: 'grow' },
        h('div', { class: 'cap' }, 'コンディション'),
        h('div', { class: 'big' }, String(rec.score), h('span', { class: 'unit' }, '/ 100')),
        h('div', { class: 'chips' }, chip(rec.label, toneOf[rec.band]), chip(`信頼度 ${result.confidence.label}`)))),
    h('p', { class: 'sentence' }, rec.sentence),
    result.confidence.reasons.length ? h('p', { class: 'sub' }, result.confidence.reasons.join(' ')) : null);
}

function topCard(ctx) {
  const { day, result } = ctx;
  if (!day || !day.hasNight) {
    if (ctx.date === ctx.today) return waitingCard(ctx);
    return h('section', { class: 'card' }, h('div', { class: 'empty' }, h('strong', null, 'この日の睡眠の記録はありません'),
      'リングを着けずに眠ったか、同期されていない日です。'));
  }
  const rec = result.recovery;
  if (rec.status === 'ok') return conditionCard(result);
  if (rec.status === 'learning') return learningCard(result);
  return h('section', { class: 'card' }, h('div', { class: 'empty' }, h('strong', null, 'コンディションは算出できませんでした'), rec.reason || ''));
}

// ---------------------------------------------------------------- 体調の変化・運動の目安
function radarCard(result) {
  const radar = result.radar;
  if (!radar.message || (radar.status !== 'active' && radar.status !== 'reference')) return null;
  const tone = radar.returned ? 'good' : radar.level === 'strong' ? 'serious' : 'warn';
  return h('section', { class: `card notice-${tone}` },
    h('div', { class: 'chips' }, chip(radar.returned ? '平常範囲' : radar.label, tone),
      radar.status === 'reference' ? chip('参考（学習中）') : null),
    h('h2', null, radar.message.title),
    // 1行目は兆候の一覧（全角の空白区切り）。単語の途中で折り返さないよう、1つずつ分けて並べる
    radar.message.lines.filter(Boolean).map((line, i) => (i === 0 && line.includes('　')
      ? h('p', { class: 'line signs' }, line.split('　').map((sign) => h('span', null, sign)))
      : h('p', { class: 'line' }, line))),
    result.context.map((c) => h('p', { class: 'line context' }, c.text)));
}

function guidanceCard(result) {
  const g = result.guidance;
  if (!g || !g.level) return null;
  return h('section', { class: 'card' },
    h('div', { class: 'cap' }, '今日の運動の目安'),
    h('div', { class: 'bandlabel' }, g.label),
    h('p', { class: 'sentence' }, g.text),
    h('p', { class: 'sub' }, g.basedOn === 'subjective' ? `主観の入力に基づく目安です（${g.reasons.join('、')}）` : g.reasons.join('、')));
}

// ---------------------------------------------------------------- 参考: SOXAI 公式スコア
function soxaiCard(result) {
  const items = [['睡眠', result.soxai.sleep], ['体調', result.soxai.health], ['活動', result.soxai.activity]];
  if (items.every(([, v]) => v == null)) return null;
  return h('section', { class: 'card reference' },
    h('h2', null, '参考：SOXAI 公式スコア'),
    h('p', { class: 'sub' }, 'SOXAI が算出した値です。上のコンディションとは計算方法が違います。活動は1日の終わりに確定します。'),
    h('div', { class: 'rings three' }, items.map(([label, value]) => {
      const box = h('div');
      ring(box, { value, title: `SOXAI の${label}スコア`, size: 56, stroke: 6 });
      return h('div', { class: 'ringcell' }, box, h('span', { class: 'lbl' }, label));
    })));
}

// ---------------------------------------------------------------- 昨夜の値と自分比
function nightCard(ctx) {
  const { day, result } = ctx;
  if (!day || !day.hasNight) return null;
  const times = day.sleepStart != null ? `${clock(day.sleepStart, day.offset)} 就寝 → ${clock(day.sleepEnd, day.offset)} 起床` : '';
  const debt = result.sleep.debt;
  const sleepNote = h('div', { class: 'note' }, h('span', null, times));
  if (debt.status === 'ok') sleepNote.append(chip(`睡眠負債 ${debt.label}${debt.minutes ? `（${fmtMinutes(debt.minutes)}）` : ''}`, debt.band === 'high' ? 'warn' : ''));
  else sleepNote.append(h('span', { class: 'muted' }, `睡眠負債は、あと${debt.needed - debt.nights}夜分たまると表示されます`));
  // 体調の変化のカードが出ていない日は、飲酒の印の一言をここに添える
  const radarShown = result.radar.message && (result.radar.status === 'active' || result.radar.status === 'reference');
  return card('昨夜の値', result.stage.key === 'normal' ? '自分の平常値（直前28日の中央値）との比較です。' : null,
    radarShown ? null : result.context.map((c) => h('p', { class: 'contextnote' }, c.text)),
    h('div', { class: 'rows' },
      h('div', { class: 'rowitem' },
        h('div', { class: 'name' }, '睡眠時間'),
        h('div', { class: 'value' }, fmtMinutes(day.v.sleep_total_sleep_time)),
        sleepNote),
      ['hrv', 'hr', 'temp', 'spo2', 'resp'].map((k) => metricRow(ctx, k))));
}

// ---------------------------------------------------------------- 主観入力・生活ログ
// 毎日10秒ほどで終わることを優先する。どの項目も1タップ。くわしい入力は、必要な時だけ開く。
// まとまり（今日の状態 / 前日・昨夜の行動）の項目が全部入っている日は、1行の要約に畳む。
const openState = new Map(); // `${日付}|${まとまり}` → 開いているか（この起動のあいだだけ覚える）
const SHORT = { cold: '風邪っぽい症状', mental: '昨日のストレス', training: '筋トレ', energy: 'エナジードリンク' };
const moreOpen = new Set(); // `${日付}|${項目}` → 「4杯+」などを押して、数の入力欄を開いているか

function summaryText(group, cur) {
  const parts = fieldsOf(group).filter((k) => cur[k] != null).map((k) => `${SHORT[k] || SUBJECTIVE_FIELDS[k].label} ${optionLabel(k, cur[k], { long: true })}`);
  if (group === 'behavior' && cur.caffeineLast) parts.push(`最後のカフェイン ${cur.caffeineLast}`);
  if (group === 'behavior' && cur.iqosLast) parts.push(`最後の IQOS ${cur.iqosLast}`);
  return parts.length ? parts.join('・') : 'まだ入力していません';
}

// 入力の途中で描き直さないよう、入力欄を選んでいる間は描き直しを止める印を付ける（main.js の render を参照）
const HOLD = { holdRender: '1' };

/** 時刻を入れる行（最後にカフェインを摂った時刻、最後に IQOS を吸った時刻） */
function timeRow(ctx, cur, field, label, aria) {
  const input = h('input', { type: 'time', class: 'timeinput', value: cur[field] || null, 'aria-label': aria, dataset: HOLD });
  input.addEventListener('change', () => ctx.actions.setLifeValue(ctx.date, field, input.value));
  return h('div', { class: 'subjrow sub' }, h('span', { class: 'name' }, label),
    h('span', { class: 'timewrap' }, input,
      cur[field] ? h('button', { class: 'linkbtn', type: 'button', onclick: () => ctx.actions.setLifeValue(ctx.date, field, null) }, '消す') : null));
}

/** 入力欄から数を読む。空欄や数でないものは null（未入力） */
function readCount(input) {
  const text = input.value.trim();
  const n = Math.round(Number(text));
  return text === '' || !Number.isFinite(n) ? null : n; // 範囲の外の数は、保存の時に未入力として扱われる
}

/**
 * 杯数・本数を入れる行（コーヒー、エナジードリンク）。
 * よくある数は1タップ。それより多い時は「4杯+」を押して、実際の数を入れる（保存するのは常に実際の数。丸めない）。
 * 数を入れるまでは未入力のままにする（「4杯以上」を 4 として保存しない）。
 */
function quickCountRow(ctx, cur, field) {
  const def = SUBJECTIVE_FIELDS[field];
  const v = cur[field];
  const top = def.quick[def.quick.length - 1];
  const key = `${ctx.date}|${field}`;
  const open = (v != null && v > top) || moreOpen.has(key);
  const set = (n) => ctx.actions.setLifeValue(ctx.date, field, n);
  const options = [...def.quick.map((q) => [q, `${q}${def.unit}`]), ['more', `${top + 1}${def.unit}+`]];
  const seg = segmented(def.label, options, open ? 'more' : v, (picked) => {
    if (picked !== 'more') { moreOpen.delete(key); set(picked === v && !open ? null : picked); return; }
    if (open) { moreOpen.delete(key); if (v != null) set(null); else ctx.rerender(); return; } // もう一度押すと、未入力に戻る
    moreOpen.add(key);
    if (v != null) set(null); else ctx.rerender();
    const input = document.querySelector(`[data-count-field="${field}"]`);
    if (input) input.focus(); // 押した流れのまま入力に入れるよう、すぐに入力欄を選ぶ
  });
  const rows = [h('div', { class: 'subjrow' }, h('span', { class: 'name' }, def.label), seg)];
  if (open) {
    const input = h('input', { type: 'number', class: 'countinput', inputmode: 'numeric', pattern: '[0-9]*', min: top + 1, max: def.max, step: 1,
      placeholder: '数を入力', value: v ?? null, 'aria-label': `${def.label}の実際の数`, dataset: { ...HOLD, countField: field } });
    input.addEventListener('change', () => { const n = readCount(input); if (n != null && n <= top) moreOpen.delete(key); set(n); });
    rows.push(h('div', { class: 'subjrow sub' }, h('span', { class: 'name' }, `${top + 1}${def.unit}以上の時は、実際の数`),
      h('span', { class: 'countwrap' }, input, h('span', { class: 'unitlabel' }, def.unit))));
  }
  return rows;
}

/** 本数を数で入れる行（IQOS）。未入力と 0本を別に扱うので、空欄は未入力、0 は「0本」として保存する */
function countRow(ctx, cur, field) {
  const def = SUBJECTIVE_FIELDS[field];
  const set = (v) => ctx.actions.setLifeValue(ctx.date, field, v);
  const input = h('input', { type: 'number', class: 'countinput', inputmode: 'numeric', pattern: '[0-9]*', min: def.min, max: def.max, step: 1,
    placeholder: '未入力', value: cur[field] ?? null, 'aria-label': `${def.label}の本数`, dataset: HOLD });
  input.addEventListener('change', () => set(readCount(input)));
  const prev = cur[field] == null ? ctx.actions.previousValue(ctx.date, field) : null;
  const quick = cur[field] == null
    ? [h('button', { class: 'pill', type: 'button', onclick: () => set(0) }, `0${def.unit}`),
      prev ? h('button', { class: 'pill', type: 'button', onclick: () => set(prev) }, `前回と同じ ${prev}${def.unit}`) : null]
    : [h('button', { class: 'linkbtn', type: 'button', onclick: () => set(null) }, '消す')];
  return h('div', { class: 'subjrow' }, h('span', { class: 'name' }, def.label),
    h('span', { class: 'countwrap' }, quick, input, h('span', { class: 'unitlabel' }, def.unit)));
}

function lifelogRows(ctx, group, cur) {
  const rows = [];
  for (const field of fieldsOf(group)) {
    const def = SUBJECTIVE_FIELDS[field];
    if (def.kind === 'count') rows.push(def.quick ? quickCountRow(ctx, cur, field) : countRow(ctx, cur, field));
    else rows.push(h('div', { class: 'subjrow' }, h('span', { class: 'name' }, def.short || def.label),
      segmented(def.label, def.options, cur[field], (value) => ctx.actions.setSubjective(ctx.date, field, value))));
    // くわしい入力は、必要な時だけ、親の項目のすぐ下に出す
    if (field === 'cold' && (cur.cold === 'slight' || cur.cold === 'yes')) {
      rows.push(h('div', { class: 'symptoms', role: 'group', 'aria-label': '症状（任意・いくつでも）' },
        h('span', { class: 'name' }, '症状（任意）'),
        COLD_SYMPTOMS.map(([key, label]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String((cur.coldSymptoms || []).includes(key)),
          onclick: () => ctx.actions.toggleColdSymptom(ctx.date, key) }, label))));
    }
    if (field === 'energy' && hadCaffeine(cur)) {
      rows.push(timeRow(ctx, cur, 'caffeineLast', '最後に摂った時刻', '最後にカフェインを摂った時刻'));
      const mg = energyCaffeineMg(cur);
      if (mg) rows.push(h('p', { class: 'subjnote' }, `エナジードリンクのカフェインは約${mg}mg（1本120mgで換算）`));
    }
    if (field === 'iqos' && cur.iqos > 0) rows.push(timeRow(ctx, cur, 'iqosLast', '最後に吸った時刻', '最後に IQOS を吸った時刻'));
  }
  return rows;
}

function lifelogSection(ctx, g, cur) {
  const key = `${ctx.date}|${g.key}`;
  const missing = missingFields(cur, g.key).length;
  if (!openState.has(key)) openState.set(key, missing > 0); // 入力が済んでいる日は、畳んだ状態から始める
  const open = openState.get(key);
  const head = h('div', { class: 'subjhead' },
    h('span', { class: 'grp' }, g.key === 'state' && ctx.date !== ctx.today ? 'その朝の状態' : g.label),
    h('span', { class: 'muted' }, missing ? `未入力 ${missing}` : '入力済み'),
    h('button', { class: 'linkbtn', type: 'button', 'aria-expanded': String(open), onclick: () => { openState.set(key, !open); ctx.rerender(); } }, open ? '閉じる' : '変更'));
  return h('div', { class: 'subjgroup' }, head, open ? lifelogRows(ctx, g.key, cur) : h('p', { class: 'subjsummary' }, summaryText(g.key, cur)));
}

function lifelogCard(ctx) {
  const cur = ctx.state.subjective[ctx.date] || {};
  return card(ctx.date === ctx.today ? '今日の記録（任意）' : 'この日の記録（任意）',
    '押していない項目は「未入力」のままで、比較には使いません。どの項目も点数には混ぜません。この端末にだけ保存されます。',
    h('div', { class: 'subj' }, FIELD_GROUPS.map((g) => lifelogSection(ctx, g, cur))),
    backupNote(ctx));
}

// 記録のバックアップを、しばらく書き出していない時の小さなお知らせ（今日の画面だけ。設計書 5.5）
function backupNote(ctx) {
  if (ctx.date !== ctx.today) return null;
  const n = data.backupNotice();
  if (!n) return null;
  const text = n.never
    ? `記録のバックアップがまだありません（入力 ${n.unsaved}日分）。`
    : `最後のバックアップから ${n.days}日（その後 ${n.unsaved}日分を入力）。`;
  return h('p', { class: 'explain backupnote' }, h('span', null, text),
    h('button', { class: 'linkbtn', type: 'button', onclick: () => ctx.go('settings') }, '設定で書き出す'));
}

export function todayView(ctx) {
  const out = [topCard(ctx)];
  if (ctx.result) out.push(radarCard(ctx.result), guidanceCard(ctx.result));
  out.push(lifelogCard(ctx));
  if (ctx.result && ctx.day && ctx.day.hasNight) out.push(nightCard(ctx), soxaiCard(ctx.result));
  out.push(h('p', { class: 'fineprint' }, 'このアプリは健康管理の参考用で、診断や治療を目的としたものではありません。'));
  return out.filter(Boolean);
}
