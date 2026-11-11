'use strict';
// The window only draws. Token, disk and network stay in Rust, behind these commands.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = id => document.getElementById(id);
const SITE = 'https://hsk.photos';

const views = ['loading', 'welcome', 'setup', 'live'];
const show = name => views.forEach(v => { $(`view-${v}`).hidden = v !== name; });

const HINTS = {
  original: 'Fișierul exact cum l-ai exportat, la rezoluție completă. Potrivit când invitații descarcă pozele finale.',
  webp: 'O copie de 2560 px făcută pe acest calculator, de câteva ori mai mică. Potrivit când vrei albumul online în timpul evenimentului.',
};
const STATES = { waiting: 'în așteptare', preparing: 'se pregătește', uploading: 'se trimite', sent: 'trimisă', duplicate: 'era deja în album', failed: 'nereușită' };

let albums = [];
let setup = { folder: null, album: null, album_name: '', mode: 'original', watching: false };

const sitePath = u => { try { const x = new URL(u, SITE); return x.pathname + x.search; } catch { return '/'; } };
const count = n => `${new Intl.NumberFormat('ro-RO').format(n)} ${n === 1 ? 'poză' : (n % 100 === 0 || n % 100 >= 20) ? 'de poze' : 'poze'}`;
const day = v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };

// the end of a path says more than its start
function shortPath(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

// ---- account ----
function applyAuth(auth) {
  $('who').hidden = !auth.connected;
  $('who-name').textContent = auth.account ? auth.account.name : '';
  $('offline').hidden = !auth.offline;
  if (!auth.connected) {
    $('connect-note').hidden = true;
    $('claim').disabled = $('connect').disabled = false;
    return show('welcome');
  }
  $('welcome-msg').textContent = '';
  $('code').value = '';
  loadSetup();
}

$('connect').addEventListener('click', async () => {
  $('welcome-msg').textContent = '';
  try { await invoke('auth_start'); $('connect-note').hidden = false; }
  catch (e) { $('welcome-msg').textContent = String(e); }
});

$('code').addEventListener('input', e => {
  const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  e.target.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
});

$('manual').addEventListener('submit', async e => {
  e.preventDefault();
  $('welcome-msg').textContent = '';
  $('claim').disabled = true;
  try { applyAuth(await invoke('auth_claim', { code: $('code').value })); }
  catch (err) { $('welcome-msg').textContent = String(err); }
  finally { $('claim').disabled = false; }
});

$('sign-out').addEventListener('click', () => invoke('auth_sign_out'));

listen('auth-changed', e => applyAuth(e.payload));
listen('auth-pending', () => { $('welcome-msg').textContent = 'Se conectează…'; });
listen('auth-error', e => { $('connect-note').hidden = true; $('welcome-msg').textContent = String(e.payload); });

// ---- album, folder, mode ----
async function loadSetup() {
  setup = await invoke('setup_get');
  if (setup.watching) return showLive();
  show('setup');
  drawFolder();
  document.querySelector(`input[name=mode][value=${setup.mode}]`).checked = true;
  $('mode-hint').textContent = HINTS[setup.mode];
  try {
    albums = (await invoke('albums_list')).albums || [];
    $('setup-msg').textContent = '';
  } catch (e) { albums = []; $('setup-msg').textContent = String(e); }
  if (!albums.some(a => a.code === setup.album)) setup.album = albums.length === 1 ? albums[0].code : null;
  drawAlbums();
}

function drawAlbums() {
  $('albums-empty').hidden = albums.length > 0;
  $('albums').replaceChildren(...albums.map(a => {
    const thumb = a.thumb ? el('img', { src: new URL(a.thumb, SITE).href, alt: '', loading: 'lazy' }) : el('span', { className: 'ph' });
    thumb.addEventListener('error', () => thumb.replaceWith(el('span', { className: 'ph' })));
    const row = el('button', { type: 'button', className: 'album' }, thumb,
      el('span', {}, el('b', { textContent: a.name }), el('small', { textContent: [count(a.photos), day(a.event_date)].filter(Boolean).join(' · ') })),
      el('i'));
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', String(a.code === setup.album));
    row.addEventListener('click', () => { setup.album = a.code; drawAlbums(); });
    return row;
  }));
  ready();
}

function drawFolder() {
  const f = $('folder');
  f.textContent = setup.folder ? shortPath(setup.folder) : 'Niciun folder ales';
  f.title = setup.folder || '';
  f.classList.toggle('set', !!setup.folder);
  ready();
}

const ready = () => { $('start').disabled = !(setup.album && setup.folder); };

$('pick').addEventListener('click', async () => {
  const folder = await invoke('folder_pick');
  if (folder) { setup.folder = folder; drawFolder(); }
});

document.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => {
  setup.mode = r.value;
  $('mode-hint').textContent = HINTS[r.value];
}));

$('new-album').addEventListener('click', () => invoke('site_open', { path: '/fotograf' }));

$('start').addEventListener('click', async () => {
  const album = albums.find(a => a.code === setup.album);
  $('setup-msg').textContent = '';
  try {
    setup = await invoke('watch_start', { folder: setup.folder, album: album.code, albumName: album.name, mode: setup.mode, includeExisting: $('existing').checked });
    showLive();
  } catch (e) { $('setup-msg').textContent = String(e); }
});

// ---- live ----
async function showLive() {
  show('live');
  $('live-folder').textContent = setup.folder ? setup.folder.split(/[\\/]/).filter(Boolean).pop() : '';
  $('live-folder').title = setup.folder || '';
  $('live-album').textContent = setup.album_name || setup.album;
  drawQueue(await invoke('queue_get'));
}

function drawQueue(q) {
  $('n-sent').textContent = q.sent;
  $('n-waiting').textContent = q.waiting;
  $('n-failed').textContent = q.failed;
  $('retry-row').hidden = q.failed === 0;
  $('dot').classList.toggle('busy', q.waiting > 0);
  $('state-text').textContent = q.waiting > 0 ? 'Se trimit pozele' : 'Urmăresc folderul';
  $('queue-empty').hidden = q.items.length > 0;
  $('queue').hidden = q.items.length === 0;
  $('queue').replaceChildren(...q.items.map(i =>
    el('li', { className: i.state }, el('span', { textContent: i.name }), el('span', { textContent: i.state === 'failed' ? i.detail : (i.detail || STATES[i.state]) }))));
}

listen('queue-changed', e => { if (!$('view-live').hidden) drawQueue(e.payload); });
$('retry').addEventListener('click', () => invoke('queue_retry'));
$('live-album').addEventListener('click', () => invoke('site_open', { path: `/fotograf/${setup.album}` }));
$('stop').addEventListener('click', async () => { setup = await invoke('watch_stop'); loadSetup(); });

invoke('auth_state').then(applyAuth);
