'use strict';
// The photos of an album: grid, filters, selection, the actions on a selection, the viewer, upload and retouch.

const sel = {
  set: new Set(), last: null,
  clear() { this.set.clear(); this.last = null; },
  get size() { return this.set.size; },
};
// what each album tab remembers about how its photos are shown
const DEFAULT_VIEW = { filter: 'all', sort: 'recent', q: '', size: 150 };
let pv = { ...DEFAULT_VIEW };
const getPhotoView = () => ({ ...pv });
const setPhotoView = v => { pv = { ...DEFAULT_VIEW, size: ui.get('grid-size', 150), ...(v || {}) }; };
let shown = []; // the photos the grid shows now, in order

const FILTERS = [
  { value: 'all', label: 'Toate', test: () => true },
  { value: 'faces', label: 'Cu fețe', test: p => p.faces > 0, recog: true },
  { value: 'noface', label: 'Fără fețe', test: p => !p.faces && p.indexed, recog: true },
  { value: 'rated', label: 'Notate', test: p => p.rating > 0 },
  { value: 'hidden', label: 'Ascunse', test: p => p.hidden || p.private },
];
const SORTS = {
  recent: { label: 'Recente', fn: () => 0 },
  rating: { label: 'Nota', fn: (a, b) => (b.rating || 0) - (a.rating || 0) },
  name: { label: 'Nume', fn: (a, b) => a.filename.localeCompare(b.filename, 'ro', { numeric: true }) },
  taken: { label: 'Data pozei', fn: (a, b) => (a.taken_at || a.created_at) - (b.taken_at || b.created_at) },
};

function renderPhotos() {
  const a = S.album, body = $('#tab-body');
  if (!a || !body) return;
  const recog = a.access_mode !== 'all';
  const filters = FILTERS.filter(f => recog || !f.recog);
  if (!filters.some(f => f.value === pv.filter)) pv.filter = 'all';
  const test = FILTERS.find(f => f.value === pv.filter).test, q = pv.q.trim().toLowerCase();
  shown = (a.photos || []).filter(p => test(p) && (!q || p.filename.toLowerCase().includes(q))).sort(SORTS[pv.sort].fn);
  const empty = !shown.length ? el('p', { class: 'empty' }, (a.photos || []).length ? 'Nicio poză nu se potrivește cu filtrul ales.' : 'Albumul e gol. Trage aici pozele sau un folder, ori folosește butoanele de sus.') : null;
  const grid = el('div', { class: 'grid', id: 'grid', style: `--tile:${pv.size}px` }, shown.map((p, i) => tile(p, i)));
  const searchBox = el('input', { class: 'field slim', type: 'search', placeholder: 'Caută după nume', value: pv.q, 'aria-label': 'Caută după nume', oninput: e => {
    pv.q = e.target.value; clearTimeout(searchBox._t); searchBox._t = setTimeout(() => { const at = e.target.selectionStart; regrid(); const n = $('#tab-body input[type=search]'); if (n) { n.focus(); n.setSelectionRange(at, at); } }, 250);
  } });
  body.replaceChildren(...[
    el('div', { class: 'toolbar' },
      btn('primary small', 'upload', 'Încarcă poze', uploadDialog, { title: 'Adaugă poze din calculator în acest album' }),
      el('span', { class: 'grow' }), searchBox, el('span', { class: 'muted count' }, plural(shown.length, 'poză', 'poze'))),
    el('div', { class: 'subbar' },
      segmented(filters.map(f => ({ value: f.value, label: f.label })), pv.filter, v => { pv.filter = v; sel.clear(); regrid(); }, 'Filtru'),
      el('span', { class: 'grow' }),
      el('span', { class: 'field-inline' }, ico('sort'), segmented(Object.entries(SORTS).map(([value, s]) => ({ value, label: s.label })), pv.sort, v => { pv.sort = v; regrid(); }, 'Sortare')),
      el('label', { class: 'field-inline' }, ico('grid'), el('input', { type: 'range', min: 90, max: 280, step: 10, value: pv.size, class: 'range', 'aria-label': 'Mărimea pozelor', oninput: e => { pv.size = Number(e.target.value); ui.set('grid-size', pv.size); $('#grid').style.setProperty('--tile', `${pv.size}px`); } }))),
    empty, grid, el('div', { class: 'selbar', id: 'selbar', hidden: true }),
  ].filter(Boolean));
  grid.addEventListener('click', onGridClick);
  drawSelection();
}

