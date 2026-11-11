'use strict';
// The local catalog: names and camera data of the files on the photographer's disks, searchable while the disks are unplugged.

let catalogState = { roots: [], busy: null };

async function renderCatalog() {
  const stage = $('#stage');
  catalogState.roots = await guard(() => invoke('catalog_roots')) || [];
  const results = el('div', { id: 'cat-results', class: 'stack' });
  const search = el('input', { class: 'field', type: 'search', placeholder: 'Nume de fișier, dată (2025-06), aparat sau obiectiv', 'aria-label': 'Caută în catalog', autocomplete: 'off',
    oninput: later(() => runSearch(search.value, results), 350) });
  const rootRow = r => el('div', { class: 'kv' },
    el('span', { class: 'k' }, el('b', {}, r.label), el('small', { class: 'muted' }, `${plural(r.files, 'fișier', 'fișiere')} · actualizat ${fmtDay(r.updated)} · ${r.path}`)),
    el('span', { class: 'v' }, el('span', { class: `badge-n ${r.online ? '' : 'off'}` }, r.online ? 'conectat' : 'deconectat'),
      btn('quiet', null, 'Actualizează', () => rescan(r), { disabled: !r.online }), btn('quiet', null, 'Scoate din catalog', () => removeRoot(r))));
  stage.replaceChildren(el('div', { class: 'pad stack wide' },
    el('div', {}, el('h1', {}, 'Catalog'), el('p', { class: 'muted' }, 'Unde se află fiecare fișier, chiar și când discul nu e conectat. Pe disc rămân fișierele tale; aici se ține doar o listă cu nume și date.')),
    group('Caută', null, search, results),
    group('Discuri și foldere indexate', 'Adaugă hard-diskurile externe și folderele cu arhiva. Poți scoate oricând un loc din catalog, fișierele nu se ating.',
      catalogState.roots.length ? catalogState.roots.map(rootRow) : el('p', { class: 'muted' }, 'Niciun loc adăugat încă.'),
      el('div', { id: 'cat-progress', class: 'muted' }),
      el('div', {}, btn('secondary small', 'folder-plus', 'Adaugă un disc sau un folder', addRoot)))));
  if (search.value || catalogState.roots.length) runSearch('', results);
}

async function runSearch(q, box) {
  const r = await guard(() => invoke('catalog_search', { query: q.trim(), limit: 200 }));
  if (!r) return;
  box.replaceChildren(r.hits.length
    ? el('div', {}, el('p', { class: 'muted' }, `${plural(r.total, 'fișier găsit', 'fișiere găsite')}${r.total > r.hits.length ? `, primele ${r.hits.length}` : ''}`),
      el('ul', { class: 'queue cat-list' }, r.hits.map(h => el('li', {}, el('span', {}, h.name), el('span', {}, [h.taken, h.camera, h.root + (h.online ? '' : ' (deconectat)'), h.folder].filter(Boolean).join(' · '))))))
    : el('p', { class: 'muted' }, catalogState.roots.length ? 'Nimic găsit. Încearcă o parte din nume sau o dată.' : 'Adaugă mai întâi un disc sau un folder mai jos.'));
}

async function addRoot() {
  const path = await invoke('folder_pick');
  if (!path) return;
  const label = await promptBox('Cum se numește acest loc?', 'Numele discului sau al arhivei', path.split(/[\\/]/).filter(Boolean).pop() || 'Disc', 'Adaugă');
  if (!label) return;
  await guard(() => invoke('catalog_add', { path, label }));
  renderCatalog();
}
async function rescan(r) { await guard(() => invoke('catalog_rescan', { id: r.id })); renderCatalog(); }
async function removeRoot(r) {
  if (!await confirmBox(`Scoți „${r.label}” din catalog?`, 'Se șterge doar lista din aplicație. Fișierele de pe disc rămân neatinse.', 'Scoate')) return;
  await guard(() => invoke('catalog_remove', { id: r.id }));
  renderCatalog();
}

listen('catalog-progress', e => { const b = $('#cat-progress'); if (b) b.textContent = e.payload.done ? '' : `Se indexează „${e.payload.label}”: ${nf.format(e.payload.files)} fișiere…`; });
