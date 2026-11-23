'use strict';
// Runs first, so the window never flashes the wrong theme: the chosen look; dark until one is chosen.
try {
  const t = JSON.parse(localStorage.getItem('hsk.theme') || '"dark"');
  document.documentElement.dataset.theme = t === 'light' || t === 'dark' ? t : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
} catch { /* storage blocked: core.js picks the look */ }