function tile(p, i) {
  return el('button', { type: 'button', class: `tile${sel.set.has(p.id) ? ' on' : ''}`, dataset: { i, id: p.id }, 'aria-label': p.filename },
    reveal(el('img', { src: abs(p.thumb), alt: '', loading: 'lazy', decoding: 'async' })),
    el('span', { class: 'chk', 'aria-hidden': 'true' }),
    p.rating ? el('span', { class: 'badge stars' }, '★'.repeat(p.rating)) : null,
    p.hidden || p.private ? el('span', { class: 'badge hid' }, ico('eye-off'), 'Ascunsă') : null,
    !p.indexed ? el('span', { class: 'badge soft' }, 'se caută fețe') : null);
}

/** The grid drawn again with its photos gliding from where they were (filters, sort, search, changes). */
const regrid = () => flip(() => $('#grid'), '.tile', 'id', renderPhotos);

function onGridClick(e) {
  const t = e.target.closest('.tile');
  if (!t) return;
  const i = Number(t.dataset.i), p = shown[i];
  if (e.target.closest('.chk') || sel.size || e.metaKey || e.ctrlKey || e.shiftKey) {
    if (e.shiftKey && sel.last != null) {
      const [x, y] = [Math.min(sel.last, i), Math.max(sel.last, i)];
      shown.slice(x, y + 1).forEach(q => sel.set.add(q.id));
    } else if (sel.set.has(p.id)) sel.set.delete(p.id);
    else sel.set.add(p.id);
    sel.last = i;
    $$('.tile', $('#grid')).forEach(n => n.classList.toggle('on', sel.set.has(n.dataset.id)));
    return drawSelection();
  }
  openViewer(shown, i, t);
}

const selectedPhotos = () => (S.album.photos || []).filter(p => sel.set.has(p.id));

function drawSelection() {
  const bar = $('#selbar');
  if (!bar) return;
  bar.hidden = sel.size === 0;
  if (!sel.size) return;
  const chosen = selectedPhotos();
  const allHidden = chosen.every(p => p.hidden || p.private);
  bar.replaceChildren(
    el('b', {}, plural(sel.size, 'selectată', 'selectate')),
    btn('quiet', null, 'Selectează tot', () => { shown.forEach(p => sel.set.add(p.id)); renderPhotos(); }),
    el('span', { class: 'grow' }),
    S.album.access_mode !== 'all' ? btn('secondary small', 'users', 'Mută în…', moveDialog) : null,
    btn('secondary small', 'star', 'Nota', rateDialog),
    btn('secondary small', allHidden ? 'eye' : 'eye-off', allHidden ? 'Arată' : 'Ascunde', () => bulk(allHidden ? 'show' : 'hide')),
    sel.size === 1 ? btn('secondary small', 'image', 'Copertă', () => coverDialog(chosen[0].id)) : null,
    btn('secondary small', 'edit', 'Editează', () => retouch(chosen)),
    btn('danger small', 'trash', 'Șterge', removeSelected),
    btn('quiet', null, 'Anulează', () => { sel.clear(); renderPhotos(); }));
}

// ---- actions on a selection ----
async function bulk(action, extra = {}, ids = [...sel.set]) {
  const set = new Set(ids);
  return instant(a => {
    if (action === 'delete') {
      a.photos = (a.photos || []).filter(p => !set.has(p.id));
      a.photo_count = Math.max(0, (a.photo_count || 0) - set.size);
    } else {
      for (const p of a.photos || []) {
        if (!set.has(p.id)) continue;
        if (action === 'hide') p.private = true;
        else if (action === 'show') p.private = false;
        else if (action === 'rate') p.rating = extra.rating;
      }
    }
    sel.clear();
  }, async () => {
    for (let i = 0; i < ids.length; i += 300) await api('POST', `/api/albums/${S.code}/photos/bulk`, { action, ids: ids.slice(i, i + 300), ...extra });
    return true;
  });
}

async function removeSelected() {
  const ids = [...sel.set];
  softDelete(ids);
}

/** An album from the server, without the photos whose deletion is still waiting (they are gone on screen). */
function dropPending(code, album) {
  if (!album || pendingDelete.code !== code || !pendingDelete.items.length) return album;
  const gone = new Set(pendingDelete.items.map(x => x.p.id));
  const photos = (album.photos || []).filter(p => !gone.has(p.id));
  return { ...album, photos, photo_count: Math.max(0, (album.photo_count || 0) - ((album.photos || []).length - photos.length)) };
}

