'use strict';
// Finanțe: the photographer's own books. Income, expenses and profit, kept on this computer only (IndexedDB),
// with an invoice photo or PDF attached to an entry, a CSV import and an export for the accountant.

const INCOME_CATS = ['Nuntă', 'Botez', 'Ședință foto', 'Eveniment', 'Școală / grădiniță', 'Vânzare de poze', 'Altele'];
const EXPENSE_CATS = ['Echipament', 'Software și abonamente', 'Deplasări', 'Studio și locații', 'Marketing', 'Colaboratori', 'Contabilitate și taxe', 'Altele'];
const VAT_RATES = [21, 11, 0];  // the rates in force in Romania; the photographer can see which one the invoice carries

document.querySelector('body > svg').insertAdjacentHTML('beforeend',
  '<symbol id="i-chart" viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></symbol>' +
  '<symbol id="i-paperclip" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></symbol>');

const FIN = { entries: [], loaded: false, period: 'month', offset: 0, kind: 'all', q: '' };

// ---- storage ----
const fdb = (() => {
  let opened;
  const open = () => opened || (opened = new Promise((res, rej) => {
    const r = indexedDB.open('hsk-finance', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('entries', { keyPath: 'id' }); r.result.createObjectStore('files', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && 'result' in req ? req.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  return { all: s => run(s, 'readonly', st => st.getAll()), get: (s, id) => run(s, 'readonly', st => st.get(id)),
    put: (s, v) => run(s, 'readwrite', st => st.put(v)), del: (s, id) => run(s, 'readwrite', st => st.delete(id)) };
})();

async function finLoad() {
  try { FIN.entries = await fdb.all('entries'); FIN.loaded = true; }
  catch { FIN.entries = []; FIN.loaded = true; toast('Nu pot deschide registrul de finanțe pe acest calculator.', 'error'); }
}

// ---- numbers ----
const vatPayer = () => ui.get('vatPayer', false);
const moneyFmt = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = n => `${moneyFmt.format(Math.round(n * 100) / 100)} lei`;
/** What counts as income or expense: without VAT for a VAT payer (the VAT is not the photographer's), the full sum otherwise. */
const net = e => (vatPayer() && e.vat ? e.amount / (1 + e.vat / 100) : e.amount);
const vatOf = e => (vatPayer() && e.vat ? e.amount - e.amount / (1 + e.vat / 100) : 0);
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOf = e => new Date(`${e.date}T00:00:00`);

function periodRange(offset = FIN.offset) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  if (FIN.period === 'month') { const a = new Date(y, m + offset, 1); return { from: a, to: new Date(a.getFullYear(), a.getMonth() + 1, 1), label: a.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' }) }; }
  if (FIN.period === 'quarter') { const a = new Date(y, (Math.floor(m / 3) + offset) * 3, 1); return { from: a, to: new Date(a.getFullYear(), a.getMonth() + 3, 1), label: `Trimestrul ${Math.floor(a.getMonth() / 3) + 1}, ${a.getFullYear()}` }; }
  if (FIN.period === 'year') return { from: new Date(y + offset, 0, 1), to: new Date(y + offset + 1, 0, 1), label: String(y + offset) };
  return { from: new Date(1970, 0, 1), to: new Date(9999, 0, 1), label: 'Tot istoricul' };
}
const within = (e, r) => { const d = dayOf(e); return d >= r.from && d < r.to; };
function totals(list) {
  const income = list.filter(e => e.kind === 'income').reduce((n, e) => n + net(e), 0);
  const expense = list.filter(e => e.kind === 'expense').reduce((n, e) => n + net(e), 0);
  const vat = list.reduce((n, e) => n + (e.kind === 'income' ? vatOf(e) : -vatOf(e)), 0);
  return { income, expense, profit: income - expense, vat, margin: income ? (income - expense) / income : null };
}
const delta = (now, before) => (before ? Math.round(((now - before) / Math.abs(before)) * 100) : null);

// ---- the entry form ----
async function entryDialog(entry = null, preset = {}) {
  const e = entry ? { ...entry } : { id: crypto.randomUUID(), kind: preset.kind || 'income', date: isoDay(new Date()), amount: '', category: '', client: '', albumCode: preset.albumCode || '', vat: 0, note: '', fileId: '', fileName: '', ...preset };
  let pending = null;  // a file chosen now, stored on save
  let removeFile = false;
  const cats = () => (e.kind === 'income' ? INCOME_CATS : EXPENSE_CATS);
  const catBox = el('div', {});
  const drawCats = () => { if (!cats().includes(e.category)) e.category = e.category && entry ? e.category : cats()[0]; catBox.replaceChildren(chips(cats().map(c => ({ value: c, label: c })), e.category, v => { e.category = v; }, 'Categoria')); };
  const kindSeg = segmented([{ value: 'income', icon: 'arrow-up', label: 'Venit' }, { value: 'expense', icon: 'download', label: 'Cheltuială' }], e.kind, v => { e.kind = v; drawCats(); }, 'Tipul');
  drawCats();
  const amount = el('input', { class: 'field', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: e.amount, placeholder: '0,00', 'aria-label': 'Suma în lei', oninput: () => { e.amount = amount.value; } });
  const date = el('input', { class: 'field', type: 'date', value: e.date, 'aria-label': 'Data', oninput: () => { e.date = date.value; } });
  const clientList = el('datalist', { id: 'fin-clients' }, [...new Set(FIN.entries.map(x => x.client).filter(Boolean))].map(c => el('option', { value: c })));
  const client = el('input', { class: 'field', list: 'fin-clients', value: e.client, placeholder: e.kind === 'income' ? 'Cine a plătit' : 'Cui ai plătit (furnizor)', 'aria-label': 'Client sau furnizor', oninput: () => { e.client = client.value; } });
  const album = el('select', { class: 'field', 'aria-label': 'Album legat', onchange: () => { e.albumCode = album.value; } },
    el('option', { value: '' }, 'Fără album'), ...S.albums.map(a => el('option', { value: a.code, selected: a.code === e.albumCode }, a.name)));
  const note = el('input', { class: 'field', value: e.note, maxLength: 160, placeholder: 'Ce a fost (opțional)', 'aria-label': 'Notă', oninput: () => { e.note = note.value; } });
  const vat = vatPayer() ? el('div', {}, el('label', { class: 'lbl' }, 'TVA inclus în sumă'), chips([{ value: 0, label: 'Fără TVA' }, ...VAT_RATES.filter(r => r).map(r => ({ value: r, label: `${r}%` }))], e.vat || 0, v => { e.vat = Number(v); }, 'TVA')) : null;
  const fileName = el('span', { class: 'muted' }, e.fileName || 'Niciun fișier');
  const picker = el('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true, onchange: () => { pending = picker.files[0] || null; if (pending) { removeFile = false; fileName.textContent = pending.name; } } });
  const fileRow = el('div', { class: 'row wrap' }, btn('secondary small', 'paperclip', e.fileId ? 'Schimbă factura' : 'Atașează factura', () => picker.click()), fileName, picker,
    e.fileId ? btn('quiet', null, 'Scoate', () => { removeFile = true; pending = null; fileName.textContent = 'Va fi scoasă la salvare'; }) : null);
  const error = el('p', { class: 'msg', role: 'alert' });

  const ok = await modal({
    title: entry ? 'Modifică înregistrarea' : 'Înregistrare nouă', wide: true,
    body: el('div', { class: 'stack' }, kindSeg, el('div', { class: 'two' }, el('div', {}, el('label', { class: 'lbl' }, 'Suma (lei)'), amount), el('div', {}, el('label', { class: 'lbl' }, 'Data'), date)),
      el('label', { class: 'lbl' }, 'Categoria'), catBox, vat,
      el('div', { class: 'two' }, el('div', {}, el('label', { class: 'lbl' }, e.kind === 'income' ? 'Client' : 'Furnizor'), client, clientList), el('div', {}, el('label', { class: 'lbl' }, 'Album legat'), album)),
      note, el('label', { class: 'lbl' }, 'Factura sau bonul'), fileRow, error),
    actions: [{ label: 'Anulează', value: false }, { label: 'Salvează', value: true, primary: true }],
    onaction: async v => {
      if (!v) return true;
      const sum = Number(String(e.amount).replace(',', '.'));
      if (!(sum > 0)) { error.textContent = 'Scrie o sumă mai mare ca zero.'; return false; }
      if (!e.date) { error.textContent = 'Alege data.'; return false; }
      e.amount = Math.round(sum * 100) / 100; e.client = e.client.trim(); e.note = e.note.trim();
      try {
        if ((removeFile || pending) && e.fileId) { await fdb.del('files', e.fileId); e.fileId = ''; e.fileName = ''; }
        if (pending) { e.fileId = crypto.randomUUID(); e.fileName = pending.name; await fdb.put('files', { id: e.fileId, name: pending.name, type: pending.type, blob: pending }); }
        await fdb.put('entries', e);
      } catch { error.textContent = 'Nu am putut salva. Încearcă din nou.'; return false; }
      return true;
    },
  });
  if (ok !== true) return;
  const i = FIN.entries.findIndex(x => x.id === e.id);
  if (i < 0) FIN.entries.push(e); else FIN.entries[i] = e;
  toast(entry ? 'Înregistrarea a fost modificată.' : 'Înregistrarea a fost adăugată.', 'info');
  if (S.active === 'finance') renderFinance();
  if (S.tab === 'settings' && S.album) renderAlbum();
}

async function deleteEntry(e) {
  if (ui.get('confirm-delete', true)) {
    const yes = await modal({ title: 'Ștergi înregistrarea?', body: el('p', {}, `${e.kind === 'income' ? 'Venit' : 'Cheltuială'} de ${money(e.amount)} din ${fmtDay(e.date)}${e.client ? `, ${e.client}` : ''}. Nu se poate anula.`),
      actions: [{ label: 'Anulează', value: false }, { label: 'Șterge', value: true, danger: true }] });
    if (yes !== true) return;
  }
  try { if (e.fileId) await fdb.del('files', e.fileId); await fdb.del('entries', e.id); } catch { return toast('Nu am putut șterge.', 'error'); }
  FIN.entries = FIN.entries.filter(x => x.id !== e.id);
  if (S.active === 'finance') renderFinance();
}

async function showFile(e) {
  const f = await fdb.get('files', e.fileId).catch(() => null);
  if (!f) return toast('Fișierul nu mai e pe acest calculator.', 'error');
  const url = URL.createObjectURL(f.blob);
  const view = f.type.startsWith('image/') ? el('img', { class: 'fin-file', src: url, alt: f.name }) : el('iframe', { class: 'fin-file', src: url, title: f.name });
  await modal({ title: f.name, wider: true, body: view, actions: [{ label: 'Închide', value: true }] });
  URL.revokeObjectURL(url);
}

// ---- export, import, backup ----
async function saveText(name, text, withBom) {
  const bytes = new TextEncoder().encode((withBom ? '﻿' : '') + text);
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
  try { const path = await invoke('save_file', { name, data: btoa(bin), open: false }); toast(`Salvat în Descărcări: ${String(path).split(/[\\/]/).pop()}`, 'info'); return; }
  catch { /* the browser preview has no desktop: fall back to a normal download */ }
  const a = el('a', { href: URL.createObjectURL(new Blob([bytes])), download: name }); document.body.append(a); a.click(); a.remove();
}
const csvCell = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function exportCsv(list, label) {
  const name = (a => a ? a.name : '');
  const rows = [['Data', 'Tip', 'Categoria', 'Client / furnizor', 'Album', 'Suma', 'TVA %', 'Notă'],
    ...[...list].sort((a, b) => a.date.localeCompare(b.date)).map(e => [e.date, e.kind === 'income' ? 'Venit' : 'Cheltuială', e.category, e.client, name(S.albums.find(a => a.code === e.albumCode)), String(e.amount).replace('.', ','), e.vat || '', e.note])];
  saveText(`finante-${label}.csv`, rows.map(r => r.map(csvCell).join(';')).join('\r\n'), true);
}
const backupJson = () => saveText(`hsk-finante-${isoDay(new Date())}.json`, JSON.stringify({ app: 'hsk-studio-finance', version: 1, entries: FIN.entries }, null, 1), false);

function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0];
  const sep = [';', '\t', ','].map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
function parseAmount(s) {
  let t = String(s).replace(/[^\d,.\-+]/g, '');
  if (!t) return NaN;
  const lastC = t.lastIndexOf(','), lastD = t.lastIndexOf('.');
  if (lastC > -1 && lastD > -1) t = lastC > lastD ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (lastC > -1) t = t.replace(',', '.');
  return Number(t);
}
function parseDate(s) {
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

async function importDialog() {
  const picker = el('input', { type: 'file', accept: '.csv,.txt,.json,text/csv,application/json', class: 'field' });
  const out = el('div', { class: 'stack' });
  let plan = [];
  picker.addEventListener('change', async () => {
    const f = picker.files[0]; if (!f) return;
    const text = await f.text();
    plan = [];
    if (f.name.toLowerCase().endsWith('.json')) {
      try { const j = JSON.parse(text); plan = (j.entries || []).filter(x => x && x.id && x.date && x.amount > 0 && ['income', 'expense'].includes(x.kind)); } catch { /* not a backup */ }
      const known = new Set(FIN.entries.map(x => x.id)); plan = plan.filter(x => !known.has(x.id));
      out.replaceChildren(el('p', {}, plan.length ? `${plural(plan.length, 'înregistrare nouă', 'înregistrări noi')} din copia de siguranță.` : 'Nu am găsit înregistrări noi în acest fișier.'));
      return;
    }
    const rows = parseCsv(text);
    if (rows.length < 2) { out.replaceChildren(el('p', { class: 'muted' }, 'Fișierul nu are rânduri de citit.')); return; }
    const head = rows[0].map(h => h.trim());
    const guess = (...words) => Math.max(0, head.findIndex(h => words.some(w => h.toLowerCase().includes(w))));
    const map = { date: guess('data', 'date'), amount: guess('sum', 'amount', 'valoare', 'debit'), note: guess('descri', 'detal', 'benef', 'note', 'explic') };
    const pick = (key, label) => el('div', {}, el('label', { class: 'lbl' }, label), el('select', { class: 'field', onchange: ev => { map[key] = Number(ev.target.value); preview(); } }, head.map((h, i) => el('option', { value: i, selected: i === map[key] }, h || `Coloana ${i + 1}`))));
    const info = el('div', { class: 'stack' });
    const preview = () => {
      const known = new Set(FIN.entries.map(x => `${x.date}|${x.amount}|${x.note}`));
      plan = rows.slice(1).map(r => { const v = parseAmount(r[map.amount]), date = parseDate(r[map.date]); return { v, date, note: String(r[map.note] || '').trim().slice(0, 160) }; })
        .filter(x => x.date && Number.isFinite(x.v) && x.v !== 0)
        .map(x => ({ id: crypto.randomUUID(), kind: x.v > 0 ? 'income' : 'expense', date: x.date, amount: Math.round(Math.abs(x.v) * 100) / 100, category: 'Altele', client: '', albumCode: '', vat: 0, note: x.note, fileId: '', fileName: '' }))
        .filter(x => !known.has(`${x.date}|${x.amount}|${x.note}`));
      info.replaceChildren(el('p', {}, plan.length ? `${plural(plan.length, 'rând gata de importat', 'rânduri gata de importat')}: ${plan.filter(x => x.kind === 'income').length} venituri, ${plan.filter(x => x.kind === 'expense').length} cheltuieli.` : 'Niciun rând valid. Verifică ce coloane ai ales.'),
        el('p', { class: 'muted' }, 'Sumele pozitive devin venituri, cele negative cheltuieli. Rândurile deja importate se sar.'));
    };
    out.replaceChildren(el('div', { class: 'two' }, pick('date', 'Coloana cu data'), pick('amount', 'Coloana cu suma')), pick('note', 'Coloana cu descrierea'), info);
    preview();
  });
  const ok = await modal({ title: 'Importă din extras sau din copie', wide: true,
    body: el('div', { class: 'stack' }, el('p', { class: 'muted' }, 'Alege un fișier CSV (de exemplu extrasul de cont) sau o copie de siguranță făcută de aplicație (.json).'), picker, out),
    actions: [{ label: 'Anulează', value: false }, { label: 'Importă', value: true, primary: true }],
    onaction: async v => { if (!v) return true; if (!plan.length) { toast('Nu e nimic de importat.', 'error'); return false; } return true; } });
  if (ok !== true) return;
  try { for (const x of plan) await fdb.put('entries', x); } catch { return toast('Importul s-a oprit la jumătate.', 'error'); }
  FIN.entries.push(...plan);
  toast(`${plural(plan.length, 'înregistrare importată', 'înregistrări importate')}.`, 'info');
  renderFinance();
}

// ---- the screen ----
function monthSeries(range) {
  const end = FIN.period === 'all' ? new Date() : new Date(range.to.getFullYear(), range.to.getMonth() - 1, 1);
  const start = FIN.period === 'year' ? new Date(range.from.getFullYear(), 0, 1) : new Date(end.getFullYear(), end.getMonth() - 11, 1);
  const out = [];
  for (let d = new Date(start); d <= (FIN.period === 'year' ? new Date(range.from.getFullYear(), 11, 1) : end); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const r = { from: d, to: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
    out.push({ label: d.toLocaleDateString('ro-RO', { month: 'short' }).replace('.', ''), ...totals(FIN.entries.filter(e => within(e, r))), d });
  }
  return out;
}

function chartSvg(series) {
  const W = 760, H = 220, L = 8, B = 26, T = 10, max = Math.max(1, ...series.flatMap(s => [s.income, s.expense]));
  const step = (W - L) / series.length, bw = Math.min(18, step / 2.6);
  const y = v => T + (H - T - B) * (1 - v / max);
  const ns = 'http://www.w3.org/2000/svg', mk = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; return n; };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'fin-chart', role: 'img', 'aria-label': 'Venituri și cheltuieli pe luni', preserveAspectRatio: 'none' });
  svg.append(mk('line', { x1: L, x2: W, y1: H - B, y2: H - B, class: 'ax' }));
  series.forEach((s, i) => {
    const cx = L + step * i + step / 2;
    const bar = (v, dx, cls, what) => { if (v > 0) { const r = mk('rect', { x: cx + dx, y: y(v), width: bw, height: H - B - y(v), rx: 3, class: cls }); r.append(mk('title', {}, `${s.d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })} · ${what}: ${money(v)}`)); svg.append(r); } };
    bar(s.income, -bw - 1, 'inc', 'venituri'); bar(s.expense, 1, 'exp', 'cheltuieli');
    svg.append(mk('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'lb' }, s.label));
  });
  return svg;
}

function barList(items, total) {
  if (!items.length) return el('p', { class: 'muted' }, 'Încă nimic de arătat.');
  return el('ul', { class: 'fin-bars' }, items.map(([label, v]) => el('li', {}, el('span', { class: 'n' }, label), el('b', {}, money(v)), el('i', { class: 'b' }, el('u', { style: `width:${Math.max(3, Math.round((v / total) * 100))}%` })))));
}

function renderFinance() {
  const stage = $('#stage');
  if (!FIN.loaded) { stage.replaceChildren(el('p', { class: 'muted pad' }, 'Se deschide registrul…')); finLoad().then(() => S.active === 'finance' && renderFinance()); return; }
  const range = periodRange(), prev = FIN.period === 'all' ? null : periodRange(FIN.offset - 1);
  const list = FIN.entries.filter(e => within(e, range));
  const t = totals(list), p = prev ? totals(FIN.entries.filter(e => within(e, prev))) : null;
  const tile = (label, value, note, tone) => el('div', { class: `tile-k${tone ? ` ${tone}` : ''}` }, el('small', {}, label), el('b', {}, value), el('span', { class: 'muted' }, note || ' '));
  const trend = (now, before, good) => { const d = before == null ? null : delta(now, before); return d == null ? 'față de perioada trecută: –' : `${d > 0 ? '+' : ''}${d}% față de perioada trecută`; };
  const q = FIN.q.trim().toLowerCase();
  const shown = list.filter(e => (FIN.kind === 'all' || e.kind === FIN.kind) && (!q || [e.client, e.note, e.category, (S.albums.find(a => a.code === e.albumCode) || {}).name].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const byCat = Object.entries(list.filter(e => e.kind === 'expense').reduce((m, e) => (m[e.category] = (m[e.category] || 0) + net(e), m), {})).sort((a, b) => b[1] - a[1]);
  const bySrc = Object.entries(list.filter(e => e.kind === 'income').reduce((m, e) => { const k = (S.albums.find(a => a.code === e.albumCode) || {}).name || e.client || 'Fără client'; m[k] = (m[k] || 0) + net(e); return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const albumName = e => (S.albums.find(a => a.code === e.albumCode) || {}).name;
  const row = e => el('div', { class: 'frow' },
    el('span', { class: 'fd muted' }, fmtDay(e.date)),
    el('span', { class: 'fn' }, el('b', {}, e.category || 'Altele'), el('small', { class: 'muted' }, [e.client, albumName(e), e.note].filter(Boolean).join(' · ') || ' ')),
    el('span', { class: `fa ${e.kind}` }, `${e.kind === 'income' ? '+' : '−'}${money(e.amount)}`),
    el('span', { class: 'fx' }, e.fileId ? el('button', { type: 'button', class: 'icon-btn', title: 'Vezi factura', 'aria-label': 'Vezi factura', onclick: () => showFile(e) }, ico('paperclip')) : null,
      el('button', { type: 'button', class: 'icon-btn', title: 'Modifică', 'aria-label': 'Modifică', onclick: () => entryDialog(e) }, ico('edit')),
      el('button', { type: 'button', class: 'icon-btn', title: 'Șterge', 'aria-label': 'Șterge', onclick: () => deleteEntry(e) }, ico('trash'))));
  const empty = !FIN.entries.length;
  const lbl = range.label[0].toUpperCase() + range.label.slice(1);

  stage.replaceChildren(el('div', { class: 'dash fin' },
    el('div', { class: 'dash-head' },
      el('div', {}, el('h1', {}, 'Finanțe'), el('p', { class: 'muted' }, 'Registrul tău, doar pe acest calculator. Nu ajunge pe serverele hsk.')),
      el('div', { class: 'fin-acts' },
        btn('primary small', 'plus', 'Venit', () => entryDialog(null, { kind: 'income' })), btn('secondary small', 'plus', 'Cheltuială', () => entryDialog(null, { kind: 'expense' })),
        btn('quiet', null, 'Importă', importDialog), btn('quiet', null, 'Export CSV', () => exportCsv(list, range.label.replace(/\s+/g, '-').toLowerCase())), btn('quiet', null, 'Copie de siguranță', backupJson))),
    el('div', { class: 'fin-bar' },
      segmented([{ value: 'month', label: 'Luna' }, { value: 'quarter', label: 'Trimestrul' }, { value: 'year', label: 'Anul' }, { value: 'all', label: 'Tot' }], FIN.period, v => { FIN.period = v; FIN.offset = 0; renderFinance(); }, 'Perioada'),
      FIN.period === 'all' ? el('b', { class: 'fin-lbl' }, lbl) : el('div', { class: 'fin-nav' }, el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Perioada dinainte', onclick: () => { FIN.offset--; renderFinance(); } }, ico('chevron-left')),
        el('b', { class: 'fin-lbl' }, lbl), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Perioada următoare', onclick: () => { FIN.offset++; renderFinance(); } }, ico('chevron-right')))),
    el('div', { class: 'kpis' },
      tile('Venituri', money(t.income), trend(t.income, p && p.income)),
      tile('Cheltuieli', money(t.expense), trend(t.expense, p && p.expense)),
      tile('Profit', money(t.profit), trend(t.profit, p && p.profit), t.profit < 0 ? 'neg' : 'pos'),
      tile('Marja de profit', t.margin == null ? '–' : `${Math.round(t.margin * 100)}%`, t.margin == null ? 'Nu sunt încă venituri' : 'din fiecare leu încasat'),
      vatPayer() ? tile('TVA de plătit', money(t.vat), 'colectat minus dedus') : tile('Înregistrări', nf.format(list.length), `${list.filter(e => e.kind === 'income').length} venituri, ${list.filter(e => e.kind === 'expense').length} cheltuieli`)),
    empty ? el('section', { class: 'dpanel fin-empty' }, el('h2', {}, 'Începe cu prima înregistrare'),
      el('p', { class: 'muted' }, 'Adaugi un venit sau o cheltuială (suma, data, categoria) și aplicația calculează singură venitul, cheltuielile și profitul, pe lună, trimestru și an. Poți atașa poza facturii sau importa un extras de cont.'),
      el('div', { class: 'row wrap' }, btn('primary small', 'plus', 'Adaugă un venit', () => entryDialog(null, { kind: 'income' })), btn('secondary small', 'plus', 'Adaugă o cheltuială', () => entryDialog(null, { kind: 'expense' })), btn('quiet', null, 'Importă din extras', importDialog)))
    : el('div', { class: 'dash-body fin-body' },
      el('div', { class: 'fin-main' },
        el('section', { class: 'dpanel' }, el('div', { class: 'group-head' }, el('h2', {}, 'Venituri și cheltuieli pe luni'), el('p', { class: 'fin-key muted' }, el('i', { class: 'k inc' }), 'Venituri', el('i', { class: 'k exp' }), 'Cheltuieli')), chartSvg(monthSeries(range))),
        el('section', { class: 'dpanel dalbums' },
          el('div', { class: 'fin-tools' }, el('div', { class: 'group-head' }, el('h2', {}, 'Înregistrări')),
            segmented([{ value: 'all', label: 'Toate' }, { value: 'income', label: 'Venituri' }, { value: 'expense', label: 'Cheltuieli' }], FIN.kind, v => { FIN.kind = v; renderFinance(); }, 'Ce arăt'),
            el('input', { class: 'field fin-q', type: 'search', placeholder: 'Caută', value: FIN.q, 'aria-label': 'Caută în înregistrări', oninput: ev => { FIN.q = ev.target.value; const at = ev.target.selectionStart; renderFinance(); const n = $('.fin-tools input'); n.focus(); n.setSelectionRange(at, at); } })),
          shown.length ? el('div', { class: 'dscroll' }, shown.map(row)) : el('p', { class: 'muted' }, list.length ? 'Nimic care să se potrivească.' : 'În această perioadă nu e nicio înregistrare.'))),
      el('div', { class: 'dside' },
        el('section', { class: 'dpanel' }, el('div', { class: 'group-head' }, el('h2', {}, 'Cheltuieli pe categorii')), barList(byCat, t.expense || 1)),
        el('section', { class: 'dpanel' }, el('div', { class: 'group-head' }, el('h2', {}, 'De unde vin veniturile')), barList(bySrc, t.income || 1)),
        el('p', { class: 'muted fin-note' }, vatPayer() ? 'Cifrele sunt fără TVA. Cotele de TVA le verifici pe factură.' : 'Cifrele sunt cu sumele întregi. Dacă ești plătitor de TVA, activează asta în Setări.')))));
}

/** A small block for an album's settings: what it brought in, and a button to record a payment. */
function albumMoneyGroup(a) {
  const mine = FIN.entries.filter(e => e.albumCode === a.code);
  const inc = mine.filter(e => e.kind === 'income'), exp = mine.filter(e => e.kind === 'expense');
  const sum = l => l.reduce((n, e) => n + net(e), 0);
  return group('Bani din acest album', 'Încasările și cheltuielile legate de el, din registrul tău de pe acest calculator.',
    el('dl', { class: 'stats' }, el('div', { class: 'stat' }, el('dd', {}, money(sum(inc))), el('dt', {}, 'Încasat')), el('div', { class: 'stat' }, el('dd', {}, money(sum(exp))), el('dt', {}, 'Cheltuit')), el('div', { class: 'stat' }, el('dd', {}, money(sum(inc) - sum(exp))), el('dt', {}, 'Profit'))),
    el('div', { class: 'row wrap' }, btn('secondary small', 'plus', 'Încasare', () => entryDialog(null, { kind: 'income', albumCode: a.code, client: '' })), btn('secondary small', 'plus', 'Cheltuială', () => entryDialog(null, { kind: 'expense', albumCode: a.code })),
      btn('quiet', null, 'Deschide Finanțe', () => openTab('finance'))));
}

finLoad();
