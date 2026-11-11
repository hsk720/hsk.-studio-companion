'use strict';
// The account's own page: who the photographer is, how they sign in, the plan, and signing out of this app.

let profile = null;

const saveProfile = later(async () => {
  if (!profile || profile.name.trim().length < 2) return;
  const r = await guard(() => api('PUT', '/api/desktop/profile', { name: profile.name, email: profile.email, phone: profile.phone }));
  if (r) { Object.assign(profile, r); syncAccount(); }
});

/** The sidebar and the rest of the window follow the profile at once. */
function syncAccount() {
  S.account = { ...(S.account || {}), name: profile.name, avatar: profile.avatar, plan: profile.plan };
  drawWho();
}

function drawWho() {
  const a = S.account;
  if (!a) return;
  const b = $('#who');
  b.classList.toggle('on', S.active === 'account');
  b.replaceChildren(avatar(a.name, a.avatar, 34, ui.get('initials', '')), el('span', { class: 'lbl' }, el('b', {}, a.name), el('small', {}, a.owner ? 'administrator' : `plan ${a.plan}`)));
}

/** A picture chosen on the computer is cut to a square of 256 px here, so little is sent. */
function pictureToSquare(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'), side = Math.min(img.width, img.height);
      c.width = c.height = 256;
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.9).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Fișierul nu e o poză pe care o pot citi.')); };
    img.src = url;
  });
}

async function renderAccount() {
  const stage = $('#stage');
  if (S.account && S.account.owner) {
    return stage.replaceChildren(el('div', { class: 'pad stack wide' }, el('h1', {}, 'Cont'),
      group('Administrator', 'Contul de administrator se gestionează din panoul de pe site.', el('div', { class: 'row wrap' }, btn('secondary small', 'external', 'Deschide panoul', () => siteOpen('/fotograf')))),
      signOutGroup()));
  }
  stage.replaceChildren(el('p', { class: 'muted pad' }, 'Se încarcă contul…'));
  profile = await guard(() => api('GET', '/api/desktop/profile'));
  if (!profile) return;
  syncAccount();
  const redraw = () => renderAccount();
  const pick = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: async e => {
    const f = e.target.files[0];
    if (!f) return;
    const data = await guard(() => pictureToSquare(f));
    if (!data) return;
    const r = await guard(() => api('PUT', '/api/desktop/avatar', { image: data }));
    if (r) { Object.assign(profile, r); syncAccount(); redraw(); }
  } });
  const field = (label, key, props) => el('div', {}, el('label', { class: 'lbl' }, label),
    el('input', { class: 'field', value: profile[key] || '', ...props, oninput: e => { profile[key] = e.target.value; saveProfile(); }, onblur: () => saveProfile.now() }));
  const auto = initialsOf(profile.name);
  const initialsInput = el('input', { class: 'field slim', value: ui.get('initials', ''), maxLength: 3, placeholder: auto, style: 'width:90px;text-transform:uppercase',
    'aria-label': 'Inițiale', oninput: e => { ui.set('initials', e.target.value.trim()); drawWho(); redrawAvatar(); } });
  const bigAvatar = el('span', {});
  const redrawAvatar = () => bigAvatar.replaceChildren(avatar(profile.name, profile.avatar, 88, ui.get('initials', '')));
  redrawAvatar();

  stage.replaceChildren(el('div', { class: 'pad stack wide' }, el('h1', {}, 'Cont'),
    S.locked ? el('p', { class: 'hint-box' }, ico('lock'), el('span', {}, 'Aplicația hsk. studio vine cu planurile Activ și Studio. Treci pe Activ ca s-o folosești: apasă „Schimbă planul”.')) : null,
    group('Profil', 'Se salvează singur. Numele apare pe pagina invitaților dacă nu ai un brand setat.',
      el('div', { class: 'profile-head' }, bigAvatar, el('div', { class: 'stack' },
        el('div', { class: 'row' }, btn('secondary small', 'image', profile.avatar ? 'Schimbă poza' : 'Alege o poză', () => pick.click()),
          profile.avatar ? btn('quiet', null, 'Șterge poza', async () => { const r = await guard(() => api('DELETE', '/api/desktop/avatar')); if (r) { Object.assign(profile, r); syncAccount(); redraw(); } }) : null, pick),
        el('p', { class: 'muted' }, profile.avatar ? 'Poza se taie pătrat, din centru.' : 'Fără poză, apar inițialele numelui.'))),
      field('Nume sau numele studioului', 'name', { maxLength: 80, autocomplete: 'organization' }),
      el('div', { class: 'two' }, field('Email', 'email', { type: 'email', maxLength: 120, autocomplete: 'email' }), field('Telefon', 'phone', { type: 'tel', maxLength: 30, autocomplete: 'tel', placeholder: '+40 …' })),
      el('div', { class: 'kv' }, el('span', { class: 'k' }, el('b', {}, 'Inițiale pe avatar'), el('small', { class: 'muted' }, `Alese automat din nume: ${auto}. Scrie altele ca să le schimbi; lasă gol ca să revii la automat.`)), el('span', { class: 'v' }, initialsInput))),

    group('Conectare', profile.has_password ? 'Te poți conecta cu emailul și parola, sau cu codul de acces.' : 'Acum te conectezi doar cu codul de acces. Cu o parolă te poți conecta și cu emailul.',
      el('div', { class: 'kv' }, el('span', { class: 'k' }, el('b', {}, 'Parola'), el('small', { class: 'muted' }, profile.has_password ? `Setată ${fmtDay(profile.password_at)}.` : 'Nu ai setat una.')),
        el('span', { class: 'v' }, btn('secondary small', 'key', profile.has_password ? 'Schimbă parola' : 'Setează o parolă', () => passwordDialog(profile.has_password, redraw)),
          profile.has_password ? btn('quiet', null, 'Scoate parola', () => removePassword(redraw)) : null))),

    planGroup(),

    signOutGroup()));
}

