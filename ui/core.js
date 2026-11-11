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
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
/** The shortcut key as the keyboard shows it: ⌘ on a Mac, Ctrl on Windows. */
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const keys = (...k) => k.join(IS_MAC ? '' : '+');

// replaceChildren writes null and false as the text "null"/"false"; skip empty children the way el() does
{
  const replace = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...kids) { return replace.apply(this, kids.flat(Infinity).filter(x => x != null && x !== false)); };
}

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

/** An icon of the set in sprite.js. */
function ico(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', `icon ${cls}`.trim());
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `#i-${name}`);
  s.append(u);
  return s;
}
/** A button with an icon and a label. */
const btn = (cls, icon, label, onclick, extra = {}) => el('button', { type: 'button', class: cls, onclick, ...extra }, icon ? ico(icon) : null, label ? el('span', {}, label) : null);

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
const fmtBytes = n => (n >= 1e9 ? `${(n / 1e9).toFixed(1).replace('.', ',')} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const daysLeft = ts => Math.ceil((ts * 1000 - Date.now()) / 864e5);

// ---- preferences that only the window needs (the rest live in Rust) ----
const ui = {
  get(key, fallback) { try { const v = localStorage.getItem(`hsk.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`hsk.${key}`, JSON.stringify(value)); } catch { /* storage blocked */ } },
};

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

// ---- controls ----
/** A short list of choices as one switch: for two to four options, never a drop-down. */
function segmented(options, value, onchange, label = '') {
  const wrap = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const draw = v => $$('button', wrap).forEach(b => { b.setAttribute('aria-checked', String(b.dataset.v === String(v))); b.classList.toggle('on', b.dataset.v === String(v)); });
  for (const o of options) {
    wrap.append(el('button', { type: 'button', role: 'radio', class: 'seg-b', dataset: { v: String(o.value) }, title: o.hint || '', onclick: () => {
      if (wrap.dataset.value === String(o.value)) return;
      wrap.dataset.value = String(o.value); draw(o.value); onchange(o.value);
    } }, o.icon ? ico(o.icon) : null, el('span', {}, o.label)));
  }
  wrap.dataset.value = String(value); draw(value);
  return wrap;
}

/** An on/off switch with its label and an explanation under it. */
function toggle(label, hint, checked, onchange) {
  const input = el('input', { type: 'checkbox', role: 'switch', checked: !!checked, onchange: () => onchange(input.checked, input) });
  return el('label', { class: 'switch-row' }, el('span', { class: 'switch-text' }, el('b', {}, label), hint ? el('small', { class: 'muted' }, hint) : null),
    input, el('i', { class: 'switch', 'aria-hidden': 'true' }));
}

/** Chips for a medium list (events, durations): all visible at once, one tap. */
const chips = (options, value, onchange, label = '') => { const w = segmented(options, value, onchange, label); w.classList.add('chips'); return w; };

/** A titled group of settings: the app never throws a loose list of options at the photographer. */
const group = (title, hint, ...kids) => el('section', { class: 'group' }, el('div', { class: 'group-head' }, el('h2', {}, title), hint ? el('p', { class: 'muted' }, hint) : null), el('div', { class: 'group-body' }, kids));

// ---- dialogs ----
/** A modal: title, content, buttons. Resolves with the value of the button pressed, or undefined on Escape. */
function modal({ title, body, actions = [{ label: 'Închide', value: true }], wide = false, wider = false, onaction = null, extra = null }) {
  const dlg = $('#dlg');
  dlg.className = wider ? 'wider' : wide ? 'wide' : '';
  dlg.replaceChildren(
    el('h2', {}, title),
    el('div', { class: 'dlg-body' }, body),
    actions.length ? el('div', { class: 'dlg-actions' }, actions.map(a => el('button', {
      type: 'button', class: a.primary ? 'primary' : a.danger ? 'danger' : 'secondary',
      onclick: async () => { if (onaction && !(await onaction(a.value))) return; dlg.close(JSON.stringify({ v: a.value })); },
    }, a.label)).concat(extra ? [extra] : [])) : null);
  return new Promise(resolve => {
    dlg.addEventListener('close', () => {
      try { resolve(JSON.parse(dlg.returnValue).v); } catch { resolve(undefined); }
      dlg.returnValue = '';
    }, { once: true });
    dlg.showModal();
  });
}
const closeModal = v => $('#dlg').close(JSON.stringify({ v }));

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

