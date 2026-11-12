'use strict';
// An album's settings, in groups: look, who finds the photos, what guests can do, the album itself.

const SUB_ICONS = [['', 'Fără'], ['pin', 'Loc'], ['school', 'Școală'], ['graduation', 'Absolvire'], ['church', 'Biserică'], ['rings', 'Nuntă'], ['party', 'Petrecere'], ['building', 'Firmă'], ['camera', 'Foto'], ['heart', 'Inimă']];

/** Text is saved once the typing stops; switches and choices are saved at once. */
function later(fn, ms = 900) { let t; const run = () => { clearTimeout(t); fn(); }; const wrapped = () => { clearTimeout(t); t = setTimeout(fn, ms); }; wrapped.now = run; return wrapped; }

function renderSettings() {
  const a = S.album, body = $('#tab-body');
  if (!a || !body) return;
  const f = { name: a.name, sub: a.subtitle || '', icon: a.subtitle_icon || '', mode: a.access_mode === 'all' ? 'all' : 'both',
    recog: !!(a.declaration && a.declaration.recognition), minors: !!a.minors, parents: !!(a.declaration && a.declaration.parents) };
  const saveTitle = later(async () => {
    if (!f.name.trim()) return;
    if (await guard(() => api('PUT', `/api/albums/${S.code}/title`, { name: f.name.trim(), subtitle: f.sub.trim(), subtitle_icon: f.icon }))) {
      Object.assign(a, { name: f.name.trim(), subtitle: f.sub.trim(), subtitle_icon: f.icon });
      drawAlbumHead(); loadAlbums();
    }
  });
  const saveAccess = async () => {
    const r = await guard(() => api('PUT', `/api/albums/${S.code}/settings`, { access_mode: f.mode, minors: f.mode !== 'all' && f.minors,
      declare_photos: true, declare_recognition: f.recog, declare_parents: f.parents }));
    if (r) Object.assign(a, { access_mode: f.mode, minors: f.mode !== 'all' && f.minors });
  };
  const name = el('input', { class: 'field', value: f.name, maxLength: 80, oninput: () => { f.name = name.value; saveTitle(); }, onblur: () => saveTitle.now() });
  const sub = el('input', { class: 'field', value: f.sub, maxLength: 90, placeholder: 'Școala, locul sau sala', oninput: () => { f.sub = sub.value; saveTitle(); }, onblur: () => saveTitle.now() });
  const iconPick = el('div', { class: 'icon-pick', role: 'radiogroup', 'aria-label': 'Iconița de lângă rând' }, SUB_ICONS.map(([v, label]) => el('button', { type: 'button', role: 'radio', title: label,
    class: `ic${f.icon === v ? ' on' : ''}`, 'aria-checked': String(f.icon === v), 'aria-label': label,
    onclick: e => { f.icon = v; $$('.ic', iconPick).forEach(b => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); }); e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-checked', 'true'); saveTitle.now(); } },
  v ? ico(v) : el('span', {}, '–'))));

  const parentsRow = toggle('Am acordul scris al părinților', null, f.parents, v => { f.parents = v; saveAccess(); });
  parentsRow.hidden = !f.minors;
  const faceBox = el('div', { class: 'stack wide-stack', hidden: f.mode === 'all' },
    toggle('Am acordul explicit al persoanelor din poze', 'Recunoașterea facială îl cere.', f.recog, v => { f.recog = v; saveAccess(); }),
    toggle('În album sunt și minori', null, f.minors, v => { f.minors = v; parentsRow.hidden = !v; saveAccess(); }), parentsRow);

  const pref = (key, label, hint) => toggle(label, hint, a.prefs[key], async (on, input) => {
    if (await guard(() => api('PUT', `/api/albums/${S.code}/prefs`, { [key]: on }))) a.prefs[key] = on; else input.checked = !on;
  });
  const q = a.quota;
  const coverLine = (label, id, extra) => el('div', { class: 'kv' }, el('span', { class: 'k' }, el('b', {}, label), el('small', { class: 'muted' }, extra)),
    el('span', { class: 'v' }, id ? el('img', { class: 'mini-cover', src: abs((a.photos || []).find(p => p.id === id)?.thumb || a.cover), alt: '' }) : el('span', { class: 'muted' }, 'aceeași')));

  body.replaceChildren(el('div', { class: 'pad stack wide' },
    group('Nume și copertă', 'Ce văd invitații în capul albumului. Se salvează singur.',
      el('label', { class: 'lbl' }, 'Numele albumului'), name,
      el('label', { class: 'lbl' }, 'Rândul de sub nume'), sub,
      el('label', { class: 'lbl' }, 'Iconița de lângă rând'), iconPick,
      coverLine('Copertă pe calculator', a.cover_id, 'Se alege din Poze: selectezi o poză și apeși „Copertă”.'),
      coverLine('Copertă pe telefon', a.cover_mobile_id, 'Dacă nu are una proprie, folosește coperta de pe calculator.'),
      el('div', {}, btn('secondary small', 'image', 'Alege coperta', () => coverPicker()))),
    group('Cum își găsesc invitații pozele', 'Recunoașterea facială cere acordul persoanelor din poze.',
      segmented([{ value: 'all', icon: 'image', label: 'Tot albumul', hint: 'Fără recunoaștere facială' }, { value: 'both', icon: 'scan', label: 'Cu selfie și fețe', hint: 'Recunoaștere facială' }], f.mode,
        v => { f.mode = v; faceBox.hidden = v === 'all'; saveAccess(); }, 'Cum își găsesc invitații pozele'),
      faceBox),
    group('Ce pot face invitații', 'Se aplică imediat.',
      pref('guest_notes', 'Notițe pe poze', 'Pot scrie ce vor retușat; le vezi în Distribuire.'),
      pref('face_list', 'Lista de fețe', 'Își aleg fața dintr-o listă, fără selfie.'),
      pref('favorites', 'Favorite', 'Își fac o listă cu pozele preferate.'),
      el('div', { class: 'kv' }, el('span', { class: 'k' }, el('b', {}, 'Ordinea pozelor'), el('small', { class: 'muted' }, 'În albumul invitaților.')),
        segmented([{ value: 'upload', label: 'Încărcare' }, { value: 'taken', label: 'Ora pozei' }, { value: 'name', label: 'Nume' }], a.prefs.sort_mode, async v => {
          if (await guard(() => api('PUT', `/api/albums/${S.code}/prefs`, { sort_mode: v }))) a.prefs.sort_mode = v;
        }, 'Ordinea pozelor'))),
    group('Albumul', null,
      el('p', { class: 'muted' }, [`Cod ${a.code}`, `creat pe ${fmtDay(a.created_at)}`, `expiră pe ${fmtDay(a.expires_at)}`, q && q.limit ? `spațiu: ${fmtBytes(q.used)} din ${fmtBytes(q.limit)}` : null].filter(Boolean).join(' · ')),
      el('div', { class: 'row wrap' },
        btn('secondary small', 'external', 'Panoul albumului, pe site', () => siteOpen(`/fotograf/${a.code}`), { title: 'Domeniu propriu, brand, abonament și facturi se schimbă acolo' }))),
    a.demo ? null : el('section', { class: 'group danger-zone' }, el('div', { class: 'group-head' }, el('h2', {}, 'Ștergerea albumului'), el('p', { class: 'muted' }, 'Șterge albumul, pozele și datele faciale de pe server. Nu se poate anula.')),
      el('div', { class: 'group-body' }, el('div', {}, btn('danger small', 'trash', 'Șterge albumul', deleteAlbum))))));
}

/** Pick the cover photo from the whole album, then frame it. */
async function coverPicker() {
  const photos = S.album.photos || [];
  if (!photos.length) return toast('Încarcă mai întâi câteva poze.', 'error');
  const grid = el('div', { class: 'picker' }, photos.slice(0, 300).map(p => el('button', { type: 'button', class: 'tile', title: p.filename, onclick: () => closeModal(p.id) }, el('img', { src: abs(p.thumb), alt: p.filename, loading: 'lazy' }))));
  const id = await modal({ title: 'Alege poza pentru copertă', body: grid, wide: true, actions: [{ label: 'Renunț', value: undefined }] });
  if (id) coverDialog(id);
}

async function deleteAlbum() {
  const a = S.album, id = `album:${S.code}`;
  const typed = await promptBox(`Ștergi „${a.name}”?`, `Scrie numele albumului ca să confirmi: ${a.name}`, '', 'Șterge albumul');
  if (typed === null) return;
  if (typed !== a.name) return toast('Numele nu se potrivește. Albumul nu a fost șters.', 'error');
  if (!await guard(() => api('DELETE', `/api/albums/${S.code}`))) return;
  toast('Albumul a fost șters.', 'success');
  closeTab(id);
  await loadAlbums();
  refreshAttention();
}