// ---- delete with "Anulează" ----
// The photos leave the album at once; the server deletes them only when 15 s pass without another delete.
// Every delete in that time joins the same group and starts the 15 s again; "Anulează" brings the whole group back.
const pendingDelete = { code: null, items: [], timer: 0, toast: null };
const UNDO_MS = 15000;

function softDelete(ids) {
  if (!ids.length || !S.album) return;
  if (pendingDelete.code && pendingDelete.code !== S.code) flushDelete(); // another album's group goes now
  pendingDelete.code = S.code;
  const set = new Set(ids), photos = S.album.photos || [];
  const tiles = ids.map(id => $(`#grid .tile[data-id="${CSS.escape(id)}"]`));
  photos.forEach((p, i) => { if (set.has(p.id)) pendingDelete.items.push({ p, i }); });
  sel.clear();
  leave(tiles, () => flip(() => $('#grid'), '.tile', 'id', () => {
    S.album.photos = photos.filter(p => !set.has(p.id));
    S.album.photo_count = Math.max(0, (S.album.photo_count || 0) - set.size);
    const t = activeTab(); if (t && t.album) t.album = S.album;
    renderPhotos();
    drawAlbumHead();
  }));
  clearTimeout(pendingDelete.timer);
  pendingDelete.timer = setTimeout(flushDelete, UNDO_MS);
  drawUndo();
}

function drawUndo() {
  const n = pendingDelete.items.length;
  if (pendingDelete.toast) pendingDelete.toast.remove();
  const bar = el('i');
  const t = el('div', { class: 'toast undo', role: 'status' },
    el('span', {}, `${plural(n, 'poză ștearsă', 'poze șterse')}`),
    el('button', { type: 'button', onclick: undoDelete }, 'Anulează'), bar);
  $('#toasts').append(t);
  pendingDelete.toast = t;
  bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: UNDO_MS, easing: 'linear', fill: 'forwards' });
}

function undoDelete() {
  clearTimeout(pendingDelete.timer);
  const { code, items } = pendingDelete;
  Object.assign(pendingDelete, { code: null, items: [], timer: 0 });
  dismissToast(pendingDelete.toast); pendingDelete.toast = null;
  const target = S.code === code ? S.album : (tabById(`album:${code}`) || {}).album;
  if (!target) return;
  const back = (target.photos || []).slice();
  for (const { p, i } of items.sort((x, y) => x.i - y.i)) back.splice(Math.min(i, back.length), 0, p);
  const put = () => { target.photos = back; target.photo_count = (target.photo_count || 0) + items.length; };
  if (S.code === code && $('#grid')) flip(() => $('#grid'), '.tile', 'id', () => { put(); renderPhotos(); drawAlbumHead(); });
  else put();
  toast(items.length === 1 ? 'Poza a revenit în album.' : `${nf.format(items.length)} poze au revenit în album.`, 'success');
}

async function flushDelete() {
  clearTimeout(pendingDelete.timer);
  const { code, items } = pendingDelete;
  Object.assign(pendingDelete, { code: null, items: [], timer: 0 });
  dismissToast(pendingDelete.toast); pendingDelete.toast = null;
  if (!code || !items.length) return;
  const ids = items.map(x => x.p.id);
  try {
    for (let i = 0; i < ids.length; i += 300) await api('POST', `/api/albums/${code}/photos/bulk`, { action: 'delete', ids: ids.slice(i, i + 300) });
  } catch (e) {
    toast(e && e.message ? e.message : e, 'error');
  }
  if (S.code === code) reloadAlbum();
}
// closing the window or restarting it (Ctrl+Shift+R) during the 15 s: the photos stay (nothing is deleted unseen)

async function rateDialog() {
  const n = await modal({ title: `Nota pentru ${plural(sel.size, 'poză', 'poze')}`, body: el('p', { class: 'muted' }, 'Nota o vezi doar tu, nu invitații.'),
    actions: [{ label: 'Fără notă', value: 0 }, ...[1, 2, 3, 4, 5].map(v => ({ label: '★'.repeat(v), value: v })), { label: 'Renunț', value: undefined }] });
  if (n !== undefined) bulk('rate', { rating: n });
}

