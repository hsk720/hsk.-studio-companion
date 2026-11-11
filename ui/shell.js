'use strict';
// The frame: sign-in gate, the album list on the left, the four tabs of an album.

const S = {
  account: null, me: null, setup: null,
  albums: [],            // the sidebar's list
  code: null,            // the open album
  album: null,           // its /manage answer, photos included
  tab: 'photos',
  view: 'empty',
};
const TABS = { photos: () => renderPhotos(), people: () => renderPeople(), share: () => renderShare(), settings: () => renderSettings() };

function gate(name) { // boot | welcome | app
  $('#boot').hidden = name !== 'boot';
  $('#welcome').hidden = name !== 'welcome';
  $('#app').hidden = name !== 'app';
}

function show(view) {
  S.view = view;
  for (const v of ['empty', 'album', 'watch', 'prefs']) $(`#v-${v}`).hidden = v !== view;
  $$('.nav-btn').forEach(b => b.classList.toggle('on', b.dataset.go === view));
  $$('.al-item').forEach(b => b.classList.toggle('on', view === 'album' && b.dataset.code === S.code));
}

// ---- account ----
async function applyAuth(auth) {
  $('#offline').hidden = !auth.offline;
  if (!auth.connected) {
    S.account = S.me = null;
    $('#connect-note').hidden = true;
    $('#claim').disabled = $('#connect').disabled = false;
    return gate('welcome');
  }
  S.account = auth.account;
  $('#who-name').textContent = auth.account ? auth.account.name : '';
  $('#welcome-msg').textContent = '';
  $('#code').value = '';
  gate('app');
  S.setup = await invoke('setup_get');
  guard(async () => { S.me = await api('GET', '/api/desktop/me'); });
  await loadAlbums();
  const last = (() => { try { return localStorage.getItem('hsk.last'); } catch { return null; } })();
  if (S.view === 'empty' && last && S.albums.some(a => a.code === last)) openAlbum(last);
  else if (S.view === 'empty' && S.albums.length === 1) openAlbum(S.albums[0].code);
  else show(S.view);
  watchDot();
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
$('#sign-out').addEventListener('click', async () => {
  if (await confirmBox('Deconectezi aplicația?', 'Albumele rămân pe hsk.photos. Folderul urmărit se oprește până te conectezi din nou.', 'Deconectează')) invoke('auth_sign_out');
});
listen('auth-changed', e => applyAuth(e.payload));
listen('auth-pending', () => { $('#welcome-msg').textContent = 'Se conectează…'; });
listen('auth-error', e => { $('#connect-note').hidden = true; $('#welcome-msg').textContent = String(e.payload); });

// ---- sidebar ----
async function loadAlbums() {
  await guard(async () => { S.albums = (await api('GET', '/api/desktop/albums')).albums || []; });
  renderSide();
}

function renderSide() {
  $('#albums').replaceChildren(...S.albums.map(a => {
    const thumb = a.thumb ? el('img', { src: abs(a.thumb), alt: '', loading: 'lazy' }) : el('span', { class: 'ph' });
    thumb.addEventListener('error', () => thumb.replaceWith(el('span', { class: 'ph' })), { once: true });
    return el('button', { type: 'button', class: `al-item${S.view === 'album' && a.code === S.code ? ' on' : ''}`, dataset: { code: a.code },
      onclick: () => openAlbum(a.code) },
      thumb,
      el('span', {}, el('b', {}, a.name), el('small', {}, [plural(a.photos, 'poză', 'poze'), fmtDay(a.event_date)].filter(Boolean).join(' · '))));
  }));
  $('#empty-text').textContent = S.albums.length ? 'Alege un album din stânga sau creează unul nou.' : 'Nu ai încă niciun album. Creează primul cu butonul „Album nou”.';
}

$$('.nav-btn').forEach(b => b.addEventListener('click', () => { show(b.dataset.go); if (b.dataset.go === 'watch') renderWatch(); else renderPrefs(); }));

// ---- one album ----
async function fetchAlbum(code) {
  return api('GET', `/api/albums/${code}/manage`);
}

async function openAlbum(code, tab) {
  S.code = code;
  if (tab) S.tab = tab;
  try { localStorage.setItem('hsk.last', code); } catch { /* storage blocked */ }
  sel.clear();
  show('album');
  $('#tab-body').replaceChildren(el('p', { class: 'muted pad' }, 'Se încarcă albumul…'));
  const album = await guard(() => fetchAlbum(code));
  if (!album) { $('#tab-body').replaceChildren(); return; }
  if (S.code !== code) return; // another album was opened meanwhile
  S.album = album;
  renderAlbum();
}

/** After a change: fetch again and redraw without leaving the tab, keeping the scroll. */
async function reloadAlbum() {
  const body = $('#tab-body'), top = body.scrollTop;
  const album = await guard(() => fetchAlbum(S.code));
  if (!album) return;
  S.album = album;
  const row = S.albums.find(a => a.code === S.code);
  if (row) { row.photos = album.photo_count; row.name = album.name; renderSide(); }
  renderAlbum();
  body.scrollTop = top;
}

function renderAlbum() {
  const a = S.album;
  const left = daysLeft(a.expires_at);
  $('#al-head').replaceChildren(
    a.cover ? el('img', { class: 'cover', src: abs(a.cover), alt: '' }) : el('span', { class: 'cover ph' }),
    el('div', { class: 'al-title' },
      el('h1', {}, a.name),
      el('p', { class: 'muted' }, [a.subtitle, fmtDay(a.event_date), plural(a.photo_count, 'poză', 'poze'),
        a.access_mode === 'all' ? 'fără recunoaștere facială' : plural(a.face_count, 'față', 'fețe'),
        left > 0 ? `expiră în ${plural(left, 'zi', 'zile')}` : 'a expirat'].filter(Boolean).join(' · '))),
    el('div', { class: 'al-actions' },
      el('button', { class: 'secondary', type: 'button', onclick: () => copyText(a.share_url) }, 'Copiază linkul'),
      el('button', { class: 'secondary', type: 'button', onclick: () => siteOpen(`/a/${a.code}`) }, 'Deschide pe site')));
  $$('#tabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === S.tab);
    b.setAttribute('aria-selected', String(b.dataset.tab === S.tab));
  });
  (TABS[S.tab] || TABS.photos)();
}

