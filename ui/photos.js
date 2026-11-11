'use strict';
// The photos of an album: grid, selection, the actions on a selection, the viewer, upload and retouch.

const sel = {
  set: new Set(), last: null,
  clear() { this.set.clear(); this.last = null; },
  get size() { return this.set.size; },
};
let photoFilter = 'all';
let shown = []; // the photos the grid shows now, in order

const FILTERS = {
  all: ['Toate', () => true],
  faces: ['Cu fețe', p => p.faces > 0],
  noface: ['Fără fețe', p => !p.faces && p.indexed],
  hidden: ['Ascunse', p => p.hidden || p.private],
};

function renderPhotos() {
  const a = S.album, body = $('#tab-body');
  const recog = a.access_mode !== 'all';
  const filters = Object.entries(FILTERS).filter(([k]) => recog || (k !== 'faces' && k !== 'noface'));
  if (!filters.some(([k]) => k === photoFilter)) photoFilter = 'all';
  shown = (a.photos || []).filter(FILTERS[photoFilter][1]);
  const modeSel = el('select', { class: 'field slim', 'aria-label': 'Ce se trimite', onchange: e => { S.setup.mode = e.target.value; } },
    el('option', { value: 'original', selected: S.setup.mode === 'original' }, 'Originalul'),
    el('option', { value: 'webp', selected: S.setup.mode === 'webp' }, 'WebP 2560 px'));
  const toolbar = el('div', { class: 'toolbar' },
    el('button', { class: 'primary small', type: 'button', onclick: () => pickUpload(false) }, 'Încarcă poze'),
    el('button', { class: 'secondary small', type: 'button', onclick: () => pickUpload(true) }, 'Încarcă un folder'),
    modeSel,
    el('span', { class: 'grow' }),
    el('select', { class: 'field slim', 'aria-label': 'Filtru', onchange: e => { photoFilter = e.target.value; sel.clear(); renderPhotos(); } },
      filters.map(([k, [label]]) => el('option', { value: k, selected: k === photoFilter }, label))),
    el('span', { class: 'muted count' }, plural(shown.length, 'poză', 'poze')));
  const grid = el('div', { class: 'grid', id: 'grid' }, shown.map((p, i) => tile(p, i)));
  const empty = !shown.length
    ? el('p', { class: 'empty' }, (a.photos || []).length ? 'Nicio poză în această categorie.' : 'Albumul e gol. Trage aici pozele sau un folder, ori folosește butoanele de mai sus.')
    : null;
  body.replaceChildren(...[toolbar, empty, grid, el('div', { class: 'selbar', id: 'selbar', hidden: true })].filter(Boolean));
  grid.addEventListener('click', onGridClick);
  drawSelection();
}

function tile(p, i) {
  return el('button', { type: 'button', class: `tile${sel.set.has(p.id) ? ' on' : ''}`, dataset: { i, id: p.id }, 'aria-label': p.filename },
    el('img', { src: abs(p.thumb), alt: '', loading: 'lazy', decoding: 'async' }),
    el('span', { class: 'chk', 'aria-hidden': 'true' }),
    p.hidden || p.private ? el('span', { class: 'badge' }, 'Ascunsă') : null,
    !p.indexed ? el('span', { class: 'badge soft' }, 'se analizează') : null);
}

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
  openViewer(shown, i);
}

function selectedPhotos() { return (S.album.photos || []).filter(p => sel.set.has(p.id)); }

function drawSelection() {
  const bar = $('#selbar');
  if (!bar) return;
  bar.hidden = sel.size === 0;
  if (!sel.size) return;
  const chosen = selectedPhotos();
  const allHidden = chosen.every(p => p.hidden || p.private);
  bar.replaceChildren(
    el('b', {}, `${plural(sel.size, 'selectată', 'selectate')}`),
    el('button', { class: 'quiet', type: 'button', onclick: () => { shown.forEach(p => sel.set.add(p.id)); renderPhotos(); } }, 'Selectează tot'),
    el('span', { class: 'grow' }),
    S.album.access_mode !== 'all' ? el('button', { class: 'secondary small', type: 'button', onclick: moveDialog }, 'Mută în…') : null,
    el('button', { class: 'secondary small', type: 'button', onclick: rateDialog }, 'Notă'),
    el('button', { class: 'secondary small', type: 'button', onclick: () => bulk(allHidden ? 'show' : 'hide') }, allHidden ? 'Arată invitaților' : 'Ascunde'),
    sel.size === 1 ? el('button', { class: 'secondary small', type: 'button', onclick: () => setCover(chosen[0].id) }, 'Pune pe copertă') : null,
    el('button', { class: 'secondary small', type: 'button', onclick: () => retouch(chosen) }, 'Retușează'),
    el('button', { class: 'danger small', type: 'button', onclick: removeSelected }, 'Șterge'),
    el('button', { class: 'quiet', type: 'button', onclick: () => { sel.clear(); renderPhotos(); } }, 'Anulează'));
}

