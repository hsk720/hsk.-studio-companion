'use strict';
// The frame: sign-in gate, the collapsible sidebar, the workspace tabs (several albums at once), the command palette.

const S = {
  account: null, me: null, setup: null, prefs: null,
  albums: [],                    // the sidebar's list
  tabs: [{ id: 'home', kind: 'home', title: 'Panou' }],
  active: 'home',
  // the open album tab, mirrored here so the album screens read S.code / S.album / S.tab
  code: null, album: null, tab: 'photos',
  stats: {},                     // code → /manage answer without photos, for the dashboard and the badges
  offline: false,
};
const INNER = { photos: () => renderPhotos(), people: () => renderPeople(), share: () => renderShare(), settings: () => renderSettings() };
const INNER_TABS = [['photos', 'image', 'Poze'], ['people', 'users', 'Persoane'], ['share', 'link', 'Distribuire'], ['settings', 'sliders', 'Setări album']];

function gate(name) { // boot | welcome | app
  $('#boot').hidden = name !== 'boot';
  $('#welcome').hidden = name !== 'welcome';
  $('#app').hidden = name !== 'app';
}

// ---- account ----
async function applyAuth(auth) {
  S.offline = !!auth.offline;
  drawOffline();
  if (!auth.connected) {
    S.account = S.me = null;
    $('#connect-note').hidden = true;
    $('#claim').disabled = $('#connect').disabled = false;
    return gate('welcome');
  }
  S.account = auth.account;
  drawWho();
  $('#welcome-msg').textContent = '';
  $('#code').value = '';
  gate('app');
  buildChrome();
  applyLock();
  if (!S.locked) await enterApp();
}

/** A plan below Activ does not include the app: only the account page (profile, password, plan) is open. */
function applyLock() {
  S.locked = !!S.account && !S.account.owner && S.account.app_access === false;
  $('#app').classList.toggle('locked', S.locked);
  if (S.locked) {
    S.tabs = [{ id: 'account', kind: 'account', title: 'Cont' }];
    S.active = 'account';
    renderTabs();
    render();
  }
}

async function enterApp() {
  S.setup = await invoke('setup_get');
  S.prefs = await guard(() => invoke('prefs_get'));
  guard(async () => { S.me = await api('GET', '/api/desktop/me'); });
  await loadAlbums();
  restoreTabs();
  render();
  startAttention();
  startInbox();
}

function drawOffline() {
  const o = $('#offline');
  o.hidden = !S.offline;
  if (S.offline) o.replaceChildren(ico('wifi-off'), el('span', {}, 'Fără legătură la hsk.photos. Ce ai deschis rămâne vizibil, iar modificările așteaptă internetul.'));
}

$('#connect').addEventListener('click', async () => {
  $('#welcome-msg').textContent = '';
  try { await invoke('auth_start'); $('#connect-note').hidden = false; }
  catch (e) { $('#welcome-msg').textContent = String(e); }
});
$('#code').addEventListener('input', e => {
  const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  e.target.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
});
$('#manual').addEventListener('submit', async e => {
  e.preventDefault();
  $('#welcome-msg').textContent = '';
  $('#claim').disabled = true;
  try { applyAuth(await invoke('auth_claim', { code: $('#code').value })); }
  catch (err) { $('#welcome-msg').textContent = String(err); }
  finally { $('#claim').disabled = false; }
});
$('#who').addEventListener('click', () => openTab('account'));
listen('auth-changed', e => applyAuth(e.payload));
listen('auth-pending', () => { $('#welcome-msg').textContent = 'Se conectează…'; });
listen('auth-error', e => { $('#connect-note').hidden = true; $('#welcome-msg').textContent = String(e.payload); });

// ---- the frame: sidebar and top bar ----
function buildChrome() {
  $('#new-album').replaceChildren(ico('plus'), el('span', {}, 'Album nou'));
  $('#palette-btn').replaceChildren(ico('search'), el('span', {}, 'Caută'), el('kbd', {}, keys(MOD, 'K')));
  $('#new-album').title = `Album nou (${keys(MOD, 'N')})`;
  $('#vw-prev').replaceChildren(ico('chevron-left'));
  $('#vw-next').replaceChildren(ico('chevron-right'));
  drawNav();
}

