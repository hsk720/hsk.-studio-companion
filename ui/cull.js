'use strict';
// Selecție (culling): the app looks at a folder of fresh frames on this computer and suggests what to drop —
// blurred frames, closed eyes, burnt or black frames and the extra frames of a burst (the best one stays).
// It only suggests. The photographer flips any frame with one key; nothing changes on disk until "Aplică",
// and then the dropped frames are only moved into a "Respinse" subfolder. The pictures never leave the computer.

const CULL = { folder: null, frames: [], flip: new Map(), busy: null, at: 0, style: null, all: false, views: new Map() };

// Learning the photographer's style: for the first albums they decide every frame, the app guesses in silence
// and compares. Once its guesses match theirs on two albums in a row (90%), it decides alone and only the frames
// it is unsure about (35% to 65%) come to them. Every applied album keeps teaching it. All of it stays on this
// computer (cull_style_get / cull_style_set): a small logistic model over the measurements below.
const CULL_UNSURE = [0.35, 0.65];
const STYLE = { target: 10, minAlbums: 5, agreeAuto: 0.9, keep: 4000 };
const cullAuto = () => !!(CULL.style && CULL.style.auto);

const REASONS = {
  blur: { label: 'Mișcate', one: 'mișcată' },
  eyes: { label: 'Ochi închiși', one: 'ochi închiși' },
  light: { label: 'Expunere', one: 'arsă sau prea întunecată' },
  dup: { label: 'Dubluri din rafale', one: 'dublură din rafală' },
};

// ---- the model ----
const sigmoid = z => 1 / (1 + Math.exp(-z));
/** What the model sees of a frame. */
function cullFeatures(f) {
  const blink = f.blink != null ? f.blink : f.eyes_closed ? 1 : 0;
  const burst = f.burst != null;
  return [1, f.sharp, blink, f.clip, burst ? 1 : 0, burst && f.best ? 1 : 0, f.faces ? 1 : 0, f.sharp * f.sharp];
}
const cullPredict = (w, x) => sigmoid(w.reduce((s, wi, i) => s + wi * x[i], 0));

/** Plain gradient descent with the two answers weighted equally (most of a card is kept). */
function cullTrain(data, w0) {
  const n = data.length, d = data[0][0].length;
  if (!n) return w0;
  const pos = data.filter(r => r[1]).length, neg = n - pos;
  if (!pos || !neg) return w0;
  const cw = [n / (2 * neg), n / (2 * pos)];
  let w = w0 && w0.length === d ? [...w0] : new Array(d).fill(0);
  for (let it = 0; it < 400; it++) {
    const g = new Array(d).fill(0);
    for (const [x, y] of data) {
      const e = (cullPredict(w, x) - y) * cw[y];
      for (let i = 0; i < d; i++) g[i] += e * x[i];
    }
    w = w.map((wi, i) => wi - 0.8 * (g[i] / n + (i ? 0.002 * wi : 0)));
  }
  return w.map(v => Math.round(v * 1e4) / 1e4);
}

/** The stored style turned into what the page shows. */
function cullStyleView(s) {
  s = s && typeof s === 'object' ? s : {};
  const agree = Array.isArray(s.agree) ? s.agree : [];
  const last2 = agree.slice(-2);
  const auto = !!s.w && (s.albums || 0) >= STYLE.minAlbums && last2.length === 2 && last2.every(a => a >= STYLE.agreeAuto);
  return { raw: s, albums: s.albums || 0, target: STYLE.target, agree: agree.length ? agree[agree.length - 1] : null, auto, w: s.w || null };
}

