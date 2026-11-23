'use strict';
// The first-run tour: a ring around one part of the window at a time, a short card beside it. Steps marked `click`
// wait for the photographer to try the thing themselves. Shown once (ui "tour"), always available in the palette.
const TOURS = {
  app: [
  { title: 'Bine ai venit în hsk. studio', text: 'Îți arăt în jumătate de minut unde e fiecare lucru. Poți ieși oricând cu Esc.' },
  { at: '#new-album', title: 'Albumul nou', text: 'Aici începi: alegi tipul evenimentului, iar dosarele (pregătiri, biserică, petrecere…) vin gata făcute. Merge și cu Ctrl+N.' },
  { at: '#nav', title: 'Panou și folder smart', text: 'Încearcă: apasă pe unul dintre ele. Folderul smart se golește singur în album, direct din Lightroom sau Capture One.', click: true },
  { at: '#nav [data-go="cull"]', title: 'Selecție', text: 'Alegi folderul cu cadrele de pe card, iar aplicația îți propune ce să arunci: cadre mișcate, ochi închiși, dubluri din rafale, expunere ratată. După câteva albume învață cum alegi tu și îți lasă doar cadrele la care nu e sigură.' },
  { at: '#albums', title: 'Albumele tale', text: 'Toate albumele, inclusiv cele la care colaborezi. Apeși pe unul și se deschide într-un tab nou, ca să lucrezi la mai multe odată.' },
  { at: '#palette-btn', title: 'Caută orice', text: 'Un album, o setare sau o acțiune: apeși Ctrl+K (⌘K pe Mac) și scrii câteva litere.' },
  { at: '#who', title: 'Contul tău', text: 'Profil, parolă, planul tău și deconectarea. E același cont ca pe hsk.photos.' },
  { title: 'Pozele ajung în album trăgându-le în fereastră', text: 'Tragi folderul sau pozele oriunde în aplicație și alegi albumul. Ai un album demo în stânga: deschide-l și încearcă tot. Tutorialul îl găsești oricând în căutare, la „Tutorial”.', final: true },
  ],
  // the first time a card is open in Selecție; the P/X step waits for the photographer to try it
  cull: [
    { at: '.loupe-main', title: 'Un cadru odată', text: 'Vezi cadrul mare. Claritatea, ochii și expunerea sunt deja măsurate, pe calculatorul tău.' },
    { at: '.loupe-side', title: 'De ce propune asta', text: 'Sus e propunerea, dedesubt măsurătorile. Bara mai închisă la culoare e motivul pentru care cadrul e propus pentru aruncat.' },
    { at: '.cull-keys', title: 'Încearcă', text: 'Apasă P ca să păstrezi cadrul sau X ca să-l arunci. Trece singur la următorul. Cu săgețile mergi înainte și înapoi.', click: true, keys: ['p', 'x'] },
    { at: '.strip', title: 'Tot cardul', text: 'Cadrele gri sunt cele aruncate. Apeși pe oricare ca să-l vezi mare și să te răzgândești.' },
    { at: '.cull-note', title: 'Învăț cum alegi', text: 'Fiecare album aplicat mă învață ce păstrezi tu. Când aleg ca tine pe două albume la rând, fac singur selecția și îți trimit doar cadrele la care nu sunt sigur.' },
    { at: '.cull-foot .primary', title: 'Aplică', text: 'Cadrele aruncate se mută în subfolderul „Respinse”, cu tot cu .xmp. Nu se șterge nimic, le poți muta înapoi oricând.', final: true },
  ],
};
const TOUR_DONE = { app: 'tour', cull: 'tourCull' };
const tour = { i: -1, ring: null, card: null, name: 'app' };
let TOUR = TOURS.app;

function tourStart(name) {
  if (tour.i >= 0 || $('#app').hidden || S.locked) return;
  tour.name = TOURS[name] ? name : 'app';
  TOUR = TOURS[tour.name];
  tour.ring = el('div', { class: 'tour-ring' });
  tour.card = el('div', { class: 'tour-card', role: 'dialog', 'aria-live': 'polite' });
  document.body.append(tour.ring, tour.card);
  document.addEventListener('keydown', tourKey, true);
  document.addEventListener('click', tourClick, true);
  addEventListener('resize', tourPlace);
  // a dialog from the app (a new folder found, say) goes first: the tour hides until it is closed
  tour.watch = new MutationObserver(() => document.body.classList.toggle('tour-paused', $('#dlg').open));
  tour.watch.observe($('#dlg'), { attributes: true, attributeFilter: ['open'] });
  tourGo(0);
}