async function moveDialog() {
  const org = await guard(() => api('GET', `/api/albums/${S.code}/organize`));
  const opts = [['big', 'Poze de grup mari'], ['small', 'Poze de grup mici'], ['hide', 'Ascunde de invitați'],
    ...((org && org.people) || []).map(p => [`p${p.id}`, p.name || p.label])];
  const to = await modal({ title: `Mută ${plural(sel.size, 'poza', 'pozele')} în`, wide: true,
    body: el('div', { class: 'options' }, opts.map(([v, label]) => el('button', { type: 'button', class: 'secondary', onclick: () => closeModal(v) }, label))),
    actions: [{ label: 'Renunț', value: undefined }] });
  if (!to) return;
  const ids = [...sel.set];
  const ok = await instant(a => {
    if (to === 'hide') for (const p of a.photos || []) if (ids.includes(p.id)) p.private = true;
    sel.clear();
  }, async () => {
    for (let i = 0; i < ids.length; i += 300) await api('POST', `/api/albums/${S.code}/photos/sort`, { photos: ids.slice(i, i + 300), to });
    return true;
  });
  if (ok) toast('Pozele au fost mutate.', 'success');
}

// ---- upload ----
/** One upload button; what it can take is explained here, in the photographer's words. */
async function uploadDialog() {
  const choice = (value, icon, title, text) => el('button', { type: 'button', class: 'choice', onclick: () => closeModal(value) },
    ico(icon), el('span', {}, el('b', {}, title), el('small', { class: 'muted' }, text)));
  const mode = S.setup.mode === 'webp' ? 'copii pentru web (mai mici, ajung mai repede)' : 'originale, la rezoluție completă';
  const v = await modal({ title: `Încarcă în „${S.album ? S.album.name : 'album'}”`,
    body: el('div', { class: 'stack' },
      choice('files', 'image', 'Alege fotografii', 'Selectezi unul sau mai multe fișiere JPG sau PNG din calculator.'),
      choice('folder', 'folder-plus', 'Alege un folder întreg', 'Se iau toate pozele din el și din subfoldere, de exemplu exportul unui eveniment.'),
      el('p', { class: 'muted' }, 'Poți și să tragi pozele sau folderul direct în fereastră.'),
      el('p', { class: 'muted' }, `Se trimit ${mode}. `, btn('quiet', null, 'Schimbă din Setări', () => { closeModal(false); openTab('prefs'); }))),
    actions: [{ label: 'Renunț', value: false }] });
  if (v === 'files' || v === 'folder') pickUpload(v === 'folder');
}

async function pickUpload(folder) {
  const paths = folder ? [await invoke('folder_pick')].filter(Boolean) : await invoke('files_pick');
  if (paths.length) uploadPaths(paths);
}

async function uploadPaths(paths) {
  if (!S.code || activeTab().kind !== 'album') return toast('Deschide mai întâi albumul în care vrei pozele.', 'error');
  const n = await guard(() => invoke('upload_paths', { album: S.code, paths, mode: S.setup.mode }));
  if (n === 0) toast('Nu am găsit poze (JPG sau PNG) în ce ai ales.', 'error');
  else if (n) toast(`${plural(n, 'poză pusă', 'poze puse')} la trimis.`, 'success');
}

// ---- editing: Lightroom, Capture One, Photoshop or any program, opened from here ----
async function retouch(photos) {
  const info = await guard(() => invoke('retouch_start', { album: S.code, albumName: S.album.name,
    photos: photos.map(p => ({ id: p.id, filename: p.filename })) }));
  if (!info) return;
  // the explanation comes once; after that a short note, and the folder stays one click away in it
  if (ui.get('retouch-explained', false)) {
    toast(info.editor ? `${plural(photos.length, 'Poza s-a deschis', 'Pozele s-au deschis')} în ${info.editor}. Salvează peste fișier și se înlocuiește în album.`
      : `${plural(photos.length, 'Originalul e gata', 'Originalele sunt gata')} de editat în folderul albumului.`, 'success');
  } else {
    ui.set('retouch-explained', true);
    const go = await modal({ title: info.editor ? `Pozele s-au deschis în ${info.editor}` : 'Pozele sunt gata de editat', wide: true,
      body: el('div', { class: 'stack' },
        el('p', {}, `Am pus ${plural(photos.length, 'originalul', 'originalele')} în folderul de mai jos${info.editor ? ` și l-am deschis în ${info.editor}` : ''}.`),
        el('p', { class: 'path-box' }, info.folder),
        el('p', { class: 'muted' }, 'Editează-le în programul tău și salvează peste același fișier, cu același nume (în Lightroom: Exportă în acest folder, cu numele inițial). Fiecare salvare înlocuiește poza din album, în același loc și cu același link, în câteva secunde. Cât timp aplicația rulează, urmărește folderul.'),
        el('p', { class: 'muted' }, 'Fereastra asta apare doar acum. Data viitoare pozele se deschid direct.')),
      actions: [{ label: 'Am înțeles', value: false }, { label: 'Arată folderul', value: 'open', primary: true }] });
    if (go === 'open') guard(() => invoke('reveal', { path: info.folder }));
  }
  sel.clear();
  if ($('#grid')) renderPhotos();
}

