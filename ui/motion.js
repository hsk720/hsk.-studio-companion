'use strict';
// Motion: the few tools every screen uses, so the same kind of change always moves the same way.
// Changes happen at once; the motion only places them (it never delays a click). Durations and the curve live in
// app.css (--d1 120 ms, --d2 200 ms, --d3 320 ms, --ease). "Less motion" (the system's, or a slow computer) turns
// all of it into a short fade or nothing.

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const calm = () => REDUCED.matches || document.documentElement.classList.contains('calm');

/** A freshly drawn page or panel comes in: rises 8 px (dir 0) or slides 24 px from the side it comes from. */
function enter(node, dir = 0) {
  if (!node || calm()) return;
  const cls = dir > 0 ? 'm-in-r' : dir < 0 ? 'm-in-l' : 'm-in';
  node.classList.remove('m-in', 'm-in-l', 'm-in-r');
  void node.offsetWidth; // restart the animation when the same panel comes in again
  node.classList.add(cls);
  node.addEventListener('animationend', () => node.classList.remove(cls), { once: true });
}

/** Elements on their way out: shrink a little and fade, then `done` (which removes them or redraws). */
function leave(nodes, done) {
  const list = [...nodes].filter(Boolean);
  if (!list.length || calm()) { done(); return; }
  list.forEach(n => n.classList.add('m-out'));
  setTimeout(done, 170);
}

/** FLIP: notes where the keyed children of a container are, lets `mutate` redraw, then slides each one from its old
 *  place to its new one; new ones fade in. Only what is on screen moves: thousands of photos cost nothing. */
function flip(getContainer, selector, key, mutate) {
  const box = getContainer();
  if (!box || calm()) { mutate(); return; }
  const before = new Map();
  const view = innerHeight + 200;
  for (const n of box.querySelectorAll(selector)) {
    const r = n.getBoundingClientRect();
    if (r.bottom > -200 && r.top < view) before.set(n.dataset[key], r);
  }
  mutate();
  const after = getContainer();
  if (!after) return;
  const moved = [];
  for (const n of after.querySelectorAll(selector)) {
    const r = n.getBoundingClientRect();
    if (r.bottom < -200 || r.top > view) continue;
    const was = before.get(n.dataset[key]);
    if (!was) { n.classList.add('m-pop'); n.addEventListener('animationend', () => n.classList.remove('m-pop'), { once: true }); continue; }
    const dx = was.left - r.left, dy = was.top - r.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    n.style.transform = `translate(${dx}px, ${dy}px)`;
    n.style.transition = 'none';
    moved.push(n);
  }
  if (!moved.length) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const n of moved) {
      n.style.transition = 'transform var(--d2) var(--ease)';
      n.style.transform = '';
      n.addEventListener('transitionend', () => { n.style.transition = ''; }, { once: true });
    }
  }));
}

/** A picture shows only once it is decoded, with a short fade: never half drawn, never popping in. */
function reveal(img) {
  if (!img) return img;
  if (img.complete && img.naturalWidth) return img; // already there (cache): no fade, no flash
  img.classList.add('rv');
  const done = () => img.classList.add('in');
  img.addEventListener('load', () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(done), { once: true });
  img.addEventListener('error', done, { once: true });
  return img;
}

/** Grey shapes in the size and place of what is loading: the page does not jump when it arrives. */
function skeletonGrid(n = 24) {
  return el('div', { class: 'grid skeleton', 'aria-busy': 'true', 'aria-label': 'Se încarcă' },
    Array.from({ length: n }, () => el('span', { class: 'tile sk' })));
}

// a computer that cannot keep up gets less motion by itself: the first second of frames is measured once
(() => {
  if (calm()) return;
  let frames = 0, slow = 0, last = performance.now();
  const tick = now => {
    if (now - last > 34) slow++;
    last = now;
    if (++frames < 90) requestAnimationFrame(tick);
    else if (slow > 30) document.documentElement.classList.add('calm');
  };
  setTimeout(() => requestAnimationFrame(tick), 2500);
})();

// ---- dialogs: open and close with the same motion everywhere ----
(() => {
  const dlg = document.getElementById('dlg');
  if (!dlg) return;
  const close = dlg.close.bind(dlg);
  dlg.close = value => {
    if (!dlg.open || dlg.classList.contains('closing')) return;
    if (calm()) return close(value);
    dlg.classList.add('closing');
    setTimeout(() => { dlg.classList.remove('closing'); close(value); }, 140);
  };
  // Escape: the same way out
  dlg.addEventListener('cancel', e => { e.preventDefault(); dlg.close(); });
})();

// the window itself never scrolls (a focus or a scrollIntoView could shift it): only its lists do
addEventListener('scroll', () => { if (scrollX || scrollY) scrollTo(0, 0); if (document.body.scrollTop) document.body.scrollTop = 0; }, true);