/** After "Aplică": how close the model was on this card, then it learns from it. */
async function cullLearn() {
  const s = { ...(CULL.style ? CULL.style.raw : {}) };
  const rows = CULL.frames.map(f => [cullFeatures(f), f.keep ? 1 : 0]);
  let agree = null;
  if (s.w) agree = Math.round(rows.filter(([x, y]) => (cullPredict(s.w, x) >= 0.5 ? 1 : 0) === y).length / rows.length * 100) / 100;
  s.data = [...(s.data || []), ...rows].slice(-STYLE.keep);
  s.w = cullTrain(s.data, s.w);
  s.albums = (s.albums || 0) + 1;
  if (agree != null) s.agree = [...(s.agree || []), agree].slice(-20);
  s.updated = Math.floor(Date.now() / 1000);
  await invoke('cull_style_set', { style: s }).catch(() => null);
  CULL.style = cullStyleView(s);
  return agree;
}

// ---- the verdict: reasons from the measurements, the best frame of each burst stays ----
function cullJudge() {
  const fs = CULL.frames;
  for (const f of fs) {
    f.why = [];
    if (f.sharp < 0.35) f.why.push('blur');
    if (f.eyes_closed) f.why.push('eyes');
    if (f.clip > 0.25) f.why.push('light');
    f.score = f.sharp + (f.eyes_closed ? -0.5 : 0) - f.clip;
  }
  const bursts = new Map();
  fs.forEach(f => { if (f.burst != null) (bursts.get(f.burst) || bursts.set(f.burst, []).get(f.burst)).push(f); });
  for (const list of bursts.values()) {
    const best = list.reduce((a, b) => (b.score > a.score ? b : a));
    list.forEach(f => { f.best = f === best; if (f !== best && !f.why.length) f.why.push('dup'); });
  }
  const w = CULL.style && CULL.style.w;
  for (const f of fs) {
    if (cullAuto()) {
      f.p = f.p_in != null ? f.p_in : w ? cullPredict(w, cullFeatures(f)) : f.why.length ? 0.1 : 0.9;
      f.ask = f.p >= CULL_UNSURE[0] && f.p <= CULL_UNSURE[1];
      f.lean = f.p >= 0.5;
    } else { f.ask = false; f.lean = !f.why.length; }
    f.keep = CULL.flip.has(f.path) ? CULL.flip.get(f.path) : f.lean;
  }
}
const cullAsk = () => CULL.frames.filter(f => f.ask);
const cullOpen = () => cullAsk().filter(f => !CULL.flip.has(f.path) && !f.seen);
const cullKept = () => CULL.frames.filter(f => f.keep);
const cullDropped = () => CULL.frames.filter(f => !f.keep);
function cullFlip(f) {
  if (f.keep === f.lean) CULL.flip.set(f.path, !f.keep); else CULL.flip.delete(f.path);
  cullJudge(); drawCull();
}
const hhmm = t => { const s = Math.floor(t); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// ---- the large picture: made by the scan, fetched when shown, the next one ahead ----
async function cullView(f) {
  if (CULL.views.has(f.path)) return CULL.views.get(f.path);
  const p = invoke('cull_preview', { path: f.path }).catch(() => f.src);
  CULL.views.set(f.path, p);
  if (CULL.views.size > 6) CULL.views.delete(CULL.views.keys().next().value);
  return p;
}

// ---- the page ----
function renderCull() {
  if (!CULL.frames.length) return drawCullStart();
  cullJudge(); drawCull();
}

function drawCullStart() {
  const checks = [
    ['Mișcate', 'Cadre fără nicio zonă clară. La un portret contează fața, nu fundalul estompat.'],
    ['Ochi închiși', 'Fețele care clipesc, în cadrele cu oameni.'],
    ['Rafale', 'Dintr-o rafală rămâne cadrul cel mai clar, cu ochii deschiși. Restul sunt propuse pentru aruncat.'],
    ['Expunere', 'Cadre arse sau aproape negre, care nu se mai pot salva.'],
  ];
  const b = CULL.busy, pct = b ? Math.round(b.done / Math.max(1, b.total) * 100) : 0;
  $('#stage').replaceChildren(el('div', { class: 'pad stack wide' },
    el('div', {}, el('h1', {}, 'Selecție'), el('p', { class: 'muted' }, 'Aplicația se uită prin cadrele de pe card și îți propune ce să arunci. Tu decizi: orice cadru se întoarce cu o tastă, iar pe disc nu se schimbă nimic până nu apeși „Aplică”.')),
    group('Ce verifică', 'Totul se face pe calculatorul tău. Pozele nu se trimit nicăieri.',
      el('ul', { class: 'cull-checks' }, checks.map(([t, d]) => el('li', {}, el('b', {}, t), el('span', { class: 'muted' }, d))))),
    group('Începe', 'Alege folderul în care ai copiat cardul. Merge cu RAW (Canon, Nikon, Sony, Fujifilm și altele) și JPEG.',
      b ? el('div', { class: 'cull-progress' }, el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })),
        el('p', { class: 'muted' }, b.phase === 'eyes' ? `Caut ochii închiși: ${nf.format(b.done)} din ${nf.format(b.total)} cadre…`
          : b.total ? `Măsor claritatea și expunerea: ${nf.format(b.done)} din ${nf.format(b.total)} cadre…` : 'Citesc folderul…'))
        : btn('primary', 'folder', 'Alege folderul', cullPick))));
}