// ---- actions on a selection ----
async function bulk(action, extra = {}, ids = [...sel.set]) {
  for (let i = 0; i < ids.length; i += 300) {
    const done = await guard(() => api('POST', `/api/albums/${S.code}/photos/bulk`, { action, ids: ids.slice(i, i + 300), ...extra }));
    if (!done) return false;
  }
  sel.clear();
  await reloadAlbum();
  return true;
}

async function removeSelected() {
  const n = sel.size;
  if (!await confirmBox(`Ștergi ${plural(n, 'poză', 'poze')}?`, 'Pozele dispar din album și de pe serverul hsk.photos. Nu se pot recupera.', 'Șterge', true)) return;
  if (await bulk('delete')) toast(`${plural(n, 'poză ștearsă', 'poze șterse')}.`, 'success');
}

async function rateDialog() {
  const n = await modal({ title: 'Notă pentru pozele selectate', body: el('p', { class: 'muted' }, 'Nota o vezi doar tu, nu invitații.'),
    actions: [{ label: 'Fără notă', value: 0 }, ...[1, 2, 3, 4, 5].map(v => ({ label: '★'.repeat(v), value: v })), { label: 'Renunț', value: undefined }] });
  if (n !== undefined) bulk('rate', { rating: n });
}

async function moveDialog() {
  const org = await guard(() => api('GET', `/api/albums/${S.code}/organize`));
  const opts = [['big', 'Poze de grup mari'], ['small', 'Poze de grup mici'], ['hide', 'Ascunde de invitați'],
    ...((org && org.people) || []).map(p => [`p${p.id}`, p.name || p.label])];
  const to = await modal({ title: `Mută ${plural(sel.size, 'poză', 'poze')} în`, wide: true,
    body: el('div', { class: 'options' }, opts.map(([v, label]) => el('button', { type: 'button', class: 'secondary', onclick: () => $('#dlg').close(JSON.stringify({ v })) }, label))),
    actions: [{ label: 'Renunț', value: undefined }] });
  if (!to) return;
  const ids = [...sel.set];
  for (let i = 0; i < ids.length; i += 300) {
    if (!await guard(() => api('POST', `/api/albums/${S.code}/photos/sort`, { photos: ids.slice(i, i + 300), to }))) return;
  }
  sel.clear();
  toast('Pozele au fost mutate.', 'success');
  reloadAlbum();
}

async function setCover(id) {
  if (!await guard(() => api('PUT', `/api/albums/${S.code}/cover`, { photo_id: id, target: 'desktop' }))) return;
  toast('Coperta a fost schimbată.', 'success');
  reloadAlbum();
}

// ---- upload ----
async function pickUpload(folder) {
  const paths = folder ? [await invoke('folder_pick')].filter(Boolean) : await invoke('files_pick');
  if (paths.length) uploadPaths(paths);
}

async function uploadPaths(paths) {
  if (!S.code || S.view !== 'album') return toast('Deschide mai întâi albumul în care vrei pozele.', 'error');
  const n = await guard(() => invoke('upload_paths', { album: S.code, paths, mode: S.setup.mode }));
  if (n === 0) toast('Nu am găsit poze (JPG sau PNG) în ce ai ales.', 'error');
  else if (n) toast(`${plural(n, 'poză pusă', 'poze puse')} la trimis.`, 'success');
}

