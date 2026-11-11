'use strict';
// Preview in a browser: the Tauri bridge is replaced by calls to the public demo album (its admin view key is public).
// Only for the preview page on hsk.photos; the installed app never loads this file.
(() => {
  const DEMO = { 'x-admin-key': 'demo', 'Content-Type': 'application/json' };
  const only = what => () => Promise.reject(new Error(`${what} funcționează doar în aplicația instalată.`));
  let setup = { folder: null, album: null, album_name: '', mode: 'original', watching: false };
  let prefs = { autostart: false, notifications: true };
  const cmds = {
    auth_state: () => ({ connected: true, offline: false, account: { name: 'Studio Demo', plan: 'Studio', owner: false } }),
    auth_start: () => null, auth_claim: only('Conectarea'), auth_sign_out: () => location.reload(),
    setup_get: () => setup,
    queue_get: () => ({ waiting: 0, sent: 0, failed: 0, items: [] }),
    queue_retry: () => null, watch_stop: () => (setup = { ...setup, watching: false }),
    folder_pick: () => null, files_pick: () => [], upload_paths: only('Încărcarea de pe calculator'),
    watch_start: only('Folderul urmărit'), retouch_start: only('Retușarea în Lightroom sau Capture One'),
    export_originals: only('Descărcarea originalelor'), retouch_stop: () => null, retouch_get: () => null, reveal: () => null,
    prefs_get: () => prefs, prefs_set: (a) => (prefs = { autostart: a.autostart, notifications: a.notifications }),
    site_open: a => window.open(`https://hsk.photos${a.path}`, '_blank', 'noopener'),
    api_call: async ({ method, path, body }) => {
      if (path === '/api/desktop/me') return { account: { name: 'Studio Demo', plan: 'Studio', owner: false }, max_photo_mb: 60, retention: [30, 90, 365], terms_ok: true,
        event_types: [{ id: 'wedding', name: 'Nuntă' }, { id: 'class', name: 'Clasă / școală' }, { id: 'work', name: 'Firmă / echipă' }] };
      if (method === 'POST' && path === '/api/albums') throw new Error('În previzualizare nu se pot crea albume. Aplicația instalată le creează pe contul tău.');
      if (path === '/api/desktop/albums') {
        const m = await (await fetch('/api/albums/DEMO/manage?photos=false', { headers: DEMO })).json();
        return { albums: [{ code: m.code, name: m.name, event_date: m.event_date, created_at: m.created_at, expires_at: m.expires_at, photos: m.photo_count, thumb: m.cover }] };
      }
      const r = await fetch(path, { method, headers: DEMO, body: body == null ? undefined : JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || `Serverul a răspuns cu eroarea ${r.status}.`);
      return data;
    },
  };
  window.__TAURI__ = {
    core: { invoke: async (cmd, args) => { if (!cmds[cmd]) throw new Error(`Comanda ${cmd} nu există în previzualizare.`); return cmds[cmd](args || {}); } },
    event: { listen: async () => () => {} },
    webview: { getCurrentWebview: () => ({ onDragDropEvent: () => {} }) },
  };
  addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('p');
    bar.id = 'preview-note';
    bar.textContent = 'Previzualizare cu albumul demo (se resetează la 5 minute). Încărcarea din folder, retușarea și notificările funcționează doar în aplicația instalată.';
    document.body.append(bar);
  });
})();