$('#palette-btn').addEventListener('click', () => openPalette());
$('#new-album').addEventListener('click', () => newAlbumDialog());

function drawNav() {
  const attention = attentionCount();
  const items = [
    ['home', 'home', 'Panou', attention ? { n: attention } : null],
    ['watch', 'folder', 'Folder smart', S.setup && S.setup.watching ? { dot: true } : null],
    ['catalog', 'layers', 'Catalog', null],
    ['prefs', 'settings', 'Setări', null],
  ];
  $('#nav').replaceChildren(...items.map(([id, icon, label, badge]) => el('button', { type: 'button', class: `nav-btn${S.active === id ? ' on' : ''}`, title: label, dataset: { go: id },
    onclick: () => openTab(id) }, ico(icon), el('span', { class: 'lbl' }, label),
    badge && badge.n ? el('em', { class: 'badge-n' }, String(badge.n)) : null, badge && badge.dot ? el('i', { class: 'dot busy' }) : null)));
}

// ---- the album list ----
async function loadAlbums() {
  await guard(async () => { S.albums = (await api('GET', '/api/desktop/albums')).albums || []; });
  renderSide();
}

function renderSide() {
  const q = ($('#album-search').value || '').trim().toLowerCase();
  const list = S.albums.filter(a => !q || a.name.toLowerCase().includes(q));
  $('#albums').replaceChildren(...list.map(a => {
    const thumb = a.thumb ? el('img', { src: abs(a.thumb), alt: '', loading: 'lazy' }) : el('span', { class: 'ph' });
    thumb.addEventListener('error', () => thumb.replaceWith(el('span', { class: 'ph' })), { once: true });
    const on = S.active === `album:${a.code}`;
    return el('button', { type: 'button', class: `al-item${on ? ' on' : ''}`, dataset: { code: a.code }, title: a.name,
      onclick: e => openAlbum(a.code, undefined, e.metaKey || e.ctrlKey) },
    thumb, el('span', { class: 'lbl' }, el('b', {}, a.name), el('small', {}, [plural(a.photos, 'poză', 'poze'), fmtDay(a.event_date)].filter(Boolean).join(' · '))));
  }));
  if (!list.length) $('#albums').replaceChildren(el('p', { class: 'muted pad-s lbl' }, S.albums.length ? 'Niciun album cu acest nume.' : 'Nu ai încă niciun album.'));
}
$('#album-search').addEventListener('input', renderSide);

// ---- workspace tabs ----
const tabById = id => S.tabs.find(t => t.id === id);
const activeTab = () => tabById(S.active);

/** What the active album tab remembers, so coming back finds it as it was. */
function saveActive() {
  const t = activeTab();
  if (!t) return;
  if (t.kind === 'album') {
    Object.assign(t, { album: S.album, inner: S.tab, sel: [...sel.set], view: getPhotoView(), scroll: ($('#tab-body') || {}).scrollTop || 0 });
  } else t.scroll = ($('#stage') || {}).scrollTop || 0;
}

function openTab(id, { background = false } = {}) {
  let t = tabById(id);
  if (!t) {
    const kind = id.split(':')[0];
    t = { id, kind, title: { watch: 'Folder smart', prefs: 'Setări', account: 'Cont', catalog: 'Catalog' }[id] || id };
    S.tabs.push(t);
  }
  if (!background) activate(id);
  else renderTabs();
  persistTabs();
}

function activate(id) {
  saveActive();
  const t = tabById(id);
  if (!t) return;
  S.active = id;
  if (t.kind === 'album') {
    S.code = t.code; S.album = t.album || null; S.tab = t.inner || 'photos';
    sel.set = new Set(t.sel || []); sel.last = null;
    setPhotoView(t.view);
  } else { S.code = null; S.album = null; }
  render();
  drawBanner();
  drawWho();
  const body = t.kind === 'album' ? $('#tab-body') : $('#stage');
  if (body && t.scroll) body.scrollTop = t.scroll;
  if (t.kind === 'album' && (!t.album || Date.now() - (t.fetched || 0) > 60000)) refreshAlbum(t);
}

