'use strict';
// Updates: checked once each time the app opens (and from Setări). A new version shows a button in the top bar;
// the dialog downloads it, checks it and installs it, then the app opens again by itself (updater.rs).

let updateChecked = false;

/** Asks GitHub for the newest version. `quiet`: no message when there is nothing new or the check fails. */
async function checkUpdate(quiet = true) {
  try {
    S.update = await invoke('update_check');
  } catch (e) {
    if (!quiet) toast(e && e.message ? e.message : e, 'error');
    return S.update;
  }
  drawUpdateButton();
  if (!quiet && !S.update.available) toast(`Ai ultima versiune, ${S.update.current}.`, 'success');
  return S.update;
}

/** Once per opening of the app, a few seconds after it starts, so it never slows the start. */
function checkUpdateOnce() {
  if (updateChecked) return;
  updateChecked = true;
  setTimeout(() => checkUpdate(true), 4000);
}

function drawUpdateButton() {
  $('#update-btn')?.remove();
  const u = S.update;
  if (!u || !u.available) return;
  $('#palette-btn').before(el('button', { type: 'button', id: 'update-btn', class: 'update-btn', title: `Versiunea ${u.version} e disponibilă`, onclick: updateDialog },
    ico('download'), el('span', {}, `Actualizează la ${u.version}`)));
}

const mb = n => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace('.', ',')} MB`;

async function updateDialog() {
  const u = S.update;
  if (!u || !u.available) return;
  const notes = (u.notes || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 12);
  const bar = el('i');
  const progress = el('div', { class: 'upd-progress', hidden: true }, el('div', { class: 'bar' }, bar), el('small', { class: 'muted' }, ''));
  const msg = el('p', { class: 'upd-msg', role: 'alert', hidden: true });
  let off = null;
  await modal({
    title: `Versiunea ${u.version} e gata`,
    body: [
      el('p', { class: 'muted' }, `Ai versiunea ${u.current}. Descarc ${mb(u.size)}, verific fișierul și îl instalez. Aplicația se închide și se deschide singură, cu albumele și setările tale neschimbate.`),
      notes.length ? el('div', { class: 'upd-notes' }, el('b', {}, 'Ce e nou'), el('ul', {}, notes.map(l => el('li', {}, l.replace(/^[-*•]\s*/, ''))))) : null,
      progress, msg],
    actions: [{ label: 'Mai târziu', value: false }, { label: 'Actualizează acum', value: 'go', primary: true }],
    onaction: async v => {
      if (v !== 'go') return true;
      const buttons = $$('#dlg .dlg-actions button');
      buttons.forEach(b => { b.disabled = true; });
      msg.hidden = true; progress.hidden = false;
      off = await listen('update-progress', e => {
        const { done, total } = e.payload;
        bar.style.width = total ? `${Math.round(done * 100 / total)}%` : '30%';
        progress.querySelector('small').textContent = total ? `${mb(done)} din ${mb(total)}` : mb(done);
      });
      try {
        const how = await invoke('update_install', { url: u.url, name: u.name, digest: u.digest || null });
        bar.style.width = '100%';
        if (how === 'manual') {
          progress.querySelector('small').textContent = 'Am deschis fișierul descărcat: trage hsk. studio în folderul Applications.';
          buttons.forEach(b => { b.disabled = false; });
          return false;
        }
        progress.querySelector('small').textContent = 'Se instalează. Aplicația se redeschide singură.';
        return false;
      } catch (e) {
        msg.textContent = e && e.message ? e.message : String(e); msg.hidden = false;
        progress.hidden = true;
        buttons.forEach(b => { b.disabled = false; });
        return false;
      } finally {
        if (typeof off === 'function') off();
      }
    },
  });
}

/** The group in Setări: the version on this computer, a check, and the update when there is one. */
function updateGroup(redraw) {
  const u = S.update;
  const line = !u ? 'Nu am verificat încă.'
    : u.available ? `Versiunea ${u.version} e disponibilă: butonul e sus, lângă căutare.` : `Ai ultima versiune.`;
  return group('Actualizări', 'Aplicația verifică singură la fiecare pornire și îți arată un buton sus, lângă căutare, când apare o versiune nouă.',
    el('div', { class: 'kv' }, el('span', { class: 'k' }, el('b', {}, `Versiunea ${u ? u.current : '…'}`), el('small', { class: 'muted' }, line)),
      // with an update, its button is already in the top bar: not repeated here
      u && u.available ? null : el('span', { class: 'v' }, btn('secondary small', 'refresh', 'Verifică acum', async () => { await checkUpdate(false); redraw(); }))));
}
