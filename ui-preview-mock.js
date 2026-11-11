'use strict';
// Preview in a browser: the Tauri bridge is replaced by calls to the public demo album (its admin view key is public).
// Only for the preview page on hsk.photos; the installed app never loads this file.
(() => {
  const DEMO = { 'x-admin-key': 'demo', 'Content-Type': 'application/json' };
  const only = what => () => Promise.reject(new Error(`${what} funcționează doar în aplicația instalată.`));
  let setup = { folder: null, album: null, album_name: '', mode: 'original', watching: false };
  let prefs = { autostart: false, close_to_tray: true, notifications: true, notify_notes: true, notify_reports: true, notify_analysis: true,
    mode: 'original', webp_edge: 2560, webp_quality: 82, paused: false, inbox_enabled: false, inbox_root: null, inbox_min: 10, notify_favorites: true, editor: 'system', editor_path: null,
    limit_enabled: false, limit_mbps: 30, limit_hours: false, limit_from: '18:00', limit_to: '23:00',
    wm_enabled: false, wm_path: null, wm_pos: 'br', wm_size: 20, wm_opacity: 70 };
  let roots = [{ id: 'r1', label: 'Arhiva 2024 (SSD extern)', path: '/Volumes/Arhiva2024', files: 18420, updated: 1762800000, online: false },
    { id: 'r2', label: 'Lucru curent', path: '/Users/ioana/Pictures/Export', files: 3105, updated: 1762900000, online: true }];
  const sample = [['IMG_4821.CR3', '2024-06-15 16:42', 'Canon EOS R6', 'r1', 'Nunta Radu 2024'], ['IMG_4822.CR3', '2024-06-15 16:42', 'Canon EOS R6', 'r1', 'Nunta Radu 2024'], ['DSC_0112.NEF', '2024-09-02 11:08', 'Nikon Z6 II', 'r1', 'Botez Matei'], ['Botez_Matei_0001.jpg', '2026-11-08 12:30', 'Sony A7 IV', 'r2', 'Botez Matei 2026-11-08']];
  const profile = { name: new URLSearchParams(location.search).get('name') || 'LightArt Studio', email: 'contact@lightart.example', phone: '+40739611961', avatar: null, has_password: false, password_at: null,
    plan: 'Studio', since: 1760000000, billing_status: 'active', period_end: 1796000000, cancel_at_period_end: false };
  const planDb = [
    { id: 'start', name: 'Debut', tagline: 'Pentru primele evenimente', price: 69, prices: { month: 69, quarter: 186, year: 662 }, one_time: false, app: false, max_albums: 5, max_photos: 1000, max_retention: 90, features: ['Albume cu recunoaștere facială'] },
    { id: 'plus', name: 'Activ', tagline: 'Pentru fotografi cu evenimente în fiecare lună', price: 129, prices: { month: 129, quarter: 348, year: 1238 }, one_time: false, app: true, max_albums: 15, max_photos: 2000, max_retention: 180, features: ['Tot ce conține Debut, plus:', 'Poze la calitate originală', 'Aplicația hsk. studio'] },
    { id: 'pro', name: 'Studio', tagline: 'Pentru studiouri cu mai multe evenimente pe lună', price: 199, prices: { month: 199, quarter: 537, year: 1910 }, one_time: false, app: true, max_albums: 40, max_photos: 3000, max_retention: 365, features: ['Tot ce conține Activ, plus:', 'Brandul tău pe album: logo, site, Instagram'] },
    { id: 'pauza', name: 'Pauză de sezon', tagline: 'Albumele rămân online, fără albume noi', price: 19, prices: { month: 19, quarter: 51, year: 182 }, one_time: false, app: false, max_albums: 0, max_photos: 0, max_retention: 0, features: [] }];
  let planNow = 'plus';
  const billing = { mode: 'off', paid: true, can_change: true, status: 'active', period_end: 1796000000, cancel_at_period_end: false, interval: 'month', credits: null, valid_until: null, beta_pct: 15, loyalty_pct: 0 };
  const overview = () => ({ current: planDb.find(x => x.id === planNow), albums: 12, quota: { used: 21.4 * 1024 ** 3, limit: 100 * 1024 ** 3 }, billing: { ...billing }, plans: planDb });
  const bus = {};
  const emit = (ev, payload) => (bus[ev] || []).forEach(fn => fn({ payload }));
  const cmds = {
    auth_state: () => ({ connected: true, offline: false, account: { name: profile.name, plan: planDb.find(x => x.id === planNow).name, owner: false, avatar: profile.avatar, app_access: !location.search.includes('locked') } }),
    auth_start: () => null, auth_claim: only('Conectarea'), auth_sign_out: () => location.reload(),
    setup_get: () => setup,
    queue_get: () => ({ waiting: 0, sent: 0, failed: 0, items: [] }),
    queue_retry: () => null, watch_stop: () => (setup = { ...setup, watching: false }),
    folder_pick: () => '/Users/ioana/Pictures/Export/Botez Matei 2026-11-08', files_pick: () => [], upload_paths: only('Încărcarea de pe calculator'),
    watch_start: only('Folderul urmărit'), retouch_start: only('Retușarea în Lightroom sau Capture One'),
    export_originals: only('Descărcarea originalelor'), retouch_stop: () => null, retouch_get: () => null, reveal: () => null,
    prefs_get: () => prefs, prefs_set: ({ prefs: next }) => (prefs = { ...prefs, ...next }),
    inbox_pending: () => [], inbox_resolve: () => null,
    catalog_roots: () => roots, catalog_add: ({ path, label }) => roots.push({ id: `r${roots.length + 1}`, label, path, files: 0, updated: Math.floor(Date.now() / 1000), online: true }),
    catalog_rescan: () => null, catalog_remove: ({ id }) => (roots = roots.filter(r => r.id !== id)),
    catalog_search: ({ query }) => { const q = query.toLowerCase(), hits = sample.filter(h => !q || h.join(' ').toLowerCase().includes(q)).map(([name, taken, camera, rid, folder]) => ({ name, taken, camera, folder, root: roots.find(r => r.id === rid)?.label || '', online: !!roots.find(r => r.id === rid)?.online })); return { total: hits.length, hits }; },
    save_file: ({ name, data }) => { const a = Object.assign(document.createElement('a'), { href: `data:application/pdf;base64,${data}`, download: name }); a.click(); return `/Descărcări/${name}`; },
    editor_detect: ({ kind }) => (kind === 'lightroom' ? '/Applications/Adobe Lightroom Classic/Adobe Lightroom Classic.app' : null), editor_pick: () => '/Applications/Affinity Photo 2.app',
    xmp_mark: ({ names }) => ({ marked: names.length, missing: 0 }),
    site_open: a => window.open(`https://hsk.photos${a.path}`, '_blank', 'noopener'),
    api_call: async ({ method, path, body }) => {
      if (path === '/api/desktop/me') return { account: { name: profile.name, plan: planDb.find(x => x.id === planNow).name, owner: false, avatar: profile.avatar, app_access: !location.search.includes('locked') }, max_photo_mb: 60, retention: [30, 90, 365], terms_ok: true,
        event_types: [{ id: 'wedding', name: 'Nuntă' }, { id: 'baptism', name: 'Botez' }, { id: 'class', name: 'Clasă / școală' }, { id: 'work', name: 'Firmă / echipă' }, { id: 'party', name: 'Petrecere' }] };
      if (path === '/api/desktop/plan/change') {
        const t = planDb.find(x => x.id === body.plan); planNow = t.id; billing.interval = body.interval; billing.period_end = Math.floor(Date.now() / 1000) + 86400 * 30;
        return { ok: true, plan: t.name, overview: overview() };
      }
      if (path === '/api/desktop/plan') return overview();
      if (path === '/api/desktop/profile' || path === '/api/desktop/password' || path === '/api/desktop/avatar') {
        if (method === 'PUT' && path.endsWith('profile')) Object.assign(profile, body);
        if (method === 'PUT' && path.endsWith('password')) { if (body.new.length < 10) throw new Error('Parola trebuie să aibă cel puțin 10 caractere și să nu fie doar cifre.'); profile.has_password = true; profile.password_at = Math.floor(Date.now() / 1000); }
        if (method === 'DELETE' && path.endsWith('password')) profile.has_password = false;
        if (method === 'PUT' && path.endsWith('avatar')) profile.avatar = `data:image/jpeg;base64,${body.image}`;
        if (method === 'DELETE' && path.endsWith('avatar')) profile.avatar = null;
        return { ...profile };
      }
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
    event: { listen: async (ev, fn) => { (bus[ev] = bus[ev] || []).push(fn); return () => {}; } },
    webview: { getCurrentWebview: () => ({ onDragDropEvent: () => {} }) },
  };
  // the preview shows what the app does when it notices a new folder: once, a few seconds after the page opens
  setTimeout(() => { try { if (!sessionStorage.getItem('folder-demo')) { sessionStorage.setItem('folder-demo', '1');
    emit('folder-detected', { path: '/Users/ioana/Pictures/Export/Botez_Matei_2026-11-08', name: 'Botez Matei', count: 214, date: '2026-11-08' }); } } catch { /* storage blocked */ } }, 9000);
  // ?demo=atentii: the panel with made-up problems, to see how errors and attention items look
  if (new URLSearchParams(location.search).get('demo') === 'atentii') setTimeout(() => {
    const go = (label) => () => toast(`„${label}” se deschide în aplicația instalată.`, 'info');
    setAttention('demo', [
      { id: 'd1', level: 'critical', icon: 'wifi-off', title: '38 de poze nu s-au încărcat', text: 'Conexiunea a căzut la „Botez Matei”. Ce a rămas se reia singur când revine internetul.', action: { label: 'Încearcă acum', run: go('Încearcă acum') } },
      { id: 'd2', level: 'critical', icon: 'alert', title: 'Spațiul din cont s-a umplut', text: '48,2 GB din 50 GB. Încărcările noi pot fi refuzate. Șterge albume vechi sau schimbă planul.', action: { label: 'Vezi albumele', run: go('Vezi albumele') } },
      { id: 'd3', level: 'warn', icon: 'alert', title: '2 cereri de ascundere sau ștergere în „Nuntă Ana și Dan”', text: 'Un invitat cere să nu apară în poze.', action: { label: 'Deschide cererile', run: go('Deschide cererile') } },
      { id: 'd4', level: 'warn', icon: 'folder-plus', title: 'Folder nou: „Cununie Radu”', text: '186 de poze într-un folder care nu e încă album.', action: { label: 'Creează albumul', run: go('Creează albumul') }, dismissible: true },
      { id: 'd5', level: 'warn', icon: 'bell', title: '3 notițe noi de la invitați în „Nuntă Ana și Dan”', text: 'Cer retușuri la poze anume.', action: { label: 'Citește notițele', run: go('Citește notițele') } },
      { id: 'd6', level: 'warn', icon: 'alert', title: '„Clasa a 12-a B” expiră în 3 zile', text: 'După expirare, albumul și fețele recunoscute se șterg.', action: { label: 'Prelungește', run: go('Prelungește') } },
      { id: 'd7', level: 'info', icon: 'scan', title: 'Se caută fețele în „Botez Matei”', text: '41 de poze mai așteaptă. Persoanele apar pe măsură ce se termină.', dismissible: true },
      { id: 'd8', level: 'info', icon: 'pause', title: 'Încărcarea e oprită temporar', text: '12 poze așteaptă să fie încărcate.', action: { label: 'Pornește', run: go('Pornește') } },
    ]);
    navigator.__demoAtt = true;
  }, 2500);
  addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('p');
    bar.id = 'preview-note';
    bar.textContent = 'Previzualizare cu albumul demo (se resetează la 5 minute). Încărcarea din folder, retușarea și notificările funcționează doar în aplicația instalată.';
    document.body.append(bar);
  });
})();

// live preview: the page reloads itself a moment after any file of the app changes
(() => {
  let last = null;
  setInterval(async () => {
    try {
      const v = await (await fetch('/preview/studio/_v', { cache: 'no-store' })).text();
      if (last !== null && v !== last) location.reload();
      last = v;
    } catch { /* the server is restarting */ }
  }, 1500);
})();
