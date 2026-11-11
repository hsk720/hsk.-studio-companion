'use strict';
// The window only draws. The token, the disk and the network stay in Rust, behind these commands.
const T = window.__TAURI__;
const invoke = (cmd, args) => T.core.invoke(cmd, args);
const listen = (ev, fn) => T.event.listen(ev, fn);
const SITE = 'https://hsk.photos';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const abs = u => (u ? new URL(u, SITE).href : '');
const nf = new Intl.NumberFormat('ro-RO');

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat(Infinity).filter(x => x != null && x !== false));
  return e;
}

/** 1 poză · 2 poze · 20 de poze */
function plural(n, one, many) {
  const r = n % 100;
  return `${nf.format(n)} ${n === 1 ? one : (n === 0 || (r > 0 && r < 20)) ? many : `de ${many}`}`;
}

const api = (method, path, body) => invoke('api_call', { method, path, body: body === undefined ? null : body });

const fmtDay = v => {
  const d = typeof v === 'number' ? new Date(v * 1000) : v ? new Date(v) : null;
  return d && !isNaN(d) ? d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
};
const fmtBytes = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const daysLeft = ts => Math.ceil((ts * 1000 - Date.now()) / 864e5);

function toast(message, kind = 'info') {
  const t = el('p', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, String(message));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 8000 : 4000);
}

/** Runs an action and tells the photographer what went wrong in the server's own words. */
async function guard(fn) {
  try { return await fn(); }
  catch (e) { toast(e && e.message ? e.message : e, 'error'); return undefined; }
}

/** A modal: title, content, buttons. Resolves with the value of the button pressed, or undefined on Escape. */
function modal({ title, body, actions = [{ label: 'Închide', value: true }], wide = false }) {
  const dlg = $('#dlg');
  dlg.className = wide ? 'wide' : '';
  dlg.replaceChildren(
    el('h2', {}, title),
    el('div', { class: 'dlg-body' }, body),
    el('div', { class: 'dlg-actions' }, actions.map(a => el('button', {
      type: 'button', class: a.primary ? 'primary' : a.danger ? 'danger' : 'secondary',
      onclick: () => dlg.close(JSON.stringify({ v: a.value })),
    }, a.label))));
  return new Promise(resolve => {
    dlg.addEventListener('close', () => {
      try { resolve(JSON.parse(dlg.returnValue).v); } catch { resolve(undefined); }
      dlg.returnValue = '';
    }, { once: true });
    dlg.showModal();
  });
}

const confirmBox = (title, text, ok = 'Confirmă', danger = false) => modal({
  title, body: el('p', {}, text),
  actions: [{ label: 'Renunț', value: false }, { label: ok, value: true, primary: !danger, danger }],
}).then(v => v === true);

async function promptBox(title, label, value = '', ok = 'Salvează') {
  const input = el('input', { class: 'field', value, maxLength: 80, 'aria-label': label });
  const done = modal({ title, body: [el('label', { class: 'lbl' }, label), input],
    actions: [{ label: 'Renunț', value: false }, { label: ok, value: 'ok', primary: true }] });
  setTimeout(() => { input.focus(); input.select(); }, 50);
  return (await done) === 'ok' ? input.value.trim() : null;
}

const copyText = async text => {
  try { await navigator.clipboard.writeText(text); toast('Copiat.', 'success'); }
  catch { toast('Nu am putut copia. Selectează textul și copiază-l.', 'error'); }
};

const siteOpen = path => guard(() => invoke('site_open', { path }));
