'use strict';
// The folder that fills an album by itself, the upload queue, the dock, the drop target, and the folders the app notices.

let lastQueue = { waiting: 0, sent: 0, failed: 0, items: [] };
const STATES = { waiting: 'în așteptare', preparing: 'se face copia pentru web', uploading: 'se încarcă', sent: 'încărcată', duplicate: 'era deja în album', failed: 'nu s-a încărcat' };

/** A few albums: one tap each. Many: a list. */
function albumPicker(value, onchange) {
  if (S.albums.length <= 4) return chips(S.albums.map(a => ({ value: a.code, label: a.name })), value || '', onchange, 'Album');
  const sel = el('select', { class: 'field', 'aria-label': 'Album', onchange: () => onchange(sel.value) },
    el('option', { value: '' }, 'Alege albumul'), S.albums.map(a => el('option', { value: a.code, selected: a.code === value }, a.name)));
  return sel;
}

async function renderWatch() {
  const stage = $('#stage');
  S.setup = await invoke('setup_get');
  S.prefs = await guard(() => invoke('prefs_get')) || S.prefs;
  drawNav();
  const s = S.setup;
  const f = { album: s.album || (S.albums.length === 1 ? S.albums[0].code : ''), folder: s.folder, existing: true };
  const folder = el('span', { class: `path-box inline${f.folder ? '' : ' muted'}` }, f.folder || 'Niciun folder ales');

  const watching = s.watching
    ? group('Folderul tău de export', 'Fiecare poză nouă din folder și din subfoldere ajunge singură în album.',
      el('p', { class: 'state' }, el('i', { class: 'dot busy' }), el('span', {}, `Urmăresc ${s.folder}`)),
      el('p', { class: 'muted' }, `Album: ${s.album_name || s.album}`),
      el('div', {}, btn('secondary small', 'pause', 'Oprește urmărirea', async () => { S.setup = await invoke('watch_stop'); renderWatch(); })))
    : group('Folderul tău de export', 'Exportă din Lightroom sau Capture One în acest folder; pozele ajung singure în album.',
      el('label', { class: 'lbl' }, 'Album'), albumPicker(f.album, v => { f.album = v; }),
      el('label', { class: 'lbl' }, 'Folder'),
      el('div', { class: 'row' }, folder, btn('secondary small', 'folder', 'Alege', async () => { const d = await invoke('folder_pick'); if (d) { f.folder = d; folder.textContent = d; folder.classList.remove('muted'); } })),
      toggle('Trimite și pozele care sunt deja în folder', null, true, v => { f.existing = v; }),
      el('div', {}, btn('primary', 'play', 'Pornește', async () => {
        const album = S.albums.find(a => a.code === f.album);
        if (!album) return toast('Alege albumul.', 'error');
        if (!f.folder) return toast('Alege folderul.', 'error');
        const r = await guard(() => invoke('watch_start', { folder: f.folder, album: album.code, albumName: album.name, mode: s.mode, includeExisting: f.existing }));
        if (r) { S.setup = r; renderWatch(); }
      })));

  const p = S.prefs || {};
  const redraw = () => renderWatch();
  const kv = (label, hint, ...kids) => el('div', { class: 'kv' }, el('span', { class: 'k' }, el('b', {}, label), hint ? el('small', { class: 'muted' }, hint) : null), el('span', { class: 'v' }, kids));
  const suggest = group('Propune albume noi', 'Pui exporturile fiecărui eveniment într-un folder-părinte; când apare un folder nou cu poze, aplicația te întreabă dacă faci album din el.',
    toggle('Propune albume din foldere noi', 'Doar folderele apărute după ce pornești opțiunea; cele vechi nu se ating.', p.inbox_enabled, async on => {
      if (on && !p.inbox_root) { const d = await invoke('folder_pick'); if (!d) return redraw(); await setPref({ inbox_enabled: true, inbox_root: d }); } else await setPref({ inbox_enabled: on });
      redraw();
    }),
    p.inbox_enabled ? [
      kv('Folderul-părinte', 'Subfolderurile lui sunt evenimentele tale.', el('span', { class: 'path-box inline' }, p.inbox_root || 'neales'),
        btn('quiet', null, 'Alege', async () => { const d = await invoke('folder_pick'); if (d) { await setPref({ inbox_root: d }); redraw(); } })),
      kv('Propune de la', 'Folderele cu mai puține poze sunt ignorate.', segmented([{ value: 5, label: '5 poze' }, { value: 10, label: '10 poze' }, { value: 30, label: '30 de poze' }], p.inbox_min, v => setPref({ inbox_min: Number(v) }), 'Propune de la'))] : null);

  stage.replaceChildren(el('div', { class: 'pad stack wide' }, el('h1', {}, 'Folder smart'), watching, suggest,
    group('Se încarcă acum', 'Pozele care pleacă spre albume: din folderul smart sau trase în fereastră.', el('div', { id: 'queue-box', class: 'stack' }))));
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
      q.failed ? el('div', {}, btn('secondary small', 'refresh', 'Încearcă din nou ce a eșuat', () => guard(() => invoke('queue_retry')))) : null,
      q.items.length ? el('ul', { class: 'queue' }, q.items.map(i => el('li', { class: i.state },
        el('span', {}, i.name), el('span', { class: i.verified ? 'ok' : '' }, i.verified ? [ico('check'), 'verificată cu serverul'] : (i.state === 'failed' ? i.detail : (i.detail || STATES[i.state])))))) : el('p', { class: 'muted' }, 'Exportă o poză în folder sau trage poze în fereastră, și apar aici.'));
  }
  const failed = q.items.find(i => i.state === 'failed');
  setAttention('queue', [
    ...(q.failed ? [{ id: `q:fail:${q.failed}`, level: 'warn', icon: 'alert', title: `${plural(q.failed, 'poză nu s-a trimis', 'poze nu s-au trimis')}`, text: failed && failed.detail ? failed.detail : 'Verifică internetul și încearcă din nou.',
      action: { label: 'Încearcă din nou', run: () => guard(() => invoke('queue_retry')) } }] : []),
    ...(S.prefs && S.prefs.paused ? [{ id: 'q:paused', level: 'info', icon: 'pause', title: 'Trimiterea e pe pauză', text: `${plural(q.waiting, 'poză așteaptă', 'poze așteaptă')} să fie încărcate.`,
      action: { label: 'Pornește', run: async () => { await setPref({ paused: false }); drawQueue(lastQueue); } } }] : [])]);
  drawDock(q);
}

