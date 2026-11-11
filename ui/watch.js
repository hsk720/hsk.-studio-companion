'use strict';
// The folder that fills an album by itself, the upload queue, the drop target and the dock.

let lastQueue = { waiting: 0, sent: 0, failed: 0, items: [] };
const STATES = { waiting: 'în așteptare', preparing: 'se pregătește', uploading: 'se trimite', sent: 'trimisă', duplicate: 'era deja în album', failed: 'nereușită' };

function watchDot() { $('#watch-dot').hidden = !(S.setup && S.setup.watching); }

async function renderWatch() {
  const pane = $('#v-watch');
  S.setup = await invoke('setup_get');
  watchDot();
  const s = S.setup;
  const albumSel = el('select', { class: 'field' },
    el('option', { value: '' }, 'Alege albumul'),
    S.albums.map(a => el('option', { value: a.code, selected: a.code === s.album }, a.name)));
  const folder = el('p', { class: `path-box grow${s.folder ? '' : ' muted'}` }, s.folder || 'Niciun folder ales');
  const mode = el('select', { class: 'field slim' },
    el('option', { value: 'original', selected: s.mode === 'original' }, 'Originalul, la rezoluție completă'),
    el('option', { value: 'webp', selected: s.mode === 'webp' }, 'WebP 2560 px, făcut pe calculator'));
  const existing = el('input', { type: 'checkbox', checked: true });
  let chosen = s.folder;
  const head = el('div', { class: 'stack' },
    el('h1', {}, 'Folder urmărit'),
    el('p', { class: 'muted' }, 'Fiecare poză nouă din folder (și din subfoldere) ajunge singură în album. Folosește-l ca folder de export în Lightroom sau Capture One.'));
  if (s.watching) {
    head.append(el('p', { class: 'state' }, el('i', { class: 'dot busy' }), `Urmăresc ${s.folder}`),
      el('p', { class: 'muted' }, `Album: ${s.album_name || s.album}`),
      el('div', {}, el('button', { class: 'secondary', type: 'button', onclick: async () => { S.setup = await invoke('watch_stop'); renderWatch(); } }, 'Oprește')));
  } else {
    head.append(el('label', { class: 'lbl' }, 'Album'), albumSel,
      el('label', { class: 'lbl' }, 'Folder'),
      el('div', { class: 'row' }, folder, el('button', { class: 'secondary small', type: 'button', onclick: async () => {
        const f = await invoke('folder_pick');
        if (f) { chosen = f; folder.textContent = f; folder.classList.remove('muted'); }
      } }, 'Alege')),
      el('label', { class: 'lbl' }, 'Ce se trimite'), mode,
      el('label', { class: 'check' }, existing, el('span', {}, 'Trimite și pozele care sunt deja în folder')),
      el('div', {}, el('button', { class: 'primary', type: 'button', onclick: async () => {
        const album = S.albums.find(a => a.code === albumSel.value);
        if (!album) return toast('Alege albumul.', 'error');
        if (!chosen) return toast('Alege folderul.', 'error');
        const r = await guard(() => invoke('watch_start', { folder: chosen, album: album.code, albumName: album.name, mode: mode.value, includeExisting: existing.checked }));
        if (r) { S.setup = r; renderWatch(); }
      } }, 'Pornește')));
  }
  pane.replaceChildren(el('div', { class: 'pad stack wide' }, head, el('div', { id: 'queue-box', class: 'stack' })));
  drawQueue(await invoke('queue_get'));
}

