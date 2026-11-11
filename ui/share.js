'use strict';
// Distribution and what comes back: link, PIN and codes, notes from guests, reports, favourites, the originals.

function renderShare() {
  const a = S.album, body = $('#tab-body');
  if (!a || !body) return;
  const notes = a.notes || [], reports = (a.reports || []).filter(r => r.status === 'open');
  const row = (label, hint, value, action) => el('div', { class: 'kv' },
    el('span', { class: 'k' }, el('b', {}, label), el('small', { class: 'muted' }, hint)), el('span', { class: 'v' }, value, action));
  body.replaceChildren(el('div', { class: 'pad stack wide' },
    group('Link pentru invitați', 'Îl trimiți pe WhatsApp sau îl pui pe cartonașe. Butonul din capul paginii îl copiază.',
      el('p', { class: 'path-box' }, a.share_url),
      el('div', { class: 'row wrap' }, btn('secondary small', 'external', 'Pagina invitaților', () => siteOpen(`/a/${a.code}`)))),
    kitGroup(a),
    group('Acces', 'Cine poate vedea și descărca.',
      row('PIN pentru album', 'Invitații îl scriu înainte să vadă albumul.', a.prefs.pin ? el('b', {}, a.prefs.pin) : el('span', { class: 'muted' }, 'fără'),
        btn('quiet', null, a.prefs.pin ? 'Schimbă' : 'Pune unul', () => editPref('pin', 'PIN pentru album', 'Invitații îl scriu înainte să vadă albumul. Lasă gol ca să-l scoți.'))),
      row('Cod de descărcare', 'Cerut înainte de descărcarea pozelor.', a.prefs.dl_code ? el('b', {}, a.prefs.dl_code) : el('span', { class: 'muted' }, 'fără, descarcă oricine'),
        btn('quiet', null, a.prefs.dl_code ? 'Schimbă' : 'Pune unul', () => editPref('dl_code', 'Cod de descărcare', 'Invitații îl scriu înainte să descarce pozele. Lasă gol ca să-l scoți.')))),
    group(`Notițe de la invitați${notes.length ? ` (${nf.format(notes.length)})` : ''}`, a.prefs.guest_notes ? 'Ce vor invitații retușat sau scos.' : 'Notițele sunt oprite; le pornești din Setări.',
      notes.length ? el('ul', { class: 'notes' }, notes.map(n => noteItem(n))) : el('p', { class: 'muted' }, 'Nicio notiță încă.'),
      el('div', {}, btn('secondary small', 'plus', 'Notiță pentru tine', addNote))),
    reports.length ? group(`Cereri de ascundere sau ștergere (${nf.format(reports.length)})`, 'Cineva a cerut ca o poză să fie ascunsă sau ștearsă.',
      el('ul', { class: 'notes' }, reports.map(r => el('li', {},
        r.thumb ? el('img', { class: 'face big', src: abs(r.thumb), alt: '' }) : null,
        el('div', { class: 'grow' }, el('b', {}, r.filename || 'Poză'), el('p', {}, r.reason_text || r.reason), r.details ? el('p', { class: 'muted' }, r.details) : null,
          el('small', { class: 'muted' }, [r.name, fmtDay(r.created_at)].filter(Boolean).join(' · '))),
        el('div', { class: 'row' },
          btn('secondary small', 'check', 'Pune poza la loc', () => resolveReport(r.id, 'restore')),
          btn('danger small', 'trash', 'Șterge poza', () => resolveReport(r.id, 'remove'))))))) : null,
    selectionGroup(a),
    messageGroup(a),
    group('Proiecție în sală', 'Pozele noi apar pe ecran pe măsură ce le pui în album, cu codul QR în colț. Mută fereastra pe proiector sau pe televizor.',
      el('div', {}, btn('secondary small', 'expand', 'Pornește proiecția', () => startLive())))));
}

/** Table cards, poster or stickers: the server makes the PDF, the window shows the page and hands it over for printing. */
const kitState = { fmt: 'cards', event: 'de la eveniment', sub: '', last: null };
const KIT_FORMATS = [{ value: 'cards', label: 'Cartonașe de masă', hint: 'A6, 4 pe foaie A4' }, { value: 'poster', label: 'Afiș', hint: 'A4, la intrare sau la bar' }, { value: 'stickers', label: 'Abțibilduri', hint: 'rotunde, 6 cm, 12 pe A4' }];
const KIT_EVENTS = [['de la nuntă', 'Nuntă'], ['de la botez', 'Botez'], ['de la banchet', 'Banchet'], ['de la absolvire', 'Absolvire'], ['de la petrecere', 'Petrecere'], ['de la eveniment', 'Alt eveniment']];