async function cullPick() {
  const folder = await invoke('folder_pick');
  if (!folder) return;
  CULL.folder = folder; CULL.busy = { done: 0, total: 0, phase: 'scan' }; CULL.flip.clear(); CULL.views.clear(); drawCullStart();
  const [frames, style] = await Promise.all([guard(() => invoke('cull_scan', { folder })), invoke('cull_style_get').catch(() => null)]);
  CULL.style = cullStyleView(style); CULL.at = 0; CULL.all = false;
  if (!frames) { CULL.busy = null; return drawCullStart(); }
  if (!frames.length) { CULL.busy = null; toast('În folderul ales nu am găsit poze.', 'info'); return drawCullStart(); }
  // faces and eyes, in the window, on the previews the scan made (the preview page brings them measured)
  if (!('eyes_closed' in frames[0]) && typeof eyesOf === 'function') {
    CULL.busy = { done: 0, total: frames.length, phase: 'eyes' }; drawCullStart();
    for (const [i, f] of frames.entries()) {
      const e = await cullView(f).then(src => eyesOf(src)).catch(() => null);
      Object.assign(f, e || { faces: 0, eyes_closed: false });
      if (i % 4 === 3 || i === frames.length - 1) { CULL.busy.done = i + 1; if (S.active === 'cull') drawCullStart(); }
    }
    CULL.views.clear();
  }
  CULL.busy = null;
  CULL.frames = frames;
  renderCull();
  if (typeof tourCullMaybe === 'function') tourCullMaybe();
}
listen('cull-progress', e => { if (CULL.busy && CULL.busy.phase === 'scan') { CULL.busy = { ...e.payload, phase: 'scan' }; if (S.active === 'cull' && !CULL.frames.length) drawCullStart(); } });

function cullHead() {
  const kept = cullKept().length, dropped = cullDropped().length, name = (CULL.folder || '').split(/[\\/]/).filter(Boolean).pop();
  return el('div', { class: 'cull-head' },
    el('div', {}, el('h1', {}, 'Selecție'), el('p', { class: 'muted' }, `${name} · ${plural(CULL.frames.length, 'cadru', 'cadre')}`)),
    el('div', { class: 'cull-sum' },
      el('span', { class: 'tile-k pos' }, el('small', {}, 'Păstrezi'), el('b', {}, nf.format(kept))),
      el('span', { class: 'tile-k' }, el('small', {}, 'Arunci'), el('b', {}, nf.format(dropped))),
      cullAuto() ? el('span', { class: 'tile-k' }, el('small', {}, 'Te așteaptă'), el('b', {}, nf.format(cullOpen().length))) : null));
}

