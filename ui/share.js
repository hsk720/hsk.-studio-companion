'use strict';
// Distribution and what comes back: link, code, PIN, the event kit, notes from guests, reports, favourites, ZIP.

function renderShare() {
  const a = S.album, body = $('#tab-body');
  const notes = a.notes || [], reports = (a.reports || []).filter(r => r.status === 'open');
  const row = (label, ...kids) => el('div', { class: 'kv' }, el('span', { class: 'k' }, label), el('span', { class: 'v' }, kids));
  body.replaceChildren(el('div', { class: 'pad stack wide' },
    el('section', { class: 'stack' },
      el('h2', {}, 'Link pentru invitați'),
      el('div', { class: 'row' }, el('p', { class: 'path-box grow', id: 'share-url' }, a.share_url),
        el('button', { class: 'primary small', type: 'button', onclick: () => copyText(a.share_url) }, 'Copiază')),
      el('div', { class: 'row wrap' },
        el('button', { class: 'secondary small', type: 'button', onclick: () => siteOpen(`/a/${a.code}`) }, 'Deschide pagina invitaților'),
        el('button', { class: 'secondary small', type: 'button', onclick: () => siteOpen(`/fotograf/${a.code}`) }, 'Cod QR și kit de eveniment, pe site')),
      row('PIN pentru album', a.prefs.pin ? el('b', {}, a.prefs.pin) : el('span', { class: 'muted' }, 'fără'),
        el('button', { class: 'quiet', type: 'button', onclick: () => editPref('pin', 'PIN pentru album', 'Invitații îl scriu înainte să vadă albumul. Lasă gol ca să-l scoți.') }, 'Schimbă')),
      row('Cod de descărcare', a.prefs.dl_code ? el('b', {}, a.prefs.dl_code) : el('span', { class: 'muted' }, 'fără, descarcă oricine'),
        el('button', { class: 'quiet', type: 'button', onclick: () => editPref('dl_code', 'Cod de descărcare', 'Invitații îl scriu înainte să descarce pozele. Lasă gol ca să-l scoți.') }, 'Schimbă'))),
    el('section', { class: 'stack' },
      el('h2', {}, `Notițe de la invitați${notes.length ? ` (${nf.format(notes.length)})` : ''}`),
      notes.length ? el('ul', { class: 'notes' }, notes.map(n => noteItem(n)))
        : el('p', { class: 'muted' }, a.prefs.guest_notes ? 'Nicio notiță încă. Invitații îți pot scrie de pe poză ce vor retușat.' : 'Notițele sunt oprite pentru acest album. Le pornești din Setări.'),
      el('button', { class: 'secondary small', type: 'button', onclick: addNote }, 'Adaugă o notiță pentru tine')),
    reports.length ? el('section', { class: 'stack' },
      el('h2', {}, `Sesizări deschise (${nf.format(reports.length)})`),
      el('ul', { class: 'notes' }, reports.map(r => el('li', {},
        r.thumb ? el('img', { class: 'face big', src: abs(r.thumb), alt: '' }) : null,
        el('div', { class: 'grow' }, el('b', {}, r.filename || 'Poză'), el('p', {}, r.reason_text || r.reason), r.details ? el('p', { class: 'muted' }, r.details) : null,
          el('small', { class: 'muted' }, [r.name, fmtDay(r.created_at)].filter(Boolean).join(' · '))),
        el('div', { class: 'row' },
          el('button', { class: 'secondary small', type: 'button', onclick: () => resolveReport(r.id, 'restore') }, 'Pune poza la loc'),
          el('button', { class: 'danger small', type: 'button', onclick: () => resolveReport(r.id, 'remove') }, 'Șterge poza')))))) : null,
    el('section', { class: 'stack' },
      el('h2', {}, 'Favorite și descărcări'),
      el('p', { class: 'muted' }, (a.favorites || []).length ? `${plural(a.favorites.length, 'listă de favorite', 'liste de favorite')} făcute de invitați.` : 'Invitații nu au făcut încă liste de favorite.'),
      el('button', { class: 'secondary small', type: 'button', onclick: exportAll }, 'Descarcă originalele pe calculator'))));
}

function noteItem(n) {
  const photo = n.photo_id && (S.album.photos || []).find(p => p.id === n.photo_id);
  return el('li', {},
    photo ? el('img', { class: 'face big', src: abs(photo.thumb), alt: '', onclick: () => { S.tab = 'photos'; renderAlbum(); openViewer([photo], 0); } }) : null,
    el('div', { class: `grow${n.done_at ? ' done' : ''}` }, el('p', {}, n.body),
      el('small', { class: 'muted' }, [n.author === 'photographer' ? 'Tu' : (n.name || 'Invitat'), fmtDay(n.at), n.done_at ? 'rezolvată' : null].filter(Boolean).join(' · '))),
    el('button', { class: 'quiet', type: 'button', onclick: () => noteDone(n) }, n.done_at ? 'Redeschide' : 'Rezolvat'),
    el('button', { class: 'quiet', type: 'button', onclick: () => delNote(n) }, 'Șterge'));
}

async function delNote(n) {
  if (await guard(() => api('DELETE', `/api/albums/${S.code}/manage/notes/${n.id}`))) reloadAlbum();
}

async function noteDone(n) {
  if (await guard(() => api('PATCH', `/api/albums/${S.code}/manage/notes/${n.id}`, { done: !n.done_at }))) reloadAlbum();
}

async function addNote() {
  const area = el('textarea', { class: 'field', rows: 4, maxLength: 1000, placeholder: 'Ce ți-a cerut mireasa la telefon…' });
  const ok = await modal({ title: 'Notiță pentru tine', body: area, actions: [{ label: 'Renunț', value: false }, { label: 'Salvează', value: 'ok', primary: true }] });
  if (ok === 'ok' && area.value.trim() && await guard(() => api('POST', `/api/albums/${S.code}/manage/notes`, { body: area.value.trim() }))) reloadAlbum();
}

async function resolveReport(id, action) {
  if (await guard(() => api('POST', `/api/albums/${S.code}/reports/${id}`, { action }))) reloadAlbum();
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
