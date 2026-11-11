'use strict';
// An album's settings, and the app's own.

function renderSettings() {
  const a = S.album, body = $('#tab-body');
  const name = el('input', { class: 'field', value: a.name, maxLength: 80 });
  const sub = el('input', { class: 'field', value: a.subtitle || '', maxLength: 90, placeholder: 'Școala, locul sau sala' });
  const mode = el('select', { class: 'field' },
    el('option', { value: 'all', selected: a.access_mode === 'all' }, 'Tot albumul, fără recunoaștere facială'),
    el('option', { value: 'both', selected: a.access_mode !== 'all' }, 'Cu selfie și listă de fețe'));
  const minors = el('input', { type: 'checkbox', checked: a.minors });
  const recog = el('input', { type: 'checkbox', checked: !!(a.declaration && a.declaration.recognition) });
  const parents = el('input', { type: 'checkbox', checked: !!(a.declaration && a.declaration.parents) });
  const faceOpts = el('div', { class: 'stack', hidden: a.access_mode === 'all' },
    el('label', { class: 'check' }, recog, el('span', {}, 'Am acordul explicit al persoanelor din poze pentru recunoașterea facială.')),
    el('label', { class: 'check' }, minors, el('span', {}, 'În album sunt și minori.')),
    el('label', { class: 'check', hidden: !a.minors }, parents, el('span', {}, 'Am acordul scris al părinților.')));
  mode.addEventListener('change', () => { faceOpts.hidden = mode.value === 'all'; });
  minors.addEventListener('change', () => { parents.closest('label').hidden = !minors.checked; });

  const toggle = (key, label, hint) => el('label', { class: 'check wide-row' },
    el('input', { type: 'checkbox', checked: a.prefs[key], onchange: async e => {
      if (await guard(() => api('PUT', `/api/albums/${S.code}/prefs`, { [key]: e.target.checked }))) a.prefs[key] = e.target.checked;
      else e.target.checked = !e.target.checked;
    } }), el('span', {}, el('b', {}, label), el('small', { class: 'muted' }, hint)));
  const sort = el('select', { class: 'field slim', onchange: async e => {
    if (await guard(() => api('PUT', `/api/albums/${S.code}/prefs`, { sort_mode: e.target.value }))) a.prefs.sort_mode = e.target.value;
  } }, [['upload', 'Ordinea încărcării'], ['taken', 'Ora fotografierii'], ['name', 'Numele fișierului']].map(([v, l]) => el('option', { value: v, selected: a.prefs.sort_mode === v }, l)));
  const q = a.quota;

  body.replaceChildren(el('div', { class: 'pad stack wide' },
    el('section', { class: 'stack' }, el('h2', {}, 'Nume'),
      el('label', { class: 'lbl' }, 'Numele albumului'), name, el('label', { class: 'lbl' }, 'Rândul de sub nume'), sub,
      el('div', {}, el('button', { class: 'primary small', type: 'button', onclick: async () => {
        if (!name.value.trim()) return toast('Albumul are nevoie de un nume.', 'error');
        if (await guard(() => api('PUT', `/api/albums/${S.code}/title`, { name: name.value.trim(), subtitle: sub.value.trim(), subtitle_icon: a.subtitle_icon || '' }))) { toast('Salvat.', 'success'); await loadAlbums(); reloadAlbum(); }
      } }, 'Salvează')),
      el('p', { class: 'muted' }, 'Coperta se alege din tab-ul Poze: selectezi o poză și apeși „Pune pe copertă”.')),
    el('section', { class: 'stack' }, el('h2', {}, 'Cum își găsesc invitații pozele'), mode, faceOpts,
      el('div', {}, el('button', { class: 'primary small', type: 'button', onclick: async () => {
        const r = await guard(() => api('PUT', `/api/albums/${S.code}/settings`, { access_mode: mode.value, minors: mode.value !== 'all' && minors.checked,
          declare_photos: true, declare_recognition: recog.checked, declare_parents: parents.checked }));
        if (r) { toast('Salvat.', 'success'); reloadAlbum(); }
      } }, 'Salvează'))),
    el('section', { class: 'stack' }, el('h2', {}, 'Ce pot face invitații'),
      toggle('guest_notes', 'Notițe pe poze', 'Pot scrie ce vor retușat; le vezi în Distribuire.'),
      toggle('face_list', 'Lista de fețe', 'Își aleg fața dintr-o listă, fără selfie.'),
      toggle('favorites', 'Favorite', 'Își fac o listă cu pozele preferate.'),
      el('div', { class: 'row' }, el('span', {}, 'Ordinea pozelor:'), sort)),
    el('section', { class: 'stack' }, el('h2', {}, 'Albumul'),
      el('p', { class: 'muted' }, [`Cod: ${a.code}`, `creat pe ${fmtDay(a.created_at)}`, `expiră pe ${fmtDay(a.expires_at)}`,
        q && q.limit ? `spațiu: ${fmtBytes(q.used)} din ${fmtBytes(q.limit)}` : null].filter(Boolean).join(' · ')),
      el('p', { class: 'muted' }, 'Domeniu propriu, brand, abonament și facturi se schimbă pe hsk.photos.'),
      el('div', {}, el('button', { class: 'secondary small', type: 'button', onclick: () => siteOpen(`/fotograf/${a.code}`) }, 'Deschide panoul de pe site'))),
    el('section', { class: 'stack danger-zone' }, el('h2', {}, 'Ștergerea albumului'),
      el('p', { class: 'muted' }, 'Șterge albumul, pozele și datele faciale de pe server. Nu se poate anula.'),
      el('div', {}, el('button', { class: 'danger small', type: 'button', onclick: deleteAlbum }, 'Șterge albumul')))));
}