function cullFoot() {
  const n = cullDropped().length;
  return el('div', { class: 'selbar cull-foot' },
    el('span', { class: 'muted' }, cullAuto() && cullOpen().length ? `Mai ai ${plural(cullOpen().length, 'cadru', 'cadre')} de verificat. Dacă aplici acum, rămâne alegerea mea.`
      : CULL.flip.size ? `Ai schimbat ${plural(CULL.flip.size, 'propunere', 'propuneri')}.` : 'Verifică propunerile, apoi aplică.'),
    el('span', { class: 'grow' }),
    btn('quiet', null, 'Alt folder', () => { CULL.frames = []; CULL.flip.clear(); CULL.views.clear(); drawCullStart(); }),
    btn('primary', 'check', `Aplică: ${plural(n, 'cadru respins', 'cadre respinse')}`, cullApply, { disabled: !n }));
}

async function cullApply() {
  const drop = cullDropped();
  const ok = await confirmBox(`Muți ${plural(drop.length, 'cadru', 'cadre')} în „Respinse”?`,
    'Cadrele respinse se mută în subfolderul „Respinse”, lângă celelalte, împreună cu fișierul .xmp și JPEG-ul pereche, dacă există. Nu se șterge nimic: le poți muta înapoi oricând. Ce ai ales rămâne și în stilul pe care îl învăț, doar pe calculatorul tău.', 'Aplică');
  if (!ok) return;
  const r = await guard(() => invoke('cull_apply', { folder: CULL.folder, reject: drop.map(f => f.path) }));
  if (!r) return;
  const agree = await cullLearn();
  toast(`Gata: ${plural(r.moved, 'cadru mutat', 'cadre mutate')} în „Respinse”.${agree != null ? ` Am ales ca tine la ${Math.round(agree * 100)}% din cadre.` : ''}`, 'success');
  CULL.frames = []; CULL.flip.clear(); CULL.views.clear();
  drawCullStart();
}

function drawCull() {
  $('#stage').replaceChildren(el('div', { class: 'cull' }, cullHead(), cullOneByOne(), cullFoot()));
}

// ---- the style note: what the app is learning and how far it got ----
function cullStyleNote() {
  const st = CULL.style;
  if (!st) return null;
  if (st.auto) {
    const ask = cullAsk().length;
    return el('div', { class: 'cull-note auto' },
      el('div', { class: 'cull-note-t' }, ico('wand'), el('b', {}, 'Selecția e făcută după stilul tău')),
      el('p', {}, ask ? `Am decis singur ${plural(CULL.frames.length - ask, 'cadru', 'cadre')}. Ți-am lăsat ${plural(ask, 'cadru', 'cadre')} la care nu sunt sigur.`
        : `Am decis singur tot cardul. Nu e niciun cadru la care să am îndoieli.`),
      el('button', { type: 'button', class: 'linkish', onclick: () => { CULL.all = !CULL.all; CULL.at = 0; drawCull(); } },
        CULL.all ? 'Arată doar cadrele nesigure' : 'Vezi tot cardul'));
  }
  const n = Math.min(st.albums, st.target - 1), of = st.target;
  return el('div', { class: 'cull-note' },
    el('div', { class: 'cull-note-t' }, ico('wand'), el('b', {}, 'Învăț cum alegi')),
    el('p', {}, `La primele albume decizi tu, cadru cu cadru. Eu notez ce păstrezi și ce arunci. După câteva albume, de obicei în jur de ${of}, îți fac singur selecția, iar ție îți trimit doar cadrele la care nu sunt sigur.`),
    el('div', { class: 'cull-note-prog' }, el('div', { class: 'cull-note-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': of, 'aria-valuenow': n },
      Array.from({ length: of }, (_, i) => el('i', { class: i < n ? 'on' : i === n ? 'now' : '' }))),
    el('small', { class: 'muted' }, `Albumul ${st.albums + 1}${st.albums < of ? ` din ~${of}` : ''}${st.agree != null ? ` · la ultimul album am ales ca tine la ${Math.round(st.agree * 100)}% din cadre` : ''}`)));
}

