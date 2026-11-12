'use strict';
// The dashboard and the attention panel: anything out of the ordinary is brought to the photographer, not left to be found.

const ATT = new Map();            // source → items; each source replaces its own list
const LEVEL = { critical: 0, warn: 1, info: 2 };
const dismissed = () => ui.get('dismissed', {});

/** A source (the albums, the upload queue, a detected folder…) says what it sees now. */
function setAttention(source, items) {
  ATT.set(source, items);
  drawAttention();
}

function allAttention() {
  const gone = dismissed();
  return [...ATT.values()].flat().filter(i => !(i.dismissible && gone[i.id])).sort((a, b) => LEVEL[a.level] - LEVEL[b.level]);
}
const attentionCount = () => allAttention().filter(i => i.level !== 'info').length;
/** What waits in an album: guest notes not yet done, open reports. */
function albumAttention(code) {
  const m = S.stats[code];
  if (!m) return 0;
  return (m.notes || []).filter(n => n.author !== 'photographer' && !n.done_at).length + (m.reports || []).filter(r => r.status === 'open').length;
}

function drawAttention() {
  drawNav();
  renderTabs();
  drawBanner();
  const box = $('#attn');
  if (box) box.replaceWith(attentionPanel());
}

/** A strip over the work area for the most important thing, on every tab except the dashboard. */
function drawBanner() {
  let b = $('#attn-banner');
  if (!b) { b = el('div', { id: 'attn-banner', hidden: true }); $('#offline').after(b); }
  const urgent = allAttention().filter(i => i.level !== 'info');
  b.hidden = !urgent.length || S.active === 'home';
  if (b.hidden) return;
  const top = urgent[0];
  b.className = top.level;
  b.replaceChildren(ico(top.level === 'critical' ? 'alert' : 'bell'), el('span', { class: 'grow' }, el('b', {}, top.title), ' ', top.text),
    urgent.length > 1 ? el('button', { type: 'button', class: 'quiet', onclick: () => openTab('home') }, `Încă ${urgent.length - 1} în Panou`) : null,
    top.action ? el('button', { type: 'button', class: 'secondary small', onclick: top.action.run }, top.action.label) : null);
}