$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b || b.dataset.tab === S.tab) return;
  S.tab = b.dataset.tab;
  sel.clear();
  renderAlbum();
});

// ---- a new album ----
$('#new-album').addEventListener('click', () => newAlbumDialog());

async function newAlbumDialog() {
  const me = S.me || await guard(() => api('GET', '/api/desktop/me')) || {};
  S.me = me;
  const name = el('input', { class: 'field', maxLength: 80, placeholder: 'Nunta Ioana și Andrei' });
  const date = el('input', { class: 'field', type: 'date' });
  const kinds = [{ id: '', name: 'Fără' }, ...(me.event_types || [])];
  const kind = el('select', { class: 'field' }, kinds.map(k => el('option', { value: k.id }, k.name)));
  const days = (me.retention && me.retention.length ? me.retention : [30]);
  const keep = el('select', { class: 'field' }, days.map(d => el('option', { value: d, selected: d === (days.includes(90) ? 90 : days[days.length - 1]) }, d >= 365 ? '1 an' : `${d} de zile`)));
  const mode = el('select', { class: 'field' },
    el('option', { value: 'all' }, 'Tot albumul, fără recunoaștere facială'),
    el('option', { value: 'both' }, 'Invitații își găsesc pozele cu un selfie sau din lista de fețe'));
  const photos = el('input', { type: 'checkbox' }), recog = el('input', { type: 'checkbox' });
  const minors = el('input', { type: 'checkbox' }), parents = el('input', { type: 'checkbox' }), terms = el('input', { type: 'checkbox' });
  const faceBox = el('div', { class: 'stack', hidden: true },
    el('label', { class: 'check' }, recog, el('span', {}, 'Am acordul explicit al persoanelor din poze pentru recunoașterea facială.')),
    el('label', { class: 'check' }, minors, el('span', {}, 'În album sunt și minori.')),
    el('label', { class: 'check', hidden: true }, parents, el('span', {}, 'Am acordul scris al părinților.')));
  mode.addEventListener('change', () => { faceBox.hidden = mode.value === 'all'; });
  minors.addEventListener('change', () => { parents.closest('label').hidden = !minors.checked; });
  const body = el('div', { class: 'form' },
    el('label', { class: 'lbl' }, 'Numele albumului'), name,
    el('div', { class: 'two' },
      el('div', {}, el('label', { class: 'lbl' }, 'Data evenimentului'), date),
      el('div', {}, el('label', { class: 'lbl' }, 'Rămâne online'), keep)),
    el('label', { class: 'lbl' }, 'Tipul evenimentului'), kind,
    el('label', { class: 'lbl' }, 'Cum își găsesc invitații pozele'), mode, faceBox,
    el('label', { class: 'check' }, photos, el('span', {}, 'Invitații sunt anunțați că se fac poze.')),
    me.terms_ok === false ? el('label', { class: 'check' }, terms, el('span', {}, 'Accept Termenii pentru fotografi și Acordul de prelucrare a datelor.')) : null);
  setTimeout(() => name.focus(), 50);
  const go = await modal({ title: 'Album nou', body, actions: [{ label: 'Renunț', value: false }, { label: 'Creează albumul', value: 'ok', primary: true }] });
  if (go !== 'ok') return;
  if (!name.value.trim()) return toast('Dă-i un nume albumului.', 'error');
  const made = await guard(() => api('POST', '/api/albums', {
    name: name.value.trim(), event_date: date.value, retention_days: Number(keep.value), event_type: kind.value,
    access_mode: mode.value, minors: mode.value !== 'all' && minors.checked, accept_terms: terms.checked || me.terms_ok !== false,
    declare_photos: photos.checked, declare_recognition: recog.checked, declare_parents: parents.checked }));
  if (!made) return;
  toast('Albumul a fost creat.', 'success');
  await loadAlbums();
  openAlbum(made.code, 'photos');
}