// ---- one frame at a time: a big frame, the reasons beside it, the card as a strip below ----
function cullOneByOne() {
  const fs = cullAuto() && !CULL.all && cullAsk().length ? cullAsk() : CULL.frames;
  const at = Math.min(CULL.at, fs.length - 1), f = fs[at];
  const go = d => { CULL.at = Math.max(0, Math.min(fs.length - 1, at + d)); drawCull(); };
  const mark = keep => { f.seen = true; if (f.keep !== keep) cullFlip(f); else drawCull(); go(1); };
  const meter = (label, v, bad) => el('div', { class: `meter${bad ? ' bad' : ''}` }, el('span', {}, label), el('i', {}, el('b', { style: `width:${Math.round(v * 100)}%` })));
  const sure = cullAuto() ? Math.round(Math.max(f.p, 1 - f.p) * 100) : null;
  const verdict = f.ask && !CULL.flip.has(f.path) && !f.seen
    ? el('p', { class: 'verdict ask' }, `Nu sunt sigur · aș ${f.lean ? 'păstra' : 'arunca'} (${sure}%)`)
    : el('p', { class: `verdict${f.keep ? ' in' : ''}` }, f.keep ? 'Păstrezi' : `Arunci: ${f.why.map(w => REASONS[w] ? REASONS[w].one : 'alegerea ta').join(', ') || 'alegerea ta'}`,
      sure != null && !CULL.flip.has(f.path) ? el('small', { class: 'muted' }, ` · sigur ${sure}%`) : null);
  const big = el('img', { src: f.src, alt: f.name });
  cullView(f).then(src => { big.src = src; });
  if (fs[at + 1]) cullView(fs[at + 1]);
  const eyes = !f.faces ? 0 : f.blink != null ? 1 - f.blink : f.eyes_closed ? 0.1 : 0.95;
  const body = el('div', { class: 'cull-body loupe' },
    el('div', { class: 'loupe-main' }, big),
    el('aside', { class: 'loupe-side' },
      el('div', {}, el('b', {}, f.name), el('p', { class: 'muted' }, `${hhmm(f.t)}${f.burst != null ? ` · rafală${f.best ? ', cea mai bună' : ''}` : ''}`)),
      verdict,
      meter('Claritate', f.sharp, f.why.includes('blur')),
      f.faces ? meter('Ochi deschiși', eyes, f.why.includes('eyes')) : el('p', { class: 'muted small' }, 'Nicio față apropiată în cadru.'),
      meter('Expunere', 1 - f.clip, f.why.includes('light')),
      el('div', { class: 'row cull-keys' }, btn(f.keep ? 'primary small' : 'secondary small', 'check', 'Păstrează (P)', () => mark(true)),
        btn(f.keep ? 'secondary small' : 'primary small', 'x', 'Aruncă (X)', () => mark(false))),
      el('p', { class: 'muted small' }, 'Săgețile trec la cadrul următor.')),
    el('div', { class: 'strip' }, fs.map((g, i) => el('button', { type: 'button', class: `stile${i === at ? ' on' : ''}${g.keep ? '' : ' out'}${g.ask && !g.seen && !CULL.flip.has(g.path) ? ' ask' : ''}`, onclick: () => { CULL.at = i; drawCull(); }, 'aria-label': g.name },
      el('img', { src: g.src, alt: '', loading: 'lazy' })))));
  body.tabIndex = -1;
  cullKeys = e => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key.toLowerCase() === 'p') mark(true); else if (e.key.toLowerCase() === 'x') mark(false);
    else return;
    e.preventDefault();
  };
  requestAnimationFrame(() => { const s = $('.stile.on'); if (s) s.scrollIntoView({ inline: 'center', block: 'nearest' }); });
  return el('div', { class: 'cull-body' }, cullStyleNote(), body);
}
let cullKeys = null;
// while a tour is open, its own keys win, except on the step that asks you to try P or X
document.addEventListener('keydown', e => { if (S.active === 'cull' && CULL.frames.length && cullKeys && tourLetsKey(e.key)) cullKeys(e); });