function closeTab(id) {
  const i = S.tabs.findIndex(t => t.id === id);
  if (i < 1) return; // the dashboard stays
  const wasActive = S.active === id;
  S.tabs.splice(i, 1);
  persistTabs();
  if (wasActive) { S.active = ''; activate((S.tabs[i] || S.tabs[i - 1]).id); } else renderTabs();
}

const persistTabs = () => ui.set('tabs', S.tabs.filter(t => t.kind === 'album' || ['watch', 'prefs', 'account', 'catalog'].includes(t.id)).map(t => t.id));
function restoreTabs() {
  for (const id of ui.get('tabs', [])) {
    if (id.startsWith('album:')) {
      const code = id.slice(6);
      if (S.albums.some(a => a.code === code) && !tabById(id)) S.tabs.push(albumTab(code));
    } else if (['watch', 'prefs', 'account', 'catalog'].includes(id) && !tabById(id)) S.tabs.push({ id, kind: id, title: { watch: 'Folder smart', prefs: 'Setări', account: 'Cont', catalog: 'Catalog' }[id] });
  }
  const last = ui.get('startup', 'last') === 'home' ? 'home' : ui.get('active', 'home');
  S.active = tabById(last) ? last : 'home';
  const t = tabById(S.active);
  if (t && t.kind === 'album') { S.code = t.code; refreshAlbum(t); }
}

function albumTab(code) {
  const a = S.albums.find(x => x.code === code);
  return { id: `album:${code}`, kind: 'album', code, title: a ? a.name : code, inner: 'photos' };
}

/** Opens an album in its tab, or focuses the tab it already has. Ctrl-click opens it behind the current one. */
function openAlbum(code, inner, background = false) {
  const id = `album:${code}`;
  if (!tabById(id)) S.tabs.push(albumTab(code));
  const t = tabById(id);
  if (inner) t.inner = inner;
  if (inner && S.active === id) { S.tab = inner; renderAlbum(); persistTabs(); return; }
  openTab(id, { background });
}

function renderTabs() {
  $('#tabstrip').replaceChildren(...S.tabs.map(t => {
    const icon = { home: 'home', album: 'image', watch: 'folder', prefs: 'settings', account: 'user', catalog: 'layers' }[t.kind];
    const badge = t.kind === 'album' ? albumAttention(t.code) : 0;
    return el('div', { class: `tab${t.id === S.active ? ' on' : ''}`, role: 'tab', 'aria-selected': String(t.id === S.active), dataset: { id: t.id } },
      el('button', { type: 'button', class: 'tab-main', onclick: () => activate(t.id), title: t.title, onauxclick: e => { if (e.button === 1) closeTab(t.id); } },
        ico(icon), el('span', {}, t.title), badge ? el('em', { class: 'badge-n' }, String(badge)) : null),
      t.kind === 'home' ? null : el('button', { type: 'button', class: 'tab-x', 'aria-label': `Închide ${t.title}`, onclick: () => closeTab(t.id) }, ico('x')));
  }));
  drawNav();
  $$('.al-item').forEach(b => b.classList.toggle('on', S.active === `album:${b.dataset.code}`));
  ui.set('active', S.active);
}

function render() {
  const t = activeTab();
  renderTabs();
  const stage = $('#stage');
  stage.dataset.view = t.kind;
  if (t.kind === 'home') renderHome();
  else if (t.kind === 'watch') renderWatch();
  else if (t.kind === 'prefs') renderPrefs();
  else if (t.kind === 'account') renderAccount();
  else if (t.kind === 'catalog') renderCatalog();
  else if (t.kind === 'album') {
    stage.replaceChildren(el('div', { class: 'album-pane' }, el('header', { id: 'al-head' }), el('div', { class: 'tabs', id: 'tabs', role: 'tablist' }), el('div', { id: 'tab-body' })));
    if (S.album) renderAlbum();
    else $('#tab-body').replaceChildren(el('p', { class: 'muted pad' }, 'Se încarcă albumul…'));
  }
}