function attentionPanel() {
  const items = allAttention();
  return el('section', { id: 'attn', class: 'group' },
    el('div', { class: 'group-head' }, el('h2', {}, 'Atenție'), el('p', { class: 'muted' }, items.length ? 'Ce iese din comun, cu ce trebuie făcut.' : '')),
    items.length ? el('ul', { class: 'attn-list' }, items.map(i => el('li', { class: `attn ${i.level}` },
      ico(i.icon || (i.level === 'critical' ? 'alert' : i.level === 'warn' ? 'bell' : 'info')),
      el('div', { class: 'grow' }, el('b', {}, i.title), el('p', { class: 'muted' }, i.text)),
      i.action ? el('button', { type: 'button', class: 'secondary small', onclick: i.action.run }, i.action.label) : null,
      i.dismissible ? el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Ascunde', title: 'Ascunde', onclick: () => { const d = dismissed(); d[i.id] = Date.now(); ui.set('dismissed', d); drawAttention(); } }, ico('x')) : null)))
      : el('p', { class: 'calm' }, ico('check'), el('span', {}, 'Totul e în regulă. Nimic nu cere atenția ta acum.')));
}

// ---- watching the albums ----
let attnTimer = 0;
function startAttention() {
  clearInterval(attnTimer);
  refreshAttention();
  attnTimer = setInterval(refreshAttention, 90000);
  addEventListener('focus', () => refreshAttention());
}

async function refreshAttention() {
  if (!S.account || $('#app').hidden) return;
  const rows = S.albums.slice(0, 25);
  const got = await Promise.all(rows.map(a => api('GET', `/api/albums/${a.code}/manage?photos=false`).catch(() => null)));
  const items = [];
  let quota = null;
  rows.forEach((a, i) => {
    const m = got[i];
    if (!m) return;
    S.stats[a.code] = m;
    quota = quota || m.quota;
    const reports = (m.reports || []).filter(r => r.status === 'open').length;
    const notes = (m.notes || []).filter(n => n.author !== 'photographer' && !n.done_at).length;
    const left = daysLeft(m.expires_at);
    if (reports) items.push({ id: `rep:${a.code}:${reports}`, level: 'warn', icon: 'alert', title: `${plural(reports, 'cerere de ascundere sau ștergere', 'cereri de ascundere sau ștergere')} în „${m.name}”`,
      text: 'Cineva a cerut să fie ascunsă sau ștearsă o poză.', action: { label: 'Rezolvă', run: () => openAlbum(a.code, 'share') } });
    if (notes) items.push({ id: `note:${a.code}:${notes}`, level: 'info', icon: 'message', title: `${plural(notes, 'notiță nouă', 'notițe noi')} în „${m.name}”`,
      text: 'Invitații au scris ce vor retușat.', action: { label: 'Citește', run: () => openAlbum(a.code, 'share') }, dismissible: true });
    if (left > 0 && left <= 7) items.push({ id: `exp:${a.code}:${left}`, level: left <= 2 ? 'critical' : 'warn', icon: 'clock', title: `„${m.name}” expiră în ${plural(left, 'zi', 'zile')}`,
      text: 'După expirare albumul și pozele se șterg de pe server. Descarcă originalele dacă nu le ai.', action: { label: 'Deschide albumul', run: () => openAlbum(a.code, 'share') }, dismissible: left > 2 });
    if (m.pending_analysis) items.push({ id: `scan:${a.code}`, level: 'info', icon: 'scan', title: `Se caută fețele în „${m.name}”`, text: `${plural(m.pending_analysis, 'poză mai așteaptă', 'poze mai așteaptă')}. Persoanele apar pe măsură ce se termină.`, dismissible: true });
  });
  if (quota && quota.limit) {
    const pct = quota.used / quota.limit;
    if (quota.over) items.push({ id: 'quota:over', level: 'critical', icon: 'alert', title: 'Spațiul planului s-a umplut', text: `${fmtBytes(quota.used)} din ${fmtBytes(quota.limit)}. Încărcările noi pot fi refuzate. Șterge albume vechi sau schimbă planul.`, action: { label: 'Planul, pe site', run: () => siteOpen('/fotograf') } });
    else if (pct >= .85) items.push({ id: 'quota:near', level: 'warn', icon: 'alert', title: `Ai folosit ${Math.round(pct * 100)}% din spațiu`, text: `${fmtBytes(quota.used)} din ${fmtBytes(quota.limit)}.`, action: { label: 'Planul, pe site', run: () => siteOpen('/fotograf') }, dismissible: true });
  }
  setAttention('albums', items);
  if (S.active === 'home') renderHome();
}

// ---- the dashboard ----
/** Demo album and tutorial, each with its own hide button; once both are hidden the group is gone. */
function introGroup() {
  const demo = !ui.get('hideDemo', false), tour = !ui.get('hideTour', false);
  if (!demo && !tour) return null;
  const row = (title, text, actions) => el('div', { class: 'intro-row' }, el('div', {}, el('b', {}, title), el('p', { class: 'muted' }, text)), el('div', { class: 'intro-acts' }, ...actions));
  return group('Începe de aici', 'Ca să vezi cum merg lucrurile înainte să încarci un album adevărat.', el('div', { class: 'stack' },
    demo ? row('Album demo', S.demo ? 'Un album de probă, doar al tău, cu poze deja încărcate. Încarci, sortezi, distribui, fără să atingi albumele tale. Dispare singur după trei zile.'
      : 'Ți-l facem cu un clic: un album de probă, doar al tău, cu poze deja încărcate.',
    [btn('primary small', 'image', S.demo ? 'Deschide albumul demo' : 'Creează albumul demo', openDemo), btn('quiet', null, 'Ascunde', () => hideIntro(['demo']))]) : null,
    tour ? row('Tutorial', 'Un tur de jumătate de minut prin aplicație.',
      [btn('secondary small', 'sparkles', 'Pornește tutorialul', () => tourStart()), btn('quiet', null, 'Ascunde', () => hideIntro(['tour']))]) : null,
    el('p', { class: 'muted' }, el('button', { class: 'quiet', type: 'button', onclick: () => hideIntro(['demo', 'tour']) }, 'Ascunde tot'), ' · le găsești oricând în căutare.')));
}

function renderHome() {
  const stage = $('#stage');
  const stats = S.albums.map(a => S.stats[a.code]).filter(Boolean);
  const photos = S.albums.reduce((n, a) => n + (a.photos || 0), 0);
  const searches = stats.reduce((n, m) => n + (m.searches || 0), 0);
  const q = (stats.find(m => m.quota) || {}).quota;
  const stat = (label, value, extra) => el('div', { class: 'stat' }, el('dd', {}, value), el('dt', {}, label), extra || null);
  stage.replaceChildren(el('div', { class: 'home pad stack' },
    el('div', {}, el('h1', {}, 'Panou'), el('p', { class: 'muted' }, S.account ? `${S.account.name} · plan ${S.account.plan}` : '')),
    attentionPanel(),
    group('Pe scurt', null, el('dl', { class: 'stats' },
      stat('Albume active', nf.format(S.albums.length)),
      stat('Poze în total', nf.format(photos)),
      stat('Căutări ale invitaților', nf.format(searches)),
      q && q.limit ? stat('Spațiu folosit', `${Math.round((q.used / q.limit) * 100)}%`, el('div', { class: 'bar' }, el('i', { style: `width:${Math.min(100, Math.round((q.used / q.limit) * 100))}%` }))) : null)),
    introGroup(),
    S.albums.length ? null : group('Primul album', null, el('ol', { class: 'steps' },
      el('li', {}, 'Apasă „Album nou” din stânga și dă-i un nume.'),
      el('li', {}, 'Trage pozele sau un folder în fereastră. Fețele se caută singure.'),
      el('li', {}, 'Trimite linkul invitaților din fila Distribuire.')))));
  $('#stage').scrollTop = 0;
}