function drawQueue(q) {
  lastQueue = q;
  const box = $('#queue-box');
  if (box) {
    box.replaceChildren(
      el('dl', { class: 'counts' },
        el('div', {}, el('dt', {}, 'Trimise'), el('dd', {}, nf.format(q.sent))),
        el('div', {}, el('dt', {}, 'În așteptare'), el('dd', {}, nf.format(q.waiting))),
        el('div', {}, el('dt', {}, 'Nereușite'), el('dd', {}, nf.format(q.failed)))),
      q.failed ? el('button', { class: 'quiet', type: 'button', onclick: () => guard(() => invoke('queue_retry')) }, 'Încearcă din nou ce a eșuat') : null,
      q.items.length ? el('ul', { class: 'queue' }, q.items.map(i => el('li', { class: i.state },
        el('span', {}, i.name), el('span', {}, i.state === 'failed' ? i.detail : (i.detail || STATES[i.state]))))) : el('p', { class: 'muted' }, 'Exportă o poză în folder sau trage poze în fereastră, și apar aici.'));
  }
  drawDock(q);
}

// ---- the dock: what is being sent, wherever you are in the app ----
let dockHide = 0;
function drawDock(q) {
  const dock = $('#dock');
  clearTimeout(dockHide);
  const busy = q.waiting > 0;
  if (!busy && !q.failed && !retouchNote) { dock.hidden = true; return; }
  dock.hidden = false;
  const total = q.waiting + q.sent + q.failed;
  dock.replaceChildren(
    busy ? el('div', {}, el('b', {}, `Se trimit ${plural(q.waiting, 'poză', 'poze')}`),
      el('div', { class: 'bar' }, el('i', { style: `width:${total ? Math.round(((q.sent + q.failed) / total) * 100) : 0}%` })),
      el('small', { class: 'muted' }, `${nf.format(q.sent)} trimise`)) : null,
    !busy && q.failed ? el('div', {}, el('b', {}, `${plural(q.failed, 'poză nu a putut', 'poze nu au putut')} fi trimisă`),
      el('button', { class: 'quiet', type: 'button', onclick: () => { show('watch'); renderWatch(); } }, 'Vezi detaliile')) : null,
    retouchNote ? el('p', { class: 'muted' }, retouchNote) : null);
  if (!busy && !q.failed) dockHide = setTimeout(() => { retouchNote = ''; $('#dock').hidden = true; }, 6000);
}

let retouchNote = '';
let wasBusy = false, refresh = 0;
listen('queue-changed', e => {
  const q = e.payload;
  drawQueue(q);
  if (wasBusy && q.waiting === 0) { // a batch is done: the album shows its new photos
    clearTimeout(refresh);
    refresh = setTimeout(() => { loadAlbums(); if (S.view === 'album' && S.tab === 'photos' && !sel.size && $('#viewer').hidden) reloadAlbum(); }, 1500);
  }
  wasBusy = q.waiting > 0;
});
listen('retouch-file', e => {
  const f = e.payload;
  retouchNote = f.state === 'sending' ? `Se trimite ${f.name}…` : f.state === 'done' ? `${f.name}: poza din album a fost înlocuită.` : `${f.name}: ${f.message}`;
  drawDock(lastQueue);
  if (f.state === 'done' && S.view === 'album' && S.tab === 'photos' && $('#viewer').hidden) reloadAlbum();
});
listen('export-progress', e => {
  const [done, total] = e.payload;
  retouchNote = done < total ? `Se descarcă originalele: ${nf.format(done)} din ${nf.format(total)}` : '';
  drawDock(lastQueue);
});

// ---- drag and drop onto the window ----
if (T.webview && T.webview.getCurrentWebview) {
  T.webview.getCurrentWebview().onDragDropEvent(ev => {
    const drop = $('#drop'), p = ev.payload;
    if (p.type === 'over' || p.type === 'enter') {
      if ($('#app').hidden) return;
      $('#drop-to').textContent = S.view === 'album' && S.album ? `în albumul „${S.album.name}”` : 'Deschide mai întâi un album';
      drop.hidden = false;
    } else if (p.type === 'drop') {
      drop.hidden = true;
      if (p.paths && p.paths.length) uploadPaths(p.paths);
    } else drop.hidden = true;
  });
}