// ---- one album ----
const fetchAlbum = code => api('GET', `/api/albums/${code}/manage`);

async function refreshAlbum(t) {
  const album = await guard(() => fetchAlbum(t.code));
  if (!album) { if (!t.album && S.active === t.id) $('#tab-body') && $('#tab-body').replaceChildren(el('p', { class: 'muted pad' }, 'Albumul nu a putut fi încărcat. Poate a expirat sau a fost șters.')); return; }
  t.album = album; t.fetched = Date.now(); t.title = album.name;
  S.stats[t.code] = album;
  if (S.active === t.id) { S.album = album; renderAlbum(); }
  renderTabs();
}

/** After a change: fetch again and redraw without leaving the tab, keeping the scroll. */
async function reloadAlbum() {
  const t = activeTab(), body = $('#tab-body'), top = body ? body.scrollTop : 0;
  if (!t || t.kind !== 'album') return;
  const album = await guard(() => fetchAlbum(t.code));
  if (!album) return;
  t.album = album; t.fetched = Date.now(); t.title = album.name; S.stats[t.code] = album;
  if (S.active !== t.id) return;
  S.album = album;
  const row = S.albums.find(a => a.code === t.code);
  if (row) { row.photos = album.photo_count; row.name = album.name; renderSide(); }
  renderAlbum();
  if ($('#tab-body')) $('#tab-body').scrollTop = top;
}

function drawAlbumHead() {
  const a = S.album;
  if (!a || !$('#al-head')) return;
  const left = daysLeft(a.expires_at);
  $('#al-head').replaceChildren(
    a.cover ? el('img', { class: 'cover', src: abs(a.cover), alt: '' }) : el('span', { class: 'cover ph' }),
    el('div', { class: 'al-title' },
      el('h1', {}, a.subtitle_icon ? ico(a.subtitle_icon, 'sub') : null, a.name),
      el('p', { class: 'muted' }, [a.subtitle, fmtDay(a.event_date), plural(a.photo_count, 'poză', 'poze'),
        a.access_mode === 'all' ? 'fără recunoaștere facială' : plural(a.face_count, 'față', 'fețe'),
        left > 0 ? `expiră în ${plural(left, 'zi', 'zile')}` : 'a expirat'].filter(Boolean).join(' · '))),
    btn('icon-btn big', 'copy', null, () => copyText(a.share_url), { title: 'Copiază linkul pentru invitați', 'aria-label': 'Copiază linkul pentru invitați' }));
}

function renderAlbum() {
  const a = S.album;
  if (!a || !$('#al-head')) return;
  const hot = albumAttention(S.code);
  drawAlbumHead();
  $('#tabs').replaceChildren(...INNER_TABS.map(([id, icon, label]) => el('button', { type: 'button', role: 'tab', class: S.tab === id ? 'on' : '',
    'aria-selected': String(S.tab === id), dataset: { tab: id },
    onclick: () => { if (S.tab === id) return; S.tab = id; sel.clear(); const t = activeTab(); if (t) t.inner = id; renderAlbum(); } },
  ico(icon), el('span', {}, label), id === 'share' && hot ? el('em', { class: 'badge-n' }, String(hot)) : null)));
  (INNER[S.tab] || INNER.photos)();
}