// ---- the picture of an account: a photo, or the initials of its name, drawn like an iOS contact ----
const CITIES = ['bucuresti', 'cluj', 'cluj napoca', 'timisoara', 'iasi', 'constanta', 'brasov', 'sibiu', 'oradea', 'arad', 'craiova', 'galati', 'ploiesti', 'bacau', 'pitesti',
  'suceava', 'baia mare', 'satu mare', 'targu mures', 'deva', 'alba iulia', 'bistrita', 'zalau', 'miercurea ciuc', 'sfantu gheorghe', 'piatra neamt', 'botosani', 'vaslui', 'focsani',
  'braila', 'buzau', 'tulcea', 'slobozia', 'calarasi', 'giurgiu', 'alexandria', 'targoviste', 'ramnicu valcea', 'targu jiu', 'resita', 'hunedoara', 'petrosani', 'medias', 'sighisoara',
  'mamaia', 'bucharest', 'budapest', 'viena', 'vienna', 'london', 'paris', 'roma', 'berlin', 'madrid', 'milano', 'praga', 'varsovia'];
const SKIP_WORDS = new Set(['de', 'la', 'si', 'cu', 'din', 'pe', 'by', 'the', 'of', 'and', 'srl', 'pfa', 'sa', 'ii', 'if', 'dr', 'ing', 'prof', 'arh', 'dna', 'dl']);
const BUSINESS_WORDS = new Set(['studio', 'foto', 'photo', 'photos', 'photography', 'fotografie', 'fotografii', 'productions', 'production', 'media', 'films', 'film', 'video', 'wedding', 'weddings', 'events', 'event', 'atelier', 'art', 'arts', 'design', 'creative', 'pictures', 'visual', 'visuals']);
const plain = w => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Two letters for a name, worked out from what the name looks like:
 *  a business name gives the first letters of its first two words ("LightArt" is "Light Art", so LA);
 *  a person gives first name and last name; a city in the name is left out; titles, company forms and "&" do not count. */
function initialsOf(name) {
  const raw = String(name || '').normalize('NFC').trim();
  if (!raw) return '?';
  let camel = false;
  const marked = raw.replace(/([a-zăâîșțşţ])([A-ZĂÂÎȘȚŞŢ])/g, (m, a, b) => { camel = true; return `${a} ${b}`; });
  let words = marked.split(/[\s_.,&+/|]+/).filter(w => /\p{L}/u.test(w));
  const business = camel || words.some(w => BUSINESS_WORDS.has(plain(w)) || (w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w)));
  words = words.filter(w => !SKIP_WORDS.has(plain(w).replace(/-/g, '')));
  // cities: single words and pairs of words ("Baia Mare"); kept only when nothing else is left
  const kept = [];
  for (let i = 0; i < words.length; i++) {
    const one = plain(words[i]).replace(/-/g, ' '), two = i + 1 < words.length ? `${one} ${plain(words[i + 1])}` : '';
    if (two && CITIES.includes(two)) { i++; continue; }
    if (CITIES.includes(one)) continue;
    kept.push(words[i]);
  }
  if (kept.length) words = kept;
  const first = w => [...w.replace(/^[^\p{L}]+/u, '')][0] || '';
  const up = s => s.toLocaleUpperCase('ro');
  if (words.length === 1) {
    const letters = [...words[0].replace(/[^\p{L}]/gu, '')];
    return up(letters.slice(0, 2).join('')) || '?';
  }
  if (business || words.length > 4) return up(first(words[0]) + first(words[1]));
  return up(first(words[0]) + first(words[words.length - 1]));
}

/** A round picture: the photo when there is one, else the initials on a soft sage gradient. */
function avatar(name, photo, size = 36, initials) {
  const box = el('span', { class: 'avatar', style: `--s:${size}px`, 'aria-hidden': 'true' });
  const letters = el('span', {}, (initials || initialsOf(name)).slice(0, 3));
  if (photo) box.append(el('img', { src: abs(photo), alt: '', onerror: e => { e.target.remove(); box.append(letters); } }));
  else box.append(letters);
  return box;
}