function kitGroup(a) {
  if (!kitState.sub || kitState.code !== a.code) { kitState.sub = [a.name, fmtDay(a.event_date)].filter(Boolean).join(' · ').slice(0, 70); kitState.code = a.code; kitState.last = null; }
  const shot = el('img', { class: 'kit-shot', alt: 'Cum arată foaia', hidden: true });
  const wait = el('p', { class: 'muted' }, 'Se pregătește foaia…');
  let seq = 0;
  const make = async () => {
    const mine = ++seq;
    wait.hidden = false;
    const r = await guard(() => api('POST', `/api/albums/${a.code}/kit`, { fmt: kitState.fmt, event: kitState.event, sub: kitState.sub }));
    if (mine !== seq || !r) return;
    kitState.last = r;
    shot.src = `data:image/jpeg;base64,${r.preview}`; shot.hidden = false; wait.hidden = true;
  };
  const later1 = later(make, 600);
  const sub = el('input', { class: 'field', value: kitState.sub, maxLength: 70, placeholder: 'ex. Ana și Mihai · 14 iunie', 'aria-label': 'Rândul de sub titlu', oninput: () => { kitState.sub = sub.value; later1(); } });
  const hand = async open => {
    if (!kitState.last) return;
    const path = await guard(() => invoke('save_file', { name: kitState.last.filename, data: kitState.last.pdf, open }));
    if (path && !open) { toast('PDF-ul e salvat în Descărcări.', 'success'); invoke('reveal', { path }).catch(() => {}); }
  };
  make();
  return group('Cartonașe, afiș și abțibilduri', 'PDF gata de tipărit, cu QR-ul și PIN-ul albumului, pe logo-ul sau numele studioului tău. La eveniment se fac poze: foaia îi anunță pe invitați.',
    segmented(KIT_FORMATS, kitState.fmt, v => { kitState.fmt = v; make(); }, 'Ce tipărești'),
    el('label', { class: 'lbl' }, 'Evenimentul'), chips(KIT_EVENTS.map(([value, label]) => ({ value, label })), kitState.event, v => { kitState.event = v; make(); }, 'Evenimentul'),
    el('label', { class: 'lbl' }, 'Rândul de sub titlu'), sub,
    el('div', { class: 'kit-wrap' }, wait, shot),
    el('div', { class: 'row wrap' }, btn('primary small', 'external', 'Deschide PDF-ul pentru tipărire', () => hand(true)), btn('secondary small', 'download', 'Salvează PDF-ul', () => hand(false))));
}

const stemOf = f => String(f).replace(/\.[^.]+$/, '');

/** What the clients picked for the printed album, as a search for Lightroom and as marks next to the files on disk. */
function selectionGroup(a) {
  const lists = a.favorites || [];
  const row = l => {
    const stems = l.photos.map(p => stemOf(p.filename));
    return el('div', { class: 'kv' },
      el('span', { class: 'k' }, el('b', {}, l.name || 'Listă fără nume'), el('small', { class: 'muted' }, `${plural(stems.length, 'poză', 'poze')} · ${fmtDay(l.updated_at)}`)),
      el('span', { class: 'v wrap' },
        btn('secondary small', 'copy', 'Copiază pentru Lightroom', async () => { await copyText(stems.join(' ')); toast('Copiat. În Lightroom: Filtru bibliotecă › Text › Nume fișier › „Conține oricare”, apoi lipește.', 'success'); }),
        btn('secondary small', 'star', 'Marchează în folder', () => markInFolder(stems))));
  };
  return group('Selecția clienților', lists.length ? 'Pozele alese de clienți în albumul lor. Le găsești în Lightroom fără să cauți numerele una câte una.' : 'Când clienții își fac o listă de favorite, o găsești aici, gata de dat mai departe în Lightroom.',
    lists.length ? lists.map(row) : el('p', { class: 'muted' }, 'Nicio listă încă.'),
    lists.length ? el('p', { class: 'muted' }, '„Marchează în folder” pune 5 stele și eticheta verde într-un fișier .xmp lângă fiecare fișier RAW din folderul tău (CR3, NEF, ARW…). Lightroom le citește când deschizi folderul sau alegi „Citește metadatele din fișier”. JPEG-urile nu se marchează.') : null,
    el('div', {}, btn('secondary small', 'download', 'Descarcă originalele pe calculator', exportAll)));
}

async function markInFolder(stems) {
  let folder = S.setup && S.setup.folder;
  if (!folder) { folder = await invoke('folder_pick'); if (!folder) return; }
  const r = await guard(() => invoke('xmp_mark', { folder, names: stems, rating: 5, label: 'Green' }));
  if (!r) return;
  toast(r.marked ? `${plural(r.marked, 'poză marcată', 'poze marcate')} în folder${r.missing ? `; ${plural(r.missing, 'nu a fost găsită', 'nu au fost găsite')}` : ''}.` : 'Nu am găsit niciuna dintre poze în folderul ales.', r.marked ? 'success' : 'error');
}