// ---- a new album ----
/** `from` (a folder the app noticed) pre-fills the form and sends its photos as soon as the album exists. */
async function newAlbumDialog(from = null) {
  const me = S.me || await guard(() => api('GET', '/api/desktop/me')) || {};
  S.me = me;
  const f = { name: from ? from.name : '', date: from ? from.date : '', keep: 0, kind: '', mode: 'all', recog: false, minors: false, parents: false, photos: false, terms: false, watch: false };
  const days = me.retention && me.retention.length ? me.retention : [30];
  f.keep = days.includes(90) ? 90 : days[days.length - 1];
  const name = el('input', { class: 'field', maxLength: 80, placeholder: 'Nunta Ioana și Andrei', value: f.name, oninput: () => { f.name = name.value; } });
  const date = el('input', { class: 'field', type: 'date', value: f.date, oninput: () => { f.date = date.value; } });
  const faceBox = el('div', { class: 'stack', hidden: true });
  const parentsRow = toggle('Am acordul scris al părinților', null, false, v => { f.parents = v; });
  parentsRow.hidden = true;
  faceBox.append(toggle('Am acordul explicit al persoanelor din poze', 'Recunoașterea facială îl cere.', false, v => { f.recog = v; }),
    toggle('În album sunt și minori', null, false, v => { f.minors = v; parentsRow.hidden = !v; }), parentsRow);
  const body = el('div', { class: 'form' },
    from ? el('p', { class: 'hint-box' }, ico('folder'), el('span', {}, `Folderul „${from.name}”: ${plural(from.count, 'poză', 'poze')} se trimit imediat după ce albumul e creat.`)) : null,
    el('label', { class: 'lbl' }, 'Numele albumului'), name,
    el('div', { class: 'two' }, el('div', {}, el('label', { class: 'lbl' }, 'Data evenimentului'), date),
      el('div', {}, el('label', { class: 'lbl' }, 'Rămâne online'), segmented(days.map(d => ({ value: d, label: d >= 365 ? '1 an' : `${d} zile` })), f.keep, v => { f.keep = Number(v); }, 'Cât rămâne online'))),
    el('label', { class: 'lbl' }, 'Tipul evenimentului'),
    chips([{ value: '', label: 'Altul' }, ...(me.event_types || []).map(k => ({ value: k.id, label: k.name }))], f.kind, v => { f.kind = v; }, 'Tipul evenimentului'),
    el('label', { class: 'lbl' }, 'Cum își găsesc invitații pozele'),
    segmented([{ value: 'all', icon: 'image', label: 'Tot albumul', hint: 'Fără recunoaștere facială' }, { value: 'both', icon: 'scan', label: 'Cu selfie și fețe', hint: 'Recunoaștere facială' }], f.mode,
      v => { f.mode = v; faceBox.hidden = v === 'all'; }, 'Cum își găsesc invitații pozele'),
    faceBox,
    toggle('Invitații sunt anunțați că se fac poze', null, false, v => { f.photos = v; }),
    me.terms_ok === false ? toggle('Accept Termenii pentru fotografi și Acordul de prelucrare a datelor', null, false, v => { f.terms = v; }) : null,
    from ? toggle('Urmărește folderul și după', 'Pozele care apar mai târziu în el se trimit singure.', false, v => { f.watch = v; }) : null);
  setTimeout(() => { name.focus(); name.select(); }, 50);
  const go = await modal({ title: 'Album nou', body, actions: [{ label: 'Renunț', value: false }, { label: 'Creează albumul', value: 'ok', primary: true }] });
  if (go !== 'ok') return null;
  if (!f.name.trim()) { toast('Dă-i un nume albumului.', 'error'); return null; }
  const made = await guard(() => api('POST', '/api/albums', {
    name: f.name.trim(), event_date: f.date, retention_days: f.keep, event_type: f.kind, access_mode: f.mode,
    minors: f.mode !== 'all' && f.minors, accept_terms: f.terms || me.terms_ok !== false,
    declare_photos: f.photos, declare_recognition: f.recog, declare_parents: f.parents }));
  if (!made) return null;
  toast('Albumul a fost creat.', 'success');
  await loadAlbums();
  openAlbum(made.code, 'photos');
  if (from) {
    S.setup = await invoke('setup_get');
    await guard(() => invoke('upload_paths', { album: made.code, paths: [from.path], mode: S.setup.mode }));
    if (f.watch) { const r = await guard(() => invoke('watch_start', { folder: from.path, album: made.code, albumName: f.name.trim(), mode: S.setup.mode, includeExisting: false })); if (r) { S.setup = r; drawNav(); } }
  }
  return made;
}