// ---- retouch: Lightroom, Capture One, Photoshop ----
async function retouch(photos) {
  const info = await guard(() => invoke('retouch_start', { album: S.code, albumName: S.album.name,
    photos: photos.map(p => ({ id: p.id, filename: p.filename })) }));
  if (!info) return;
  const go = await modal({ title: 'Pozele sunt gata de retușat', wide: true,
    body: el('div', { class: 'stack' },
      el('p', {}, `Am pus ${plural(photos.length, 'originalul', 'originalele')} în folderul de mai jos.`),
      el('p', { class: 'path-box' }, info.folder),
      el('p', { class: 'muted' }, 'Deschide-le în Lightroom, Capture One sau Photoshop și salvează peste același fișier, cu același nume. Fiecare salvare înlocuiește poza din album, în același loc și cu același link. Cât timp aplicația rulează, urmărește folderul.')),
    actions: [{ label: 'Închide', value: false }, { label: 'Arată folderul', value: 'open', primary: true }] });
  if (go === 'open') guard(() => invoke('reveal', { path: info.folder }));
  sel.clear();
  renderPhotos();
}

// ---- viewer ----
const vw = { list: [], i: 0 };

function openViewer(list, i) {
  vw.list = list; vw.i = i;
  $('#viewer').hidden = false;
  vwRender();
}
function closeViewer() { $('#viewer').hidden = true; $('#vw-img').removeAttribute('src'); }

function vwRender() {
  const p = vw.list[vw.i];
  if (!p) return closeViewer();
  $('#vw-img').src = abs(p.view || p.eco || p.thumb);
  $('#vw-title').textContent = `${p.filename} · ${vw.i + 1} din ${vw.list.length}`;
  const hiddenNow = p.hidden || p.private;
  $('#vw-actions').replaceChildren(
    el('button', { class: 'ghost', type: 'button', onclick: () => viewerAct(() => bulk(hiddenNow ? 'show' : 'hide', {}, [p.id]), p.id) }, hiddenNow ? 'Arată invitaților' : 'Ascunde'),
    el('button', { class: 'ghost', type: 'button', onclick: () => viewerAct(() => setCover(p.id), p.id) }, 'Pune pe copertă'),
    el('button', { class: 'ghost', type: 'button', onclick: () => retouch([p]) }, 'Retușează'),
    el('button', { class: 'ghost', type: 'button', onclick: () => viewerDelete(p) }, 'Șterge'),
    el('button', { class: 'ghost', type: 'button', onclick: closeViewer }, 'Închide'));
  $('#vw-info').textContent = [`${nf.format(p.width)} × ${nf.format(p.height)} px`, fmtBytes(p.bytes),
    S.album.access_mode !== 'all' ? (p.indexed ? plural(p.faces, 'față', 'fețe') : 'se caută fețele') : null,
    hiddenNow ? 'ascunsă invitaților' : null, p.original ? null : 'copie comprimată'].filter(Boolean).join(' · ');
  $('#vw-prev').hidden = vw.i === 0;
  $('#vw-next').hidden = vw.i === vw.list.length - 1;
}

/** An action in the viewer reloads the album; the viewer comes back on the same photo. */
async function viewerAct(fn, id) {
  await fn();
  const at = shown.findIndex(q => q.id === id);
  if (at >= 0) openViewer(shown, at);
}

async function viewerDelete(p) {
  if (!await confirmBox('Ștergi poza?', `${p.filename} dispare din album și de pe server. Nu se poate recupera.`, 'Șterge', true)) return;
  if (!await guard(() => api('DELETE', `/api/albums/${S.code}/photos/${p.id}`))) return;
  const at = Math.min(vw.i, vw.list.length - 2);
  await reloadAlbum();
  if (at >= 0 && shown.length) openViewer(shown, Math.min(at, shown.length - 1)); else closeViewer();
}

$('#vw-prev').addEventListener('click', () => { vw.i = Math.max(0, vw.i - 1); vwRender(); });
$('#vw-next').addEventListener('click', () => { vw.i = Math.min(vw.list.length - 1, vw.i + 1); vwRender(); });
$('#viewer').addEventListener('click', e => { if (e.target.tagName === 'FIGURE' || e.target.id === 'viewer') closeViewer(); });
addEventListener('keydown', e => {
  if ($('#viewer').hidden || $('#dlg').open) return;
  if (e.key === 'Escape') closeViewer();
  else if (e.key === 'ArrowLeft') $('#vw-prev').click();
  else if (e.key === 'ArrowRight') $('#vw-next').click();
});
