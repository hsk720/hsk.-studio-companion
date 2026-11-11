'use strict';
// The intro: a large "hsk." that gives way to the app once everything has loaded. It plays once per start of the
// app, the first time the window is actually in front of the photographer (an app started with the computer sits
// in the tray until opened), and stays at least a moment so it can be seen even when loading is instant.
const intro = { ready: false, from: 0, done: false };
const SPLASH_MIN = 1700;

function introSeen() { return document.visibilityState === 'visible' && document.hasFocus(); }

function introTick() {
  if (intro.done) return;
  const splash = $('#splash');
  if (!intro.from) {
    if (!introSeen()) return setTimeout(introTick, 250);
    intro.from = Date.now();
    splash.classList.add('play');
  }
  const left = SPLASH_MIN - (Date.now() - intro.from);
  if (!intro.ready || left > 0) return setTimeout(introTick, Math.max(80, intro.ready ? left : 120));
  intro.done = true;
  splash.classList.add('out');
  setTimeout(() => splash.remove(), 700);
}

if (/[?&]nosplash\b/.test(location.search)) { intro.done = true; $('#splash').remove(); } else introTick();

invoke('auth_state').then(applyAuth).catch(() => {}).finally(() => { intro.ready = true; });