function tourEnd(done = true) {
  if (tour.i < 0) return;
  const open = done && tour.name === 'app' && TOUR[tour.i]?.final && S.demo && !ui.get('hideDemo', false);
  tour.i = -1;
  tour.watch?.disconnect(); document.body.classList.remove('tour-paused');
  tour.ring?.remove(); tour.card?.remove();
  document.removeEventListener('keydown', tourKey, true);
  document.removeEventListener('click', tourClick, true);
  removeEventListener('resize', tourPlace);
  if (done) ui.set(TOUR_DONE[tour.name], 1);
  if (open) openAlbum(S.demo.code);
}

function tourGo(i) {
  if (i >= TOUR.length) return tourEnd();
  tour.i = Math.max(0, i);
  const s = TOUR[tour.i], last = tour.i === TOUR.length - 1;
  tour.card.classList.remove('in');
  tour.card.replaceChildren(
    el('p', { class: 'tour-n' }, `${tour.i + 1} din ${TOUR.length}`),
    el('h3', {}, s.title), el('p', {}, s.text),
    el('div', { class: 'tour-acts' },
      el('button', { class: 'quiet', type: 'button', onclick: () => tourEnd() }, last ? '' : 'Sari peste'),
      tour.i ? el('button', { class: 'secondary small', type: 'button', onclick: () => tourGo(tour.i - 1) }, 'Înapoi') : null,
      el('button', { class: 'primary small', type: 'button', onclick: () => tourGo(tour.i + 1) }, last ? (tour.name === 'app' && S.demo && !ui.get('hideDemo', false) ? 'Deschide albumul demo' : 'Gata') : s.click ? 'Continuă' : 'Mai departe')));
  tourPlace();
  requestAnimationFrame(() => tour.card.classList.add('in'));
}

function tourPlace() {
  if (tour.i < 0) return;
  const s = TOUR[tour.i], t = s.at && document.querySelector(s.at), card = tour.card, ring = tour.ring;
  const vw = innerWidth, vh = innerHeight;
  if (!t || !t.offsetParent) {
    ring.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0`;
    card.style.cssText = `left:${Math.max(16, (vw - card.offsetWidth) / 2)}px;top:${Math.max(16, (vh - card.offsetHeight) / 2)}px`;
    return;
  }
  const r = t.getBoundingClientRect(), pad = 6;
  ring.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
  const cw = card.offsetWidth || 320, ch = card.offsetHeight || 170;
  let x = r.right + 18, y = r.top;
  if (x + cw > vw - 16) { x = Math.max(16, Math.min(r.left, vw - cw - 16)); y = r.bottom + 18; }
  if (y + ch > vh - 16) y = Math.max(16, vh - ch - 16);
  card.style.cssText = `left:${x}px;top:${y}px`;
}

/** Whether a key may reach the page under the tour: always without a tour, on a "try it" step only its keys. */
function tourLetsKey(key) {
  if (tour.i < 0) return true;
  const s = TOUR[tour.i];
  return !!(s && s.keys && s.keys.includes(String(key).toLowerCase()));
}

function tourKey(e) {
  if ($('#dlg').open) return;
  if (tour.i >= 0 && tourLetsKey(e.key)) { setTimeout(() => tourGo(tour.i + 1), 250); return; }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tourEnd(); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); tourGo(tour.i + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); tourGo(tour.i - 1); }
}

function tourClick(e) {
  if (e.target.closest('.tour-card') || $('#dlg').open) return;
  const s = TOUR[tour.i], t = s.at && document.querySelector(s.at);
  if (s.click && t && t.contains(e.target)) { setTimeout(() => tourGo(tour.i + 1), 250); return; }
  e.preventDefault(); e.stopPropagation(); // the rest of the window waits until the tour is over
}

function tourMaybe() {
  if (ui.get('tour', 0) || ui.get('hideTour', false)) return;
  setTimeout(() => (typeof intro !== 'undefined' && !intro.done) || $('#dlg').open || document.hidden ? tourMaybe() : tourStart(), 1200);
}

/** The Selecție tour, once, after the first card is measured. */
function tourCullMaybe() {
  if (ui.get('tourCull', 0) || ui.get('hideTour', false) || tour.i >= 0) return;
  setTimeout(() => (S.active === 'cull' && CULL.frames.length && !$('#dlg').open ? tourStart('cull') : null), 700);
}