// ---- viewer ----
const vw = { list: [], i: 0 };

/** Opens the viewer; from a tile in the grid, the photo grows out of that tile. */
function openViewer(list, i, from = null) {
  vw.list = list; vw.i = i;
  const viewer = $('#viewer'), img = $('#vw-img');
  const start = from && !calm() ? from.getBoundingClientRect() : null;
  if (start) viewer.classList.add('opening');
  viewer.hidden = false;
  vwRender();
  wakeViewer();
  if (!start) return;
  // the small copy is already decoded (the grid showed it): measure where it lands and grow it from the tile
  (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => {
    const end = img.getBoundingClientRect();
    if (!end.width) { viewer.classList.remove('opening'); return; }
    const k = Math.max(start.width / end.width, start.height / end.height);
    const dx = start.left + start.width / 2 - (end.left + end.width / 2), dy = start.top + start.height / 2 - (end.top + end.height / 2);
    img.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${k})`, borderRadius: '6px' }, { transform: 'none' }],
      { duration: 320, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    requestAnimationFrame(() => viewer.classList.remove('opening'));
  });
}

/** Closes the viewer; the photo goes back into its tile if the tile is on screen, otherwise it fades. */
function closeViewer() {
  const viewer = $('#viewer'), img = $('#vw-img'), p = vw.list[vw.i];
  const done = () => { viewer.hidden = true; viewer.classList.remove('opening', 'idle'); img.removeAttribute('src'); delete img.dataset.src; };
  if (viewer.hidden || calm() || !p) return done();
  const tileEl = $(`#grid .tile[data-id="${CSS.escape(p.id)}"]`), from = img.getBoundingClientRect();
  const to = tileEl && tileEl.getBoundingClientRect();
  const visible = to && to.bottom > 0 && to.top < innerHeight && from.width;
  viewer.classList.add('opening'); // the dark goes away, the bars hide
  const anim = visible
    ? img.animate([{ transform: 'none' }, { transform: `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + from.height / 2)}px) scale(${Math.max(to.width / from.width, to.height / from.height)})` }],
      { duration: 240, easing: 'cubic-bezier(.16, 1, .3, 1)' })
    : img.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 160, easing: 'ease' });
  anim.onfinish = done;
}

let vwToken = 0, vwIdle = 0;
/** The photo in the viewer: the grid's small copy at once, the sharp one as soon as it is decoded; the next and
 *  previous ones are fetched ahead, so moving through them never waits. */
function showPicture(p, dir) {
  const img = $('#vw-img'), token = ++vwToken;
  const full = abs(p.view || p.eco || p.thumb);
  if (img.dataset.src !== full) {
    img.dataset.src = full;
    img.src = abs(p.thumb);
    img.classList.add('soft');
    const sharp = new Image();
    sharp.src = full;
    sharp.decode().catch(() => {}).then(() => { if (token === vwToken) { img.src = full; img.classList.remove('soft'); } });
  }
  if (dir && !calm()) { img.classList.remove('m-next', 'm-prev'); void img.offsetWidth; img.classList.add(dir > 0 ? 'm-next' : 'm-prev'); }
  for (const k of [vw.i + 1, vw.i - 1]) { const q = vw.list[k]; if (q) new Image().src = abs(q.view || q.eco || q.thumb); }
}

/** The bars rest after 2 s without the mouse moving, and come back with it. */
function wakeViewer() {
  const v = $('#viewer');
  v.classList.remove('idle');
  clearTimeout(vwIdle);
  vwIdle = setTimeout(() => { if (!v.hidden) v.classList.add('idle'); }, 2000);
}
$('#viewer').addEventListener('pointermove', wakeViewer);

async function rate1(p, n) {
  const before = p.rating;
  p.rating = n; // the stars change at once; the server is told after
  vwRender();
  const tileEl = $(`#grid .tile[data-id="${CSS.escape(p.id)}"]`);
  if (tileEl) tileEl.replaceWith(tile(p, Number(tileEl.dataset.i)));
  if (!await guard(() => api('POST', `/api/albums/${S.code}/photos/bulk`, { action: 'rate', ids: [p.id], rating: n }))) { p.rating = before; vwRender(); reloadAlbum(); }
}

