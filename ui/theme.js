'use strict';
// Runs first, so the window never flashes the wrong theme: the chosen look, or the computer's.
try {
  const t = JSON.parse(localStorage.getItem('hsk.theme') || '"system"');
  document.documentElement.dataset.theme = t === 'light' || t === 'dark' ? t : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
} catch { /* storage blocked: core.js picks the look */ }
