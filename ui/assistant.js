'use strict';
// The assistant, at the top of the dashboard ("Azi"): a short brief of what needs doing today, a place to ask, and
// ready messages or notes the photographer checks first. The brief is made on the server from the account's albums
// (rules, no model); the answers come from Gemini on the server (assistant.py), which only reads and proposes.
// Nothing is sent or saved without the photographer's click: a message takes two (where it goes, then send).

const ASST = { brief: null, at: 0, configured: true, history: [], busy: false };
const ASST_TTL = 5 * 60 * 1000;

const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Bună dimineața' : h < 18 ? 'Bună ziua' : 'Bună seara'; };
const firstName = () => { const n = (S.account && S.account.name) || ''; return n && n !== 'hsk. photos' ? n.split(' ')[0] : ''; };

async function asstBrief(force = false) {
  if (!force && ASST.brief && Date.now() - ASST.at < ASST_TTL) return ASST.brief;
  try {
    const r = await api('GET', '/api/desktop/assistant');
    ASST.brief = r.brief || []; ASST.configured = r.configured; ASST.at = Date.now();
  } catch { ASST.brief = ASST.brief || []; }
  return ASST.brief;
}

// ---- finances: only a summary, only when the photographer allows it (the books stay on this computer) ----
const asstFinanceOn = () => ui.get('assistFinance', false);
async function asstFinance() {
  if (!asstFinanceOn()) return '';
  if (!FIN.loaded) await finLoad();
  const sum = (list, k) => Math.round(list.filter(e => e.kind === k).reduce((n, e) => n + net(e), 0));
  const month = d => d.slice(0, 7), now = new Date(), lines = [];
  for (let i = 0; i < 3; i++) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1), key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    const list = FIN.entries.filter(e => month(e.date) === key);
    lines.push(`${key}: venituri ${sum(list, 'income')} lei, cheltuieli ${sum(list, 'expense')} lei, ${list.length} înregistrări`);
  }
  const year = FIN.entries.filter(e => e.date.startsWith(String(now.getFullYear())));
  lines.push(`Anul ${now.getFullYear()}: venituri ${sum(year, 'income')} lei, cheltuieli ${sum(year, 'expense')} lei`);
  const recent = [...FIN.entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15)
    .map(e => `${e.date} · ${e.kind === 'income' ? 'venit' : 'cheltuială'} · ${e.category || '-'} · ${e.client || '-'} · ${Math.round(e.amount)} lei`);
  return [...lines, 'Ultimele înregistrări:', ...recent].join('\n').slice(0, 2900);
}

// ---- cards: a message to send, a note to save ----
function outLink(d, text) {
  if (d.channel === 'email') return `mailto:?subject=${encodeURIComponent(d.subject || '')}&body=${encodeURIComponent(text)}`;
  if (d.channel === 'whatsapp') return `https://wa.me/?text=${encodeURIComponent(text)}`;
  return null;
}

function messageCard(d) {
  const via = { email: 'E-mail', whatsapp: 'WhatsApp', text: 'Text de copiat' }[d.channel] || 'Text';
  const text = el('textarea', { class: 'field asst-text', rows: 7, 'aria-label': 'Textul mesajului' });
  text.value = d.text;
  const send = outLink(d, '') ? btn('primary small', 'arrow-right', 'Trimite', e => {
    const b = e.currentTarget; // two clicks: the first one says where it goes, the second opens it there
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.lastChild.textContent = `Confirmă: deschide în ${via}`; return; }
    const w = window.open(outLink(d, text.value), '_blank', 'noopener');
    if (!w) { copyText(text.value); toast(`Textul e copiat. Lipește-l în ${via}.`, 'info'); }
    b.disabled = true; b.lastChild.textContent = `Deschis în ${via}`;
  }) : null;
  return el('div', { class: 'asst-draft' },
    el('div', { class: 'asst-draft-head' }, ico(d.channel === 'whatsapp' ? 'message' : d.channel === 'email' ? 'mail' : 'copy'),
      el('span', {}, el('b', {}, d.to || 'Mesaj'), el('small', { class: 'muted' }, ` · ${via}${d.subject ? ` · ${d.subject}` : ''}`))),
    text,
    el('div', { class: 'row asst-draft-acts' }, send, btn(send ? 'quiet' : 'primary small', send ? null : 'copy', 'Copiază textul', () => copyText(text.value))));
}

function noteCard(n) {
  const text = el('textarea', { class: 'field asst-text asst-note', rows: 3, 'aria-label': 'Notița' });
  text.value = n.text;
  return el('div', { class: 'asst-draft' },
    el('div', { class: 'asst-draft-head' }, ico('edit'), el('span', {}, el('b', {}, 'Notiță'), el('small', { class: 'muted' }, ` · ${n.album_name || n.album}`))),
    text,
    el('div', { class: 'row asst-draft-acts' },
      btn('primary small', 'check', 'Salvează notița', async e => {
        const b = e.currentTarget; b.disabled = true;
        if (await guard(() => api('POST', `/api/albums/${n.album}/manage/notes`, { body: text.value.trim() }))) {
          b.lastChild.textContent = 'Salvată'; toast('Notița e în album, la Distribuire.', 'success');
        } else b.disabled = false;
      })));
}

