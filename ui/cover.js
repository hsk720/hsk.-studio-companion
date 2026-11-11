'use strict';
// The cover: which photo, for the computer or for the phone, which part of it stays in the frame, and how far it is zoomed.
// The site shows the cover with `object-position: x% y%` and, on phones, a zoom of the 9:16 frame around the same point.

async function coverDialog(photoId) {
  const a = S.album, p = (a.photos || []).find(x => x.id === photoId);
  if (!p) return;
  const [x0, y0, z0] = (a.cover_focus && a.cover_focus.length ? a.cover_focus : [50, 40, 1]);
  const st = { x: x0, y: y0, z: z0 || 1, target: 'desktop', both: !a.cover_mobile_id || a.cover_mobile_id === a.cover_id };
  const ratio = (p.width && p.height) ? p.width / p.height : 1.5;
  const FRAME = { desktop: 16 / 9, mobile: 9 / 16 };

  const marker = el('i', { class: 'cv-marker' });
  const outline = el('i', { class: 'cv-outline' });
  const full = el('div', { class: 'cv-full', style: `aspect-ratio:${ratio}` }, el('img', { src: abs(p.view || p.thumb), alt: '', draggable: false }), outline, marker);
  const pic = el('picture', { class: 'cv-pic' }, el('img', { src: abs(p.view || p.thumb), alt: '', draggable: false }));
  const frame = el('div', { class: 'cv-frame' }, pic);
  const zoom = el('input', { type: 'range', class: 'range wide', min: 1, max: 4, step: 0.05, value: st.z, 'aria-label': 'Zoom', oninput: () => { st.z = Number(zoom.value); paint(); } });
  const zoomLabel = el('output', { class: 'muted' });
  const note = el('p', { class: 'muted' });

  const paint = () => {
    const mobile = st.target === 'mobile', f = FRAME[st.target];
    marker.style.left = `${st.x}%`; marker.style.top = `${st.y}%`;
    // the part of the photo the frame shows: the frame covers the photo, the point decides which part, the zoom narrows it
    let wf = 1, hf = 1;
    if (ratio > f) wf = f / ratio; else hf = ratio / f;
    const L = (st.x / 100) * (1 - wf) * 100, T = (st.y / 100) * (1 - hf) * 100;
    const z = mobile ? st.z : 1;
    const o = { x: st.x / 100, y: st.y / 100 };
    const sx = o.x * (1 - 1 / z), sy = o.y * (1 - 1 / z);
    Object.assign(outline.style, { left: `${L + wf * 100 * sx}%`, top: `${T + hf * 100 * sy}%`, width: `${(wf * 100) / z}%`, height: `${(hf * 100) / z}%` });
    frame.style.aspectRatio = String(f);
    frame.style.width = mobile ? '150px' : '320px';
    $('img', pic).style.objectPosition = `${st.x}% ${st.y}%`;
    pic.style.transform = `scale(${z})`; pic.style.transformOrigin = `${st.x}% ${st.y}%`;
    zoom.disabled = !mobile;
    zoomLabel.textContent = mobile ? `${st.z.toFixed(2).replace('.', ',')}×` : 'doar pe telefon';
    note.textContent = mobile
      ? (a.cover_mobile_id && !st.both ? 'Telefoanele au acum o poză proprie.' : st.both ? 'Poza e aceeași pe calculator și pe telefon.' : 'Telefoanele folosesc acum coperta de pe calculator.')
      : 'Așa se vede în capul albumului, pe ecran lat.';
  };

  const drag = e => {
    const r = full.getBoundingClientRect();
    st.x = Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)) * 10) / 10;
    st.y = Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) * 10) / 10;
    paint();
  };
  full.addEventListener('pointerdown', e => { full.setPointerCapture(e.pointerId); drag(e); full.onpointermove = drag; });
  full.addEventListener('pointerup', () => { full.onpointermove = null; });

  const body = el('div', { class: 'cover-dlg' },
    el('div', { class: 'cv-top' },
      segmented([{ value: 'desktop', icon: 'monitor', label: 'Calculator' }, { value: 'mobile', icon: 'phone', label: 'Telefon' }], st.target, v => { st.target = v; paint(); }, 'Unde apare coperta'),
      toggle('Aceeași poză pe calculator și pe telefon', null, st.both, v => { st.both = v; paint(); })),
    el('div', { class: 'cv-stage' },
      el('div', { class: 'stack' }, el('p', { class: 'muted' }, 'Mută punctul: partea aleasă rămâne în cadru.'), full),
      el('div', { class: 'stack cv-live' }, el('p', { class: 'muted' }, 'Așa o văd invitații'), frame, note)),
    el('div', { class: 'cv-tools' },
      el('div', { class: 'cv-tool' }, el('span', { class: 'lbl' }, 'Zoom'), zoom, zoomLabel),
      el('div', { class: 'cv-tool' }, el('span', { class: 'lbl' }, 'Punctul'),
        segmented([{ value: 20, label: 'Sus' }, { value: 50, label: 'Centru' }, { value: 80, label: 'Jos' }], [20, 50, 80].includes(st.y) ? st.y : '', v => { st.y = Number(v); paint(); }, 'Poziția pe verticală')),
      a.cover_mobile_id ? btn('quiet', null, 'Scoate coperta proprie de pe telefon', async () => {
        if (await guard(() => api('PUT', `/api/albums/${S.code}/cover`, { photo_id: null, target: 'mobile' }))) { closeModal(false); toast('Telefoanele folosesc acum coperta de pe calculator.', 'success'); reloadAlbum(); }
      }) : null));
  paint();
  const go = await modal({ title: 'Coperta albumului', body, wider: true, actions: [{ label: 'Renunț', value: false }, { label: 'Salvează coperta', value: 'save', primary: true }] });
  if (go !== 'save') return;
  const targets = st.both ? ['desktop', 'mobile'] : [st.target];
  for (const target of targets) if (!await guard(() => api('PUT', `/api/albums/${S.code}/cover`, { photo_id: p.id, target }))) return;
  if (!await guard(() => api('PUT', `/api/albums/${S.code}/cover/focus`, { x: st.x, y: st.y, z: st.z }))) return;
  toast('Coperta a fost schimbată.', 'success');
  sel.clear();
  reloadAlbum();
}