const DEFAULT_MESSAGE = 'Bună! Pozele de la {album} sunt aici: {link}\n{pin}Te cauți cu un selfie sau îți alegi fața din listă. Spor la căutat!';
function clientMessage(a, template) {
  return template.replaceAll('{album}', a.name).replaceAll('{link}', a.share_url).replaceAll('{pin}', a.prefs.pin ? `Codul albumului: ${a.prefs.pin}\n` : '').trim();
}

/** The text for WhatsApp, with the link and the PIN filled in. The wording is the photographer's own and is kept. */
function messageGroup(a) {
  const area = el('textarea', { class: 'field', rows: 4, maxLength: 600, 'aria-label': 'Mesajul pentru client', value: ui.get('client-msg', DEFAULT_MESSAGE),
    oninput: () => { ui.set('client-msg', area.value); preview.textContent = clientMessage(a, area.value); } });
  const preview = el('p', { class: 'path-box wrap-text' }, clientMessage(a, area.value));
  return group('Mesaj pentru client', 'Se salvează singur. {album}, {link} și {pin} se completează pentru fiecare album.',
    area, preview,
    el('div', {}, btn('primary small', 'copy', 'Copiază mesajul', async () => { await copyText(clientMessage(a, area.value)); toast('Mesajul e copiat. Lipește-l în WhatsApp.', 'success'); })));
}

function noteItem(n) {
  const photo = n.photo_id && (S.album.photos || []).find(p => p.id === n.photo_id);
  return el('li', {},
    photo ? el('img', { class: 'face big', src: abs(photo.thumb), alt: '', onclick: () => { openAlbum(S.code, 'photos'); openViewer([photo], 0); } }) : null,
    el('div', { class: `grow${n.done_at ? ' done' : ''}` }, el('p', {}, n.body),
      el('small', { class: 'muted' }, [n.author === 'photographer' ? 'Tu' : (n.name || 'Invitat'), fmtDay(n.at), n.done_at ? 'rezolvată' : null].filter(Boolean).join(' · '))),
    btn('quiet', null, n.done_at ? 'Redeschide' : 'Rezolvat', () => noteDone(n)),
    btn('quiet', null, 'Șterge', () => delNote(n)));
}

async function delNote(n) {
  if (await guard(() => api('DELETE', `/api/albums/${S.code}/manage/notes/${n.id}`))) { await reloadAlbum(); refreshAttention(); }
}
async function noteDone(n) {
  if (await guard(() => api('PATCH', `/api/albums/${S.code}/manage/notes/${n.id}`, { done: !n.done_at }))) { await reloadAlbum(); refreshAttention(); }
}

async function addNote() {
  const area = el('textarea', { class: 'field', rows: 4, maxLength: 1000, placeholder: 'Ce ți-a cerut mireasa la telefon…' });
  const ok = await modal({ title: 'Notiță pentru tine', body: area, actions: [{ label: 'Renunț', value: false }, { label: 'Salvează', value: 'ok', primary: true }] });
  if (ok === 'ok' && area.value.trim() && await guard(() => api('POST', `/api/albums/${S.code}/manage/notes`, { body: area.value.trim() }))) reloadAlbum();
}

async function resolveReport(id, action) {
  if (await guard(() => api('POST', `/api/albums/${S.code}/reports/${id}`, { action }))) { await reloadAlbum(); refreshAttention(); }
}

async function editPref(key, title, hint) {
  const v = await promptBox(title, hint, S.album.prefs[key] || '');
  if (v === null) return;
  if (await guard(() => api('PUT', `/api/albums/${S.code}/prefs`, { [key]: v }))) reloadAlbum();
}

/** All the originals, under their own names, into a folder in Documents. */
async function exportAll() {
  const photos = (S.album.photos || []).map(p => ({ id: p.id, filename: p.filename }));
  if (!photos.length) return toast('Albumul nu are poze.', 'error');
  if (!await confirmBox('Descarci originalele?', `${plural(photos.length, 'poză', 'poze')}, în folderul Documente / hsk. studio. Poate dura, în funcție de internet.`, 'Descarcă')) return;
  const info = await guard(() => invoke('export_originals', { album: S.code, albumName: S.album.name, photos }));
  if (info) {
    toast(info.failed ? `Gata, dar ${plural(info.failed, 'poză nu a putut', 'poze nu au putut')} fi descărcate.` : 'Originalele sunt pe calculator.', info.failed ? 'error' : 'success');
    guard(() => invoke('reveal', { path: info.folder }));
  }
}
