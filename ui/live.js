'use strict';
// Live Event: the newest photos of the album full screen, for the projector or television in the hall, with the QR code in a corner.

let live = null;

function startLive() {
  const a = S.album, code = S.code;
  if (!a || live) return;
  const seen = new Set(), fresh = [];
  let all = [], seconds = ui.get('live-seconds', 8), timer = 0, poll = 0, front = 0;
  const layers = [el('img', { class: 'live-img', alt: '' }), el('img', { class: 'live-img', alt: '' })];
  const bar = el('div', { class: 'live-bar' },
    segmented([{ value: 5, label: '5 s' }, { value: 8, label: '8 s' }, { value: 15, label: '15 s' }], seconds, v => { seconds = Number(v); ui.set('live-seconds', seconds); schedule(); }, 'Cât stă fiecare poză'),
    btn('ghost', 'x', 'Închide', stop));
  const root = el('div', { id: 'live', role: 'dialog', 'aria-label': 'Proiecție în sală' }, ...layers, el('p', { class: 'live-title' }, a.name),
    el('div', { class: 'live-qr' }, el('img', { src: `${SITE}/api/qr?data=${encodeURIComponent(a.share_url)}`, alt: '' }), el('p', {}, 'Scanează și găsește pozele cu tine')), bar);
  document.body.append(root);
  try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); } catch { /* the window itself is enough */ }
  let idle = 0;
  const wake = () => { root.classList.add('awake'); clearTimeout(idle); idle = setTimeout(() => root.classList.remove('awake'), 3000); };
  root.addEventListener('mousemove', wake); wake();

  const visible = list => list.filter(p => !p.hidden && !p.private);
  async function refresh() {
    const m = await fetchAlbum(code).catch(() => null);
    if (!m) return;
    all = visible(m.photos || []);
    for (const p of all) if (!seen.has(p.id)) { seen.add(p.id); if (live.started) fresh.push(p); }
    live.started = true;
  }
  let order = [];
  function pick() {
    if (fresh.length) return fresh.shift();
    if (!order.length) order = [...all].sort(() => Math.random() - .5);
    return order.pop();
  }
  function show() {
    const p = pick();
    if (!p) return;
    const next = layers[1 - front], url = abs(p.view || p.eco || p.thumb);
    const img = new Image();
    img.onload = () => { next.src = url; next.classList.add('on'); layers[front].classList.remove('on'); front = 1 - front; };
    img.src = url;
  }
  function schedule() { clearInterval(timer); timer = setInterval(show, seconds * 1000); }
  function stop() {
    clearInterval(timer); clearInterval(poll); clearTimeout(idle);
    removeEventListener('keydown', onKey, true);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    root.remove(); live = null;
  }
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); } };
  addEventListener('keydown', onKey, true);
  live = { started: false, stop };
  refresh().then(() => { show(); schedule(); });
  poll = setInterval(refresh, 10000);
}