// ---- command palette ----
function paletteItems() {
  const out = [
    { label: 'Panou', hint: 'Prezentare și atenție', icon: 'home', run: () => openTab('home') },
    { label: 'Album nou', hint: keys(MOD, 'N'), icon: 'plus', run: () => newAlbumDialog() },
    { label: 'Folder smart', icon: 'folder', run: () => openTab('watch') },
    { label: 'Catalog: caută fișiere pe discuri', icon: 'layers', run: () => openTab('catalog') },
    { label: 'Setări', icon: 'settings', run: () => openTab('prefs') },
    { label: 'Cont: profil, parolă, abonament', icon: 'user', run: () => openTab('account') },
    { label: 'Scurtături de tastatură', hint: '?', icon: 'command', run: shortcutsDialog },
  ];
  for (const a of S.albums) out.push({ label: a.name, hint: 'Album', icon: 'image', run: () => openAlbum(a.code) });
  if (S.code) for (const [id, icon, label] of INNER_TABS) out.push({ label: `${S.album ? S.album.name : 'Album'} · ${label}`, hint: 'File', icon, run: () => openAlbum(S.code, id) });
  return out;
}

async function openPalette() {
  const items = paletteItems();
  let at = 0, shown = items;
  const input = el('input', { class: 'field', placeholder: 'Caută un album sau o acțiune…', autocomplete: 'off', 'aria-label': 'Caută' });
  const list = el('div', { class: 'palette-list', role: 'listbox' });
  const draw = () => list.replaceChildren(...shown.slice(0, 40).map((it, i) => el('button', { type: 'button', role: 'option', class: `pal-item${i === at ? ' on' : ''}`,
    onclick: () => { closeModal(i); } }, ico(it.icon), el('span', {}, it.label), it.hint ? el('small', { class: 'muted' }, it.hint) : null)));
  input.addEventListener('input', () => { const q = input.value.trim().toLowerCase(); shown = items.filter(i => !q || i.label.toLowerCase().includes(q)); at = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { at = Math.min(shown.length - 1, at + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { at = Math.max(0, at - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { closeModal(at); e.preventDefault(); }
  });
  draw();
  setTimeout(() => input.focus(), 30);
  const picked = await modal({ title: 'Caută', body: [input, list], actions: [], wide: true });
  if (typeof picked === 'number' && shown[picked]) shown[picked].run();
}

function shortcutsDialog() {
  const rows = [[keys(MOD, 'K'), 'Caută un album sau o acțiune'], [keys(MOD, 'N'), 'Album nou'], [keys(MOD, 'W'), 'Închide fila curentă'],
    [keys('Ctrl', 'Tab'), 'Fila următoare'], [`${keys(MOD, '1')} … 9`, 'Mergi la o filă'], [`Poze: ${keys(MOD, 'A')}`, 'Selectează toate pozele'], ['Poze: Esc', 'Anulează selecția'],
    ['Viewer: ← →', 'Poza anterioară, următoarea'], ['Viewer: 1 … 5', 'Dă o notă'], ['Viewer: H', 'Ascunde sau arată poza'], ['Viewer: Delete', 'Șterge poza'], ['Viewer: Esc', 'Închide']];
  return modal({ title: 'Scurtături', body: el('dl', { class: 'keys' }, rows.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])) });
}

addEventListener('keydown', e => {
  if ($('#app').hidden) return;
  const mod = e.metaKey || e.ctrlKey, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!$('#dlg').open) openPalette(); }
  else if (mod && e.key.toLowerCase() === 'n' && !$('#dlg').open) { e.preventDefault(); newAlbumDialog(); }
  else if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); closeTab(S.active); }
  else if (mod && e.key === 'Tab') { e.preventDefault(); const i = S.tabs.findIndex(t => t.id === S.active); activate(S.tabs[(i + (e.shiftKey ? S.tabs.length - 1 : 1)) % S.tabs.length].id); }
  else if (mod && /^[1-9]$/.test(e.key)) { const t = S.tabs[Number(e.key) - 1]; if (t) { e.preventDefault(); activate(t.id); } }
  else if (e.key === '?' && !typing && !$('#dlg').open) shortcutsDialog();
});
