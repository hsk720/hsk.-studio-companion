'use strict';
// The app's own settings, in groups. Short lists are switches; nothing is hidden behind a drop-down.

async function setPref(patch) {
  const next = await guard(() => invoke('prefs_set', { prefs: { ...S.prefs, ...patch } }));
  if (next) { S.prefs = next; S.setup = await invoke('setup_get'); }
  return next;
}

async function renderPrefs() {
  const stage = $('#stage');
  S.prefs = await guard(() => invoke('prefs_get')) || S.prefs;
  const p = S.prefs;
  if (!p) return;
  const redraw = () => renderPrefs();
  const kv = (label, hint, ...kids) => el('div', { class: 'kv' }, el('span', { class: 'k' }, el('b', {}, label), hint ? el('small', { class: 'muted' }, hint) : null), el('span', { class: 'v' }, kids));

  stage.replaceChildren(el('div', { class: 'pad stack wide' },
    el('div', {}, el('h1', {}, 'Setări'), el('p', { class: 'muted' }, 'Pentru un album anume, deschide-l și alege fila Setări album.')),

    group('Pornire și fundal', 'Aplicația lucrează și cu fereastra închisă, din bara de meniu sau de lângă ceas.',
      toggle('Pornește odată cu calculatorul', 'Fără fereastră: doar iconița, ca folderul să se urmărească de la prima pornire.', p.autostart, async on => { await setPref({ autostart: on }); }),
      kv('Când închid fereastra', 'Cu „rămâne pornită”, trimiterea continuă.', segmented([{ value: 'tray', label: 'Rămâne pornită' }, { value: 'quit', label: 'Se oprește' }], p.close_to_tray ? 'tray' : 'quit', v => setPref({ close_to_tray: v === 'tray' }), 'Când închid fereastra')),
      kv('La pornire deschide', null, segmented([{ value: 'home', label: 'Panoul' }, { value: 'last', label: 'Ultimul album' }], ui.get('startup', 'last'), v => ui.set('startup', v), 'La pornire deschide'))),

    group('Notificări', 'Te anunță chiar când nu ești în aplicație.',
      toggle('Notificări de desktop', null, p.notifications, async on => { await setPref({ notifications: on }); redraw(); }),
      p.notifications ? [
        toggle('Notițe noi de la invitați', null, p.notify_notes, on => setPref({ notify_notes: on })),
        toggle('Cereri de ascundere sau ștergere', 'Un invitat cere să nu apară într-o poză.', p.notify_reports, on => setPref({ notify_reports: on })),
        toggle('Recunoașterea fețelor s-a terminat', null, p.notify_analysis, on => setPref({ notify_analysis: on })),
        toggle('Clienții și-au ales pozele', 'O listă nouă de favorite sau una schimbată.', p.notify_favorites, on => setPref({ notify_favorites: on }))] : null),

    group('Trimiterea pozelor', 'Cum pleacă pozele din folder sau din fereastră spre album.',
      kv('Ce se trimite', p.mode === 'webp' ? 'JPEG mai mic, făcut pe calculatorul tău: albumul ajunge online mult mai repede.' : 'Fișierul exact cum l-ai exportat, la rezoluție completă.',
        segmented([{ value: 'original', label: 'Originale' }, { value: 'webp', label: 'Copie pentru web' }], p.mode, async v => { await setPref({ mode: v }); redraw(); }, 'Ce se trimite')),
      p.mode === 'webp' ? [
        kv('Dimensiunea copiei', 'Latura cea lungă, în pixeli. Pentru telefon și laptop 2048 px ajunge.', segmented([{ value: 1600, label: '1600 px' }, { value: 2048, label: '2048 px' }, { value: 2560, label: '2560 px' }], p.webp_edge, v => setPref({ webp_edge: Number(v) }), 'Latura mare')),
        kv('Calitatea JPEG', 'Mai mare înseamnă fișiere mai grele.', segmented([{ value: 70, label: 'Mică' }, { value: 82, label: 'Bună' }, { value: 92, label: 'Maximă' }], p.webp_quality, v => setPref({ webp_quality: Number(v) }), 'Calitatea'))] : null,
      p.mode === 'webp' ? [
        toggle('Filigran pe copiile pentru web', 'Logo-ul tău, pus pe copiile mici. Originalele rămân curate.', p.wm_enabled, async on => {
          if (on && !p.wm_path) { const f = (await invoke('files_pick'))[0]; if (!f) return redraw(); await setPref({ wm_enabled: true, wm_path: f }); } else await setPref({ wm_enabled: on });
          redraw();
        }),
        p.wm_enabled ? [
          kv('Imaginea filigranului', 'Un PNG cu fundal transparent merge cel mai bine.', el('span', { class: 'path-box inline' }, p.wm_path || 'nealeasă'),
            btn('quiet', null, 'Alege', async () => { const f = (await invoke('files_pick'))[0]; if (f) { await setPref({ wm_path: f }); redraw(); } })),
          kv('Unde apare', null, segmented([{ value: 'bl', label: 'Stânga jos' }, { value: 'center', label: 'Centru' }, { value: 'br', label: 'Dreapta jos' }], p.wm_pos, v => setPref({ wm_pos: v }), 'Unde apare filigranul')),
          kv('Mărimea', null, segmented([{ value: 12, label: 'Mică' }, { value: 20, label: 'Medie' }, { value: 30, label: 'Mare' }], p.wm_size, v => setPref({ wm_size: Number(v) }), 'Mărimea filigranului')),
          kv('Cât se vede', null, segmented([{ value: 40, label: 'Discret' }, { value: 70, label: 'Clar' }, { value: 100, label: 'Plin' }], p.wm_opacity, v => setPref({ wm_opacity: Number(v) }), 'Cât se vede filigranul'))] : null] : null,
      toggle('Limitează viteza de încărcare', 'Lasă internetul liber și pentru ceilalți din casă. Pozele se încarcă mai încet, dar ajung la fel.', p.limit_enabled, async on => { await setPref({ limit_enabled: on }); redraw(); }),
      p.limit_enabled ? [
        kv('Viteza maximă', null, segmented([{ value: 10, label: '10 Mbps' }, { value: 30, label: '30 Mbps' }, { value: 50, label: '50 Mbps' }, { value: 100, label: '100 Mbps' }], p.limit_mbps, v => setPref({ limit_mbps: Number(v) }), 'Viteza maximă')),
        kv('Când se aplică', 'În afara orelor alese, încărcarea merge cu toată viteza.', segmented([{ value: 'always', label: 'Tot timpul' }, { value: 'hours', label: 'La anumite ore' }], p.limit_hours ? 'hours' : 'always', async v => { await setPref({ limit_hours: v === 'hours' }); redraw(); }, 'Când se aplică')),
        p.limit_hours ? kv('Între orele', null,
          el('input', { type: 'time', class: 'field slim', value: p.limit_from, 'aria-label': 'De la ora', onchange: e => setPref({ limit_from: e.target.value || '18:00' }) }), el('span', { class: 'muted' }, 'și'),
          el('input', { type: 'time', class: 'field slim', value: p.limit_to, 'aria-label': 'Până la ora', onchange: e => setPref({ limit_to: e.target.value || '23:00' }) })) : null] : null,
      toggle('Oprește temporar încărcarea', 'Pozele așteaptă până o pornești din nou, de exemplu când ai nevoie de toată conexiunea.', p.paused, async on => { await setPref({ paused: on }); toast(on ? 'Trimiterea e pe pauză.' : 'Trimiterea a pornit.', 'info'); })),

    group('Editorul tău', 'Butonul „Editează” de la poze pune originalele într-un folder și le deschide în programul ales. Ce salvezi peste ele înlocuiește poza din album, fără o a doua aplicație.',
      chips([{ value: 'system', label: 'Programul implicit' }, { value: 'lightroom', label: 'Lightroom Classic' }, { value: 'captureone', label: 'Capture One' }, { value: 'photoshop', label: 'Photoshop' }, { value: 'custom', label: 'Altul' }],
        p.editor, async v => {
          if (v === 'system') await setPref({ editor: v, editor_path: null });
          else {
            let path = v === 'custom' ? null : await invoke('editor_detect', { kind: v });
            if (!path) { toast(v === 'custom' ? 'Alege programul de pe calculator.' : 'Nu l-am găsit în locul obișnuit. Alege-l tu.', 'info'); path = await invoke('editor_pick'); }
            if (!path) return redraw();
            await setPref({ editor: v, editor_path: path });
          }
          redraw();
        }, 'Editorul'),
      p.editor !== 'system' ? kv('Programul', 'Se deschid în el pozele de editat.', el('span', { class: 'path-box inline' }, p.editor_path || 'nealeasă'),
        btn('quiet', null, 'Alege altul', async () => { const f = await invoke('editor_pick'); if (f) { await setPref({ editor_path: f }); redraw(); } })) : el('p', { class: 'muted' }, 'Pozele se deschid în programul pe care îl are calculatorul pentru ele.')),

    group('Siguranță', null,
      toggle('Cere confirmare înainte să șterg poze', 'Albumele se șterg oricum doar scriind numele lor.', ui.get('confirm-delete', true), on => ui.set('confirm-delete', on))),

    group('Ajutor', null,
      el('div', { class: 'row wrap' },
        btn('secondary small', 'external', 'Deschide hsk.photos', () => siteOpen('/fotograf')),
        btn('secondary small', 'command', 'Scurtături de tastatură', shortcutsDialog)))));
}