// ---- the dock: what is being sent, wherever you are in the app ----
let dockHide = 0, retouchNote = '';
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
    retouchNote ? el('p', { class: 'muted' }, retouchNote) : null);
  if (!busy && !retouchNote) dock.hidden = true;
  if (!busy && retouchNote) dockHide = setTimeout(() => { retouchNote = ''; dock.hidden = true; }, 6000);
}

let wasBusy = false, refresh = 0;
listen('queue-changed', e => {
  const q = e.payload;
  drawQueue(q);
  if (wasBusy && q.waiting === 0) { // a batch is done: the album shows its new photos
    clearTimeout(refresh);
    refresh = setTimeout(() => { loadAlbums(); const t = activeTab(); if (t && t.kind === 'album' && S.tab === 'photos' && !sel.size && $('#viewer').hidden) reloadAlbum(); }, 1500);
  }
  wasBusy = q.waiting > 0;
});
listen('retouch-file', e => {
  const f = e.payload;
  retouchNote = f.state === 'sending' ? `Se trimite ${f.name}…` : f.state === 'done' ? `${f.name}: poza din album a fost înlocuită.` : `${f.name}: ${f.message}`;
  drawDock(lastQueue);
  if (f.state === 'failed') setAttention('retouch', [{ id: `rt:${f.name}`, level: 'warn', icon: 'alert', title: `Retușul „${f.name}” nu s-a trimis`, text: f.message, dismissible: true }]);
  if (f.state === 'done') { ATT.delete('retouch'); const t = activeTab(); if (t && t.kind === 'album' && S.tab === 'photos' && $('#viewer').hidden) reloadAlbum(); }
});
listen('export-progress', e => {
  const [done, total] = e.payload;
  retouchNote = done < total ? `Se descarcă originalele: ${nf.format(done)} din ${nf.format(total)}` : '';
  drawDock(lastQueue);
});

// ---- the folders the app notices ----
const foundFolders = new Map();
let inboxStarted = false, asking = false;

function startInbox() {
  if (!inboxStarted) { inboxStarted = true; listen('folder-detected', e => foundFolder(e.payload, false)); }
  guard(async () => { for (const f of await invoke('inbox_pending')) foundFolder(f, true); });
}

function foundFolder(f, quiet) {
  if (foundFolders.has(f.path) && quiet) return;
  foundFolders.set(f.path, f);
  syncInboxAttention();
  if (!quiet) askFolder(f);
}

function syncInboxAttention() {
  setAttention('inbox', [...foundFolders.values()].map(f => ({ id: `inbox:${f.path}`, level: 'warn', icon: 'folder-plus', title: `Folder nou: „${f.name}”`,
    text: `${plural(f.count, 'poză', 'poze')} într-un folder care nu e încă album.`, action: { label: 'Creează albumul', run: () => askFolder(f) }, dismissible: true })));
}

async function resolveFolder(f, done) {
  await guard(() => invoke('inbox_resolve', { path: f.path, done }));
  foundFolders.delete(f.path);
  syncInboxAttention();
}

/** Asks whether the folder is an event; "yes" opens the new-album form filled in, exactly as if the button had been pressed. */
async function askFolder(f) {
  if (asking || $('#dlg').open) return;
  asking = true;
  try {
    const r = await modal({ wide: true, title: 'Am găsit un folder nou',
      body: el('div', { class: 'stack' },
        el('p', {}, `„${f.name}” are ${plural(f.count, 'poză', 'poze')}. Faci un album din el?`),
        el('p', { class: 'path-box' }, f.path), el('p', { class: 'muted' }, 'Pozele se trimit imediat după ce albumul e creat.')),
      actions: [{ label: 'Nu mai întreba', value: 'never' }, { label: 'Nu acum', value: 'later' }, { label: 'Creează albumul', value: 'yes', primary: true }] });
    if (r === 'never') await resolveFolder(f, true);
    else if (r === 'yes') {
      asking = false;
      const made = await newAlbumDialog(f);
      if (made) await resolveFolder(f, true);
    }
  } finally { asking = false; }
}

// ---- drag and drop onto the window ----
if (T.webview && T.webview.getCurrentWebview) {
  T.webview.getCurrentWebview().onDragDropEvent(ev => {
    const drop = $('#drop'), p = ev.payload;
    if (p.type === 'over' || p.type === 'enter') {
      if ($('#app').hidden) return;
      const t = activeTab();
      $('#drop-to').textContent = t && t.kind === 'album' && S.album ? `în albumul „${S.album.name}”` : 'Deschide mai întâi un album';
      drop.hidden = false;
    } else if (p.type === 'drop') {
      drop.hidden = true;
      if (p.paths && p.paths.length) uploadPaths(p.paths);
    } else drop.hidden = true;
  });
}
