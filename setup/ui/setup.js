'use strict';
// hsk. studio Setup: Bun venit → Instalare → Gata. Rust does the work (main.rs); this page shows it.
const T = window.__TAURI__;
const invoke = (cmd, args) => T.core.invoke(cmd, args);
const win = T.window.getCurrentWindow();
const $ = s => document.querySelector(s);
const ORDER = ['files', 'install', 'shortcuts'];
let dir = '', exe = '', busy = false;

function step(n) { // 1, 2, 3
  ['#p1', '#p2', '#p3'].forEach((id, i) => { $(id).hidden = i !== n - 1; });
  document.querySelectorAll('#steps .st').forEach((li, i) => {
    li.classList.toggle('on', i === n - 1);
    li.classList.toggle('done', i < n - 1 || n === 3);
    li.querySelector('i').textContent = i < n - 1 || n === 3 ? '✓' : String(i + 1);
  });
}

function progress({ step: s, percent }) {
  $('#bar').style.width = `${percent}%`;
  $('#pct').textContent = `${percent}%`;
  const at = s === 'done' ? ORDER.length : ORDER.indexOf(s);
  ORDER.forEach((name, i) => {
    const li = $(`#l-${name}`);
    li.classList.toggle('ok', i < at);
    li.classList.toggle('now', i === at);
  });
}

async function start() {
  busy = true;
  $('#close').disabled = true;
  $('#err').hidden = true; $('#retry').hidden = true;
  $('#p2-title').textContent = 'Se instalează…';
  $('#p2-lead').hidden = false; $('.tips').hidden = false;
  step(2);
  progress({ step: 'files', percent: 0 });
  try {
    exe = await invoke('install', { dir, desktop: $('#desktop').checked, autostart: $('#autostart').checked });
    busy = false; $('#close').disabled = false;
    setTimeout(() => { step(3); $('#done').focus(); }, 400);
  } catch (e) {
    busy = false; $('#close').disabled = false;
    $('#p2-title').textContent = 'Instalarea nu s-a terminat';
    $('#err').textContent = String(e); $('#err').hidden = false;
    $('#p2-lead').hidden = true; $('.tips').hidden = true;
    document.querySelectorAll('.log li.now').forEach(li => li.classList.remove('now'));
    $('#retry').hidden = false; $('#retry').focus();
  }
}

async function init() {
  const info = await invoke('info');
  dir = info.dir;
  $('#dir').textContent = dir; $('#dir').title = dir;
  $('#version').textContent = `Versiunea ${info.version} · hsk.photos`;
  if (info.update) {
    $('#p1-title').textContent = 'Actualizează hsk. studio';
    $('#go').textContent = 'Actualizează';
    $('#p3-title').textContent = 'Gata, hsk. studio e actualizat';
  }
  $('#go').focus();
}

T.event.listen('progress', e => progress(e.payload));
$('#min').addEventListener('click', () => win.minimize());
$('#close').addEventListener('click', () => { if (!busy) win.close(); });
$('#cancel').addEventListener('click', () => win.close());
$('#go').addEventListener('click', start);
$('#retry').addEventListener('click', start);
$('#change').addEventListener('click', async () => {
  const picked = await T.dialog.open({ directory: true, defaultPath: dir, title: 'Alege folderul pentru hsk. studio' });
  if (!picked) return;
  dir = await invoke('folder_for', { picked });
  $('#dir').textContent = dir; $('#dir').title = dir;
});
$('#done').addEventListener('click', async () => {
  if ($('#open').checked && exe) { try { await invoke('launch', { exe }); } catch { /* the Start menu still has it */ } }
  win.close();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !busy && !$('#p1').hidden) win.close();
});
init();