function vwRender(dir = 0) {
  const p = vw.list[vw.i];
  if (!p) return closeViewer();
  showPicture(p, dir);
  $('#vw-title').textContent = `${p.filename} · ${vw.i + 1} din ${vw.list.length}`;
  const hiddenNow = p.hidden || p.private;
  $('#vw-actions').replaceChildren(
    btn('ghost', hiddenNow ? 'eye' : 'eye-off', hiddenNow ? 'Arată' : 'Ascunde', () => viewerAct(() => bulk(hiddenNow ? 'show' : 'hide', {}, [p.id]), p.id)),
    btn('ghost', 'image', 'Copertă', () => coverDialog(p.id)),
    btn('ghost', 'edit', 'Editează', () => retouch([p])),
    btn('ghost', 'trash', 'Șterge', () => viewerDelete(p)),
    btn('ghost', 'x', 'Închide', closeViewer));
  const x = p.exif || {};
  const stars = el('span', { class: 'stars-pick', role: 'group', 'aria-label': 'Nota' }, [1, 2, 3, 4, 5].map(n => el('button', { type: 'button', class: n <= (p.rating || 0) ? 'on' : '',
    'aria-label': `${n} stele`, onclick: () => rate1(p, p.rating === n ? 0 : n) }, '★')));
  $('#vw-info').replaceChildren(stars, el('span', {}, [`${nf.format(p.width)} × ${nf.format(p.height)} px`, fmtBytes(p.bytes), x.focal, x.aperture, x.shutter, x.iso && `ISO ${x.iso}`,
    S.album.access_mode !== 'all' ? (p.indexed ? plural(p.faces, 'față', 'fețe') : 'se caută fețele') : null,
    hiddenNow ? 'ascunsă invitaților' : null, p.original ? null : 'copie comprimată'].filter(Boolean).join(' · ')));
  $('#vw-prev').hidden = vw.i === 0;
  $('#vw-next').hidden = vw.i === vw.list.length - 1;
}

/** An action in the viewer reloads the album; the viewer comes back on the same photo. */
async function viewerAct(fn, id) {
  const pending = fn(); // the change is on screen before the server answers
  const at = shown.findIndex(q => q.id === id);
  if (at >= 0 && $('#viewer').hidden) openViewer(shown, at);
  await pending;
}

async function viewerDelete(p) {
  // gone from the viewer and the grid at once, the next photo takes its place; "Anulează" for 15 s
  vw.list = vw.list.filter(q => q.id !== p.id);
  if (vw.list.length) { vw.i = Math.min(vw.i, vw.list.length - 1); vwRender(1); } else closeViewer();
  softDelete([p.id]);
}

$('#vw-prev').addEventListener('click', () => { if (vw.i > 0) { vw.i--; vwRender(-1); } });
$('#vw-next').addEventListener('click', () => { if (vw.i < vw.list.length - 1) { vw.i++; vwRender(1); } });
$('#viewer').addEventListener('click', e => { if (e.target.tagName === 'FIGURE' || e.target.id === 'viewer') closeViewer(); });
addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if ($('#dlg').open || typing) return;
  if (!$('#viewer').hidden) {
    const p = vw.list[vw.i];
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowLeft') { if (e.repeat) { if (vw.i > 0) { vw.i--; vwRender(); } } else $('#vw-prev').click(); wakeViewer(); }
    else if (e.key === 'ArrowRight') { if (e.repeat) { if (vw.i < vw.list.length - 1) { vw.i++; vwRender(); } } else $('#vw-next').click(); wakeViewer(); }
    else if (/^[0-5]$/.test(e.key) && p) rate1(p, Number(e.key));
    else if (e.key.toLowerCase() === 'h' && p) viewerAct(() => bulk(p.hidden || p.private ? 'show' : 'hide', {}, [p.id]), p.id);
    else if (e.key === 'Delete' && p) viewerDelete(p);
  } else if (S.tab === 'photos' && S.code && activeTab() && activeTab().kind === 'album') {
    if (e.key === 'Escape' && sel.size) { sel.clear(); renderPhotos(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && $('#grid')) { e.preventDefault(); shown.forEach(p => sel.set.add(p.id)); renderPhotos(); }
  }
});