const lei = n => `${nf.format(n)} lei`;
const bytesLabel = n => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB` : `${Math.round(n / 1024 ** 2)} MB`);
const PERIODS = [{ value: 'month', label: 'Lunar' }, { value: 'quarter', label: '3 luni' }, { value: 'year', label: 'Anual' }];
const periodPhrase = (n, interval) => `${lei(n)} ${{ month: 'pe lună', quarter: 'la 3 luni', year: 'pe an' }[interval] || 'pe lună'}`;
const priceIn = (p, interval) => (p.prices && p.prices[interval]) || p.price;

/** The plan: what it includes, how much of it is used, until when it is paid, and one button to change it. */
function planGroup() {
  const box = el('div', { class: 'stack' }, el('p', { class: 'muted' }, 'Se încarcă planul…'));
  const load = () => guard(() => api('GET', '/api/desktop/plan')).then(info => info && box.replaceChildren(...planView(info, load)));
  load();
  return group('Abonament', 'Ce include planul tău, cât ai folosit și până când e plătit.', box);
}

function planView(info, reload) {
  const cur = info.current, b = info.billing, q = info.quota;
  const meter = (label, text, used, limit) => el('div', { class: 'meter' }, el('span', { class: 'k' }, el('b', {}, label), el('small', { class: 'muted' }, text)),
    limit ? el('div', { class: 'bar' }, el('i', { style: `width:${Math.min(100, Math.round((used / limit) * 100))}%` })) : null);
  const paidUntil = b.paid && b.period_end ? (b.cancel_at_period_end ? `se oprește pe ${fmtDay(b.period_end)}` : `plătit până pe ${fmtDay(b.period_end)}`)
    : b.credits != null ? `${plural(b.credits, 'album rămas', 'albume rămase')}${b.valid_until ? `, valabil până pe ${fmtDay(b.valid_until)}` : ''}` : 'fără plată activă';
  const discount = [b.beta_pct ? `reducere Beta −${b.beta_pct}% pe viață` : '', b.loyalty_pct ? `reducere de fidelitate −${b.loyalty_pct}%` : ''].filter(Boolean).join(' · ');
  return [
    el('div', { class: 'plan-now' }, el('div', {}, el('h3', {}, `Plan ${cur.name}`), el('p', { class: 'muted' }, cur.tagline),
      el('p', { class: 'muted' }, [cur.one_time ? lei(cur.price) : periodPhrase(priceIn(cur, b.interval), b.interval), paidUntil, discount].filter(Boolean).join(' · ')))),
    meter('Albume online', cur.max_albums ? `${info.albums} din ${cur.max_albums}` : `${info.albums}, fără limită`, info.albums, cur.max_albums),
    q ? meter('Spațiu', `${bytesLabel(q.used)} din ${bytesLabel(q.limit)}`, q.used, q.limit) : null,
    el('p', { class: 'muted' }, `Până la ${nf.format(cur.max_photos)} de poze într-un album, albumele stau online cel mult ${plural(cur.max_retention, 'zi', 'zile')}.`),
    el('ul', { class: 'ticks' }, cur.features.map(f => el('li', {}, ico('check'), f))),
    el('div', {}, btn('secondary small', 'refresh', 'Schimbă planul', () => changePlanDialog(info, reload))),
    b.can_change ? null : el('p', { class: 'muted' }, 'Contul tău nu are încă un abonament cu card, deci planul nu se poate schimba de aici. Plata online se deschide în curând.'),
  ];
}

/** Upgrade or downgrade in one switch, the period in another, and what happens to the money: applied the moment it is confirmed. */
async function changePlanDialog(info, reload) {
  const cur = info.current, b = info.billing;
  const others = info.plans.filter(p => p.id !== cur.id && !p.one_time);
  const higher = others.filter(p => p.price > cur.price), lower = others.filter(p => p.price <= cur.price);
  const f = { dir: higher.length ? 'up' : 'down', plan: '', interval: b.interval || 'month', busy: false };
  const body = el('div', { class: 'stack' });
  const msg = el('p', { class: 'msg', role: 'alert' });
  const wrap = el('div', { class: 'stack' });
  const draw = () => {
    const list = f.dir === 'up' ? higher : lower;
    if (!list.find(p => p.id === f.plan)) f.plan = list[0] ? list[0].id : '';
    const target = list.find(p => p.id === f.plan);
    wrap.replaceChildren(
      higher.length && lower.length ? segmented([{ value: 'up', label: 'Upgrade' }, { value: 'down', label: 'Downgrade' }], f.dir, v => { f.dir = v; draw(); }, 'Upgrade sau downgrade') : el('p', { class: 'muted' }, f.dir === 'up' ? 'Poți trece pe un plan mai mare.' : 'Ești pe cel mai mare plan; poți trece pe unul mai mic.'),
      el('label', { class: 'lbl' }, 'Planul'), chips(list.map(p => ({ value: p.id, label: `${p.name} · ${lei(priceIn(p, 'month'))}/lună` })), f.plan, v => { f.plan = v; draw(); }, 'Planul'),
      target ? el('p', { class: 'muted' }, [target.tagline.replace(/[.]$/, ''), target.app ? 'Include aplicația hsk. studio' : 'Nu include aplicația hsk. studio: rămâi doar cu pagina Cont'].filter(Boolean).join('. ') + '.') : null,
      el('label', { class: 'lbl' }, 'Perioada'), segmented(PERIODS.map(x => ({ ...x, hint: target ? periodPhrase(priceIn(target, x.value), x.value) : '' })), f.interval, v => { f.interval = v; draw(); }, 'Perioada'),
      target ? el('p', {}, el('b', {}, periodPhrase(priceIn(target, f.interval), f.interval)),
        b.period_end ? ` · acum ești plătit până pe ${fmtDay(b.period_end)}. Planul nou începe imediat, iar diferența pentru perioada rămasă ${f.dir === 'up' ? 'se plătește acum, cu cardul salvat' : 'se scade din următoarea factură'}.` : '') : null);
    go.disabled = !target || !b.can_change || f.busy;
  };
  const go = btn('primary', 'check', 'Schimbă planul', async () => {
    f.busy = true; go.disabled = true; msg.textContent = '';
    try {
      const r = await api('POST', '/api/desktop/plan/change', { plan: f.plan, interval: f.interval });
      closeModal('done');
      const o = r.overview, nb = o.billing;
      toast(`Gata: ai planul ${o.current.name}, ${{ month: 'lunar', quarter: 'la 3 luni', year: 'anual' }[nb.interval]}. Plătit până pe ${fmtDay(nb.period_end)}.`, 'success');
      await refreshAccessAfterPlan();
      reload();
    } catch (e) { msg.textContent = e.message; f.busy = false; draw(); }
  });
  draw();
  await modal({ title: 'Schimbă planul', body: el('div', { class: 'stack' }, wrap, msg, !b.can_change ? el('p', { class: 'muted' }, 'Planul se poate schimba doar pentru conturile cu abonament cu card.') : null), actions: [{ label: 'Renunț', value: false }], extra: go });
}

/** After a change of plan the app may open up (Activ and up) or close down (Debut): the account is read again. */
async function refreshAccessAfterPlan() {
  const me = await guard(() => api('GET', '/api/desktop/me'));
  if (!me) return;
  S.account = { ...(S.account || {}), ...me.account };
  S.me = me;
  const was = S.locked;
  applyLock();
  drawWho();
  if (was && !S.locked) { S.tabs = []; S.active = 'home'; await enterApp(); }
}

function signOutGroup() {
  return group('Această aplicație', 'Albumele rămân pe hsk.photos. Folderul smart se oprește până te conectezi din nou.',
    el('div', {}, btn('danger small', 'arrow-left', 'Deconectează', async () => {
      if (await confirmBox('Deconectezi aplicația?', 'Albumele rămân pe hsk.photos. Folderul smart se oprește până te conectezi din nou.', 'Deconectează')) invoke('auth_sign_out');
    })));
}

async function passwordDialog(has, done) {
  const cur = el('input', { class: 'field', type: 'password', autocomplete: 'current-password', 'aria-label': 'Parola actuală' });
  const a = el('input', { class: 'field', type: 'password', autocomplete: 'new-password', 'aria-label': 'Parola nouă' });
  const b = el('input', { class: 'field', type: 'password', autocomplete: 'new-password', 'aria-label': 'Parola nouă, încă o dată' });
  const msg = el('p', { class: 'msg', role: 'alert' });
  const r = await modal({ title: has ? 'Schimbă parola' : 'Setează o parolă', body: el('div', { class: 'stack' },
    has ? [el('label', { class: 'lbl' }, 'Parola actuală'), cur] : null,
    el('label', { class: 'lbl' }, 'Parola nouă'), a, el('label', { class: 'lbl' }, 'Încă o dată'), b,
    el('p', { class: 'muted' }, 'Cel puțin 10 caractere, nu doar cifre. O frază ușor de ținut minte e mai bună decât un cuvânt cu cifre. Te conectezi cu emailul din profil și această parolă.'), msg),
    actions: [{ label: 'Renunț', value: false }, { label: 'Salvează parola', value: 'ok', primary: true, keepOpen: true }],
    onaction: async v => {
      if (v !== 'ok') return true;
      if (a.value !== b.value) { msg.textContent = 'Cele două parole nu sunt la fel.'; return false; }
      try { await api('PUT', '/api/desktop/password', { current: cur.value, new: a.value }); return true; } catch (e) { msg.textContent = e.message; return false; }
    } });
  if (r === 'ok') { toast('Parola a fost setată.', 'success'); done(); }
}

async function removePassword(done) {
  const cur = el('input', { class: 'field', type: 'password', autocomplete: 'current-password', 'aria-label': 'Parola actuală' });
  const msg = el('p', { class: 'msg', role: 'alert' });
  const r = await modal({ title: 'Scoți parola?', body: el('div', { class: 'stack' }, el('p', {}, 'Te vei conecta din nou doar cu codul de acces.'), el('label', { class: 'lbl' }, 'Parola actuală'), cur, msg),
    actions: [{ label: 'Renunț', value: false }, { label: 'Scoate parola', value: 'ok', primary: true, keepOpen: true }],
    onaction: async v => { if (v !== 'ok') return true; try { await api('DELETE', '/api/desktop/password', { current: cur.value, new: '' }); return true; } catch (e) { msg.textContent = e.message; return false; } } });
  if (r === 'ok') { toast('Parola a fost scoasă.', 'info'); done(); }
}
