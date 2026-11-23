'use strict';
// Smooth scrolling everywhere in the window: a mouse wheel's steps become one gliding movement, in whatever list,
// grid or page is under the pointer. Touchpads already glide and are left alone, as are Ctrl+wheel (zoom, the grid
// size), sideways scrolling, text fields and people who asked the system for less motion.

(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const EASE = 0.2;          // share of the remaining distance covered per frame at 60 fps
  const LINE = 40, MIN_WHEEL = 50;
  const moving = new Map();  // element → { target, raf, last }

  const canScroll = (node, down) => {
    const st = getComputedStyle(node);
    if (!/(auto|scroll|overlay)/.test(st.overflowY) || node.scrollHeight <= node.clientHeight + 1) return false;
    const m = moving.get(node), top = m ? m.target : node.scrollTop;
    return down ? top < node.scrollHeight - node.clientHeight - 1 : top > 0;
  };

  /** The nearest list or page under the pointer that can still move this way. */
  function scroller(from, down) {
    for (let n = from; n && n !== document.documentElement; n = n.parentElement) {
      if (n.nodeType === 1 && canScroll(n, down)) return n;
    }
    return null;
  }

  function step(node, now) {
    const m = moving.get(node);
    if (!m) return;
    const dt = Math.min(64, now - (m.last || now - 16.7));
    m.last = now;
    const k = 1 - Math.pow(1 - EASE, dt / 16.7);
    const cur = node.scrollTop, next = cur + (m.target - cur) * k;
    if (Math.abs(m.target - next) < 0.5) { node.scrollTop = m.target; moving.delete(node); return; }
    node.scrollTop = next;
    // the list reached its end (or was resized) before the target: stop there
    if (Math.abs(node.scrollTop - cur) < 0.01 && Math.abs(m.target - cur) > 1) { moving.delete(node); return; }
    m.raf = requestAnimationFrame(t => step(node, t));
  }

  addEventListener('wheel', e => {
    if (e.defaultPrevented || e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.deltaMode === 0 && Math.abs(e.deltaY) < MIN_WHEEL) return; // a touchpad: already smooth
    if (e.target.closest && e.target.closest('textarea, select, input[type="range"], [data-native-scroll]')) return;
    const down = e.deltaY > 0;
    const node = scroller(e.target, down);
    if (!node) return;
    e.preventDefault();
    const delta = e.deltaY * (e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? node.clientHeight : 1);
    const max = node.scrollHeight - node.clientHeight;
    let m = moving.get(node);
    if (!m) { m = { target: node.scrollTop, raf: 0, last: 0 }; moving.set(node, m); }
    m.target = Math.max(0, Math.min(max, m.target + delta));
    cancelAnimationFrame(m.raf);
    m.raf = requestAnimationFrame(t => step(node, t));
  }, { passive: false });

  // grabbing the scrollbar takes over from a glide in progress
  const stopAll = () => { for (const [, m] of moving) cancelAnimationFrame(m.raf); moving.clear(); };
  addEventListener('pointerdown', stopAll, true);

  // the keyboard glides as well: Page Up/Down, Space, Home, End (not while typing, not in the viewer or a dialog)
  addEventListener('keydown', e => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!['PageDown', 'PageUp', ' ', 'Home', 'End'].includes(e.key)) return;
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    if (a && a.tagName === 'BUTTON' && e.key === ' ') return; // Space presses a focused button
    if (document.querySelector('#dlg[open]') || !document.querySelector('#viewer')?.hidden) return;
    // the list in the middle of the work area (the album, the page): whatever can move that way
    const stage = document.querySelector('#stage');
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const down = !(e.key === 'PageUp' || e.key === 'Home' || (e.key === ' ' && e.shiftKey));
    const node = scroller(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2), down);
    if (!node) return;
    e.preventDefault();
    const page = node.clientHeight * 0.85, max = node.scrollHeight - node.clientHeight;
    let m = moving.get(node);
    if (!m) { m = { target: node.scrollTop, raf: 0, last: 0 }; moving.set(node, m); }
    m.target = e.key === 'Home' ? 0 : e.key === 'End' ? max
      : Math.max(0, Math.min(max, m.target + (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey) ? -page : page)));
    cancelAnimationFrame(m.raf);
    m.raf = requestAnimationFrame(t => step(node, t));
  });
})();

/** Brings an element into view with a glide, moving only the list it sits in (never the window).
 *  `inline: 'center'` centres it sideways; otherwise it moves just enough to be whole on screen. */
function glideTo(node, opts = {}) {
  if (!node) return;
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  for (let box = node.parentElement; box && box !== document.body; box = box.parentElement) {
    const st = getComputedStyle(box);
    const sideways = /(auto|scroll)/.test(st.overflowX) && box.scrollWidth > box.clientWidth + 1;
    const upDown = /(auto|scroll)/.test(st.overflowY) && box.scrollHeight > box.clientHeight + 1;
    if (!sideways && !upDown) continue;
    const b = box.getBoundingClientRect(), r = node.getBoundingClientRect();
    let left = box.scrollLeft, top = box.scrollTop;
    if (sideways) {
      if (opts.inline === 'center') left += r.left + r.width / 2 - (b.left + b.width / 2);
      else if (r.left < b.left) left += r.left - b.left;
      else if (r.right > b.right) left += r.right - b.right;
    }
    if (upDown) {
      if (r.top < b.top) top += r.top - b.top;
      else if (r.bottom > b.bottom) top += r.bottom - b.bottom;
    }
    if (left !== box.scrollLeft || top !== box.scrollTop) box.scrollTo({ left, top, behavior });
    return;
  }
}
