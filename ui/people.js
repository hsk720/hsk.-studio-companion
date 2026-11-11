'use strict';
// People: who the face search found, names, merging and moving faces, and the matches that need a look.

async function renderPeople() {
  const a = S.album, body = $('#tab-body'), code = S.code;
  if (a.access_mode === 'all') {
    return body.replaceChildren(el('div', { class: 'pad stack' },
      el('h2', {}, 'Albumul nu folosește recunoașterea facială'),
      el('p', { class: 'muted' }, 'Invitații văd toate pozele și nicio față nu e căutată. Poți schimba asta din Setări, după ce confirmi acordul persoanelor din poze.'),
      btn('secondary', 'sliders', 'Deschide Setări', () => openAlbum(S.code, 'settings'))));
  }
  body.replaceChildren(el('p', { class: 'muted pad' }, 'Se încarcă persoanele…'));
  const [org, rev] = await Promise.all([guard(() => api('GET', `/api/albums/${code}/organize`)), guard(() => api('GET', `/api/albums/${code}/review`))]);
  if (S.code !== code || S.tab !== 'people' || !org) return;
  S.people = org;
  const items = (rev && rev.items) || [];
  body.replaceChildren(...[
    el('div', { class: 'toolbar' },
      el('span', { class: 'muted' }, [plural(org.people.length, 'persoană', 'persoane'),
        org.others ? `${plural(org.others, 'poză', 'poze')} fără o persoană clară` : null,
        org.pending ? `${plural(org.pending, 'poză', 'poze')} în care se caută fețe` : null].filter(Boolean).join(' · ')),
      el('span', { class: 'grow' }),
      toggle('Albumul se arată invitaților pe persoane', null, org.organize, async (on, input) => {
        if (!await guard(() => api('PUT', `/api/albums/${code}/organize`, { organize: on }))) input.checked = !on;
      })),
    items.length ? reviewSection(items, org) : null,
    org.people.length ? el('div', { class: 'people' }, org.people.map(p => personCard(p)))
      : el('p', { class: 'empty' }, org.pending ? 'Fețele se caută în fundal. Revino în câteva minute.' : 'Nu am găsit încă nicio persoană. Încarcă poze în care se văd fețe.')].filter(Boolean));
}

function crop(src, cls = 'face') {
  const i = el('img', { class: cls, src: abs(src), alt: '', loading: 'lazy' });
  i.addEventListener('error', () => i.replaceWith(el('span', { class: `${cls} ph` })), { once: true });
  return i;
}

function personCard(p) {
  const first = p.faces && p.faces[0];
  return el('button', { type: 'button', class: 'person', onclick: () => personDialog(p.id) },
    first ? crop(first.crop, 'face big') : el('span', { class: 'face big ph' }),
    el('b', {}, p.name || p.label), el('small', {}, plural(p.photos, 'poză', 'poze')));
}

function reviewSection(items, org) {
  return el('section', { class: 'review' },
    el('h2', {}, `De verificat (${nf.format(items.length)})`),
    el('p', { class: 'muted' }, 'Fețe care nu s-au potrivit sigur. Spune cui aparțin, sau lasă-le unde sunt.'),
    el('div', { class: 'rev-list' }, items.slice(0, 12).map(it => el('div', { class: 'rev' },
      crop(it.crop, 'face big'),
      el('div', { class: 'rev-body' },
        el('p', {}, 'Seamănă cu:'),
        el('div', { class: 'row wrap' }, (it.candidates || []).slice(0, 4).map(c => el('button', { type: 'button', class: 'secondary small chip',
          onclick: () => moveFaces(it.faces, c.id) }, (c.crops && c.crops[0]) ? crop(c.crops[0], 'face tiny') : null, c.label))),
        el('div', { class: 'row wrap' },
          el('button', { type: 'button', class: 'quiet', onclick: () => moveFaces(it.faces, -1) }, 'Persoană nouă'),
          el('button', { type: 'button', class: 'quiet', onclick: () => moveFaces(it.faces, -2) }, 'Nu e o persoană'),
          el('button', { type: 'button', class: 'quiet', onclick: () => keepFaces(it.faces) }, 'E bine unde e')))))));
}

async function moveFaces(faces, to) {
  if (!await guard(() => api('POST', `/api/albums/${S.code}/persons/move`, { faces, to }))) return false;
  renderPeople();
  return true;
}
async function keepFaces(faces) {
  if (await guard(() => api('POST', `/api/albums/${S.code}/persons/keep`, { faces }))) renderPeople();
}

async function personDialog(id) {
  const org = S.people || await guard(() => api('GET', `/api/albums/${S.code}/organize`));
  const p = org && org.people.find(x => x.id === id);
  if (!p) return;
  const chosen = new Set();
  const name = el('input', { class: 'field', value: p.name || '', maxLength: 60, placeholder: p.label });
  const bar = el('div', { class: 'row wrap' });
  const drawBar = () => {
    const targets = [[0, 'Poze de grup'], [-1, 'Persoană nouă'], [-2, 'Nu e o persoană'], ...org.people.filter(x => x.id !== id).map(x => [x.id, x.name || x.label])];
    const to = el('select', { class: 'field slim' }, targets.map(([v, l]) => el('option', { value: v }, l)));
    bar.replaceChildren(el('span', { class: 'muted' }, chosen.size ? `${plural(chosen.size, 'față aleasă', 'fețe alese')}` : 'Alege fețele greșite ca să le muți.'),
      chosen.size ? [to,
        el('button', { type: 'button', class: 'secondary small', onclick: async () => { if (await moveFaces([...chosen], Number(to.value))) { $('#dlg').close(); S.people = null; } } }, 'Mută'),
        el('button', { type: 'button', class: 'secondary small', onclick: async () => {
          if (await guard(() => api('POST', `/api/albums/${S.code}/persons/hide`, { faces: [...chosen] }))) { $('#dlg').close(); S.people = null; renderPeople(); }
        } }, 'Ascunde')] : null);
  };
  drawBar();
  const grid = el('div', { class: 'faces' }, (p.faces || []).map(f => {
    const b = el('button', { type: 'button', class: 'face-pick', 'aria-label': 'Alege fața', onclick: () => {
      chosen.has(f.id) ? chosen.delete(f.id) : chosen.add(f.id);
      b.classList.toggle('on', chosen.has(f.id));
      drawBar();
    } }, crop(f.crop, 'face big'));
    return b;
  }));
  const done = await modal({ title: p.name || p.label, wide: true,
    body: el('div', { class: 'stack' },
      el('label', { class: 'lbl' }, 'Numele persoanei (îl văd invitații)'), name, bar, grid),
    actions: [{ label: 'Închide', value: false }, { label: 'Confirmă persoana', value: 'confirm' }, { label: 'Salvează numele', value: 'save', primary: true }] });
  S.people = null;
  if (done === 'save') await guard(() => api('PUT', `/api/albums/${S.code}/persons/${id}`, { name: name.value.trim() }));
  else if (done === 'confirm') await guard(() => api('POST', `/api/albums/${S.code}/persons/${id}/confirm`));
  if (done === 'save' || done === 'confirm') toast('Salvat.', 'success');
  if (S.tab === 'people') renderPeople();
}