const actionCard = a => (a.type === 'note' ? noteCard(a) : messageCard(a));

// ---- the conversation ----
const chipRow = (list, onAsk) => el('div', { class: 'asst-chips' }, list.map(c => btn('asst-chip', null, c, () => onAsk(c))));
const ASST_STARTERS = ['Ce am de făcut azi?', 'Scrie mesajul de livrare pentru ultimul album', 'Ce notițe am de la invitați?'];

function askBox(onAsk) {
  const input = el('input', { class: 'field', placeholder: 'Întreabă sau cere ceva…', autocomplete: 'off', 'aria-label': 'Întreabă asistentul' });
  const go = () => { const q = input.value.trim(); if (q && !ASST.busy) { input.value = ''; onAsk(q); } };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  return el('div', { class: 'asst-ask' }, ico('sparkles'), input, btn('icon-btn', 'arrow-up', null, go, { 'aria-label': 'Trimite întrebarea', title: 'Trimite' }));
}

function financeSwitch() {
  const input = el('input', { type: 'checkbox', checked: asstFinanceOn(), onchange: () => ui.set('assistFinance', input.checked) });
  return el('label', { class: 'asst-fin muted' }, input, 'Poate vedea un rezumat al finanțelor când îl întrebi');
}

function renderTurn(t, onAsk) {
  const out = [el('p', { class: 'asst-q' }, t.q)];
  if (t.pending) out.push(el('div', { class: 'asst-a' }, el('p', { class: 'muted asst-wait' }, 'Mă uit în albume…')));
  else if (t.error) out.push(el('div', { class: 'asst-a' }, el('p', { class: 'asst-err' }, t.error)));
  else out.push(el('div', { class: 'asst-a' }, t.text ? el('p', {}, t.text) : null, ...(t.actions || []).map(actionCard)));
  return out;
}

async function asstAsk(q, redraw) {
  const turn = { q, pending: true };
  ASST.history.push(turn); ASST.busy = true; redraw();
  try {
    const messages = [];
    for (const t of ASST.history.slice(-8)) {
      messages.push({ role: 'user', text: t.q });
      if (t !== turn && t.text) messages.push({ role: 'model', text: t.text });
    }
    const r = await api('POST', '/api/desktop/assistant', { messages, finance: await asstFinance() });
    Object.assign(turn, { text: r.text || '', actions: r.actions || [] });
  } catch (e) { turn.error = e.message || 'Asistentul nu răspunde acum.'; }
  turn.pending = false; ASST.busy = false; redraw();
}

function briefList(items, onAsk) {
  return el('ul', { class: 'asst-brief' }, items.map(i => el('li', {},
    el('span', { class: 'asst-ico' }, ico(i.icon)),
    el('div', { class: 'grow' }, el('b', {}, i.title), el('p', { class: 'muted' }, i.text)),
    btn('secondary small', null, i.act.label, () => (i.act.ask ? onAsk(i.act.ask) : openAlbum(i.act.open, i.act.tab))))));
}

// ---- "Azi" on the dashboard ----
{
  const base = renderHome;
  renderHome = function () {
    base();
    const dash = $('.dash'); if (!dash) return;
    const sub = el('p', { class: 'muted' }, 'Mă uit prin albume…');
    const list = el('div', { class: 'asst-list' });
    const out = el('div', { class: 'asst-out', 'aria-live': 'polite' });
    const ask = q => asstAsk(q, draw);
    function draw() {
      out.replaceChildren(...ASST.history.slice(-4).flatMap(t => renderTurn(t, ask)));
      if (!ASST.history.length) out.replaceChildren(chipRow(ASST_STARTERS, ask));
    }
    const panel = el('section', { class: 'dpanel asst-today' },
      el('div', { class: 'asst-top' }, el('div', {},
        el('h2', { class: 'asst-h' }, ico('sparkles'), `${greet()}${firstName() ? `, ${firstName()}` : ''}`), sub)),
      list, askBox(ask), out, financeSwitch());
    $('.dash-head', dash).after(panel);
    dash.style.height = 'auto'; dash.style.gridTemplateRows = 'none'; dash.style.flex = 'none'; // the brief pushes the rest down; the page scrolls
    draw();
    asstBrief().then(items => {
      if (!panel.isConnected) return;
      sub.textContent = !ASST.configured ? 'Asistentul se pornește în curând. Până atunci, iată ce văd în albume.'
        : items.length ? `Azi ai ${items.length === 1 ? 'un lucru' : `${items.length} lucruri`} de care să te ocupi.`
        : 'Nimic urgent azi. Întreabă-mă orice despre albume sau cere-mi un mesaj pentru un client.';
      list.replaceChildren(items.length ? briefList(items, ask) : '');
    });
  };
}