async function deleteAlbum() {
  const a = S.album;
  const typed = await promptBox(`Ștergi „${a.name}”?`, `Scrie numele albumului ca să confirmi: ${a.name}`, '', 'Șterge albumul');
  if (typed === null) return;
  if (typed !== a.name) return toast('Numele nu se potrivește. Albumul nu a fost șters.', 'error');
  if (!await guard(() => api('DELETE', `/api/albums/${S.code}`))) return;
  toast('Albumul a fost șters.', 'success');
  S.code = S.album = null;
  try { localStorage.removeItem('hsk.last'); } catch { /* storage blocked */ }
  await loadAlbums();
  show('empty');
}

// ---- the app's own settings ----
async function renderPrefs() {
  const pane = $('#v-prefs');
  const prefs = await guard(() => invoke('prefs_get'));
  if (!prefs) return;
  const set = async (patch) => {
    const next = await guard(() => invoke('prefs_set', { autostart: prefs.autostart, notifications: prefs.notifications, ...patch }));
    if (next) Object.assign(prefs, next);
    renderPrefs();
  };
  pane.replaceChildren(el('div', { class: 'pad stack wide' },
    el('h1', {}, 'Setările aplicației'),
    el('p', { class: 'muted' }, S.account ? `${S.account.name} · plan ${S.account.plan}` : ''),
    el('label', { class: 'check wide-row' }, el('input', { type: 'checkbox', checked: prefs.autostart, onchange: e => set({ autostart: e.target.checked }) }),
      el('span', {}, el('b', {}, 'Pornește odată cu calculatorul'), el('small', { class: 'muted' }, 'Aplicația stă în bara de meniu sau lângă ceas și continuă să urmărească folderul, chiar cu fereastra închisă.'))),
    el('label', { class: 'check wide-row' }, el('input', { type: 'checkbox', checked: prefs.notifications, onchange: e => set({ notifications: e.target.checked }) }),
      el('span', {}, el('b', {}, 'Notificări'), el('small', { class: 'muted' }, 'Te anunță când vine o notiță sau o sesizare și când se termină analiza fețelor.'))),
    el('p', { class: 'muted' }, `Dimensiunea maximă a unei poze: ${S.me ? S.me.max_photo_mb : 60} MB.`),
    el('div', {}, el('button', { class: 'secondary small', type: 'button', onclick: () => siteOpen('/fotograf') }, 'Deschide hsk.photos'))));
}
