# hsk. studio

Aplicația de calculator a hsk. photos (macOS și Windows). Fotograful alege un album și folderul în care exportă
din Lightroom sau Capture One; fiecare poză nouă din folder ajunge singură în album. Aplicația stă în bara de
meniu / lângă ceas și lucrează în fundal.

Tauri 2: logica în Rust, fereastra în HTML/CSS/JS simplu (fără bundler), cu fonturile și culorile site-ului.

## Structura

```
ui/                      fereastra: index.html, app.css, app.js, fonts/
src-tauri/
  tauri.conf.json        fereastră, schema hsk://, CSP, installere (dmg, nsis)
  capabilities/          fereastra are voie doar la comenzile aplicației (core:default)
  Info.plist             textele cu care macOS cere acces la Desktop / Documente / discuri externe
  icons/                 iconița aplicației + tray.png (glif pentru bara de meniu)
  src/
    lib.rs               pornire, stare, comenzile pentru fereastră
    auth.rs              conectarea: linkul hsk://, codul scris de mână, deconectarea
    keyring.rs           tokenul, în Keychain (macOS) / Credential Manager (Windows)
    api.rs               apelurile către hsk.photos
    watcher.rs           urmărirea folderului (notify + debounce 1,5 s)
    processor.rs         WebP 2560 px, calitate 82, făcut local
    uploader.rs          coada de trimitere, reîncercări, starea pentru fereastră
    config.rs            setările și lista pozelor deja trimise (JSON în folderul de configurare)
    tray.rs              iconița din bara de meniu / tray și meniul ei
.github/workflows/build.yml   installerele, construite pe GitHub
```

## Conectarea

1. „Conectează-te” deschide `https://hsk.photos/auth/desktop` în browser.
2. Fotograful scrie acolo codul de acces. Site-ul face un cod de asociere de 8 caractere, valabil 5 minute,
   o singură dată, și deschide `hsk://auth?code=XXXXXXXX`.
3. Aplicația schimbă codul pe un token (`POST /api/desktop/claim`) și îl pune în portofelul de parole al sistemului.
4. Dacă linkul nu deschide aplicația, același cod se scrie de mână în fereastră.

Tokenul nu apare niciodată într-un link (ar rămâne în istoricul browserului), nu se scrie pe disc și nu ajunge
în fereastră. Codul de acces al fotografului nu ajunge deloc în aplicație. Deconectarea revocă tokenul și pe server.
Un cont poate avea cel mult 5 calculatoare conectate.

## API-ul folosit (pe server, în /opt/facealbum/app/main.py)

| Apel | Rol |
| --- | --- |
| `POST /api/desktop/authorize` | (site) cod de acces → cod de asociere + link `hsk://` |
| `POST /api/desktop/claim` | cod de asociere → token |
| `GET /api/desktop/me` | contul și limita de mărime pe poză |
| `GET /api/desktop/albums` | albumele active ale contului |
| `DELETE /api/desktop/session` | deconectare |
| `POST /api/albums/{cod}/photos?filename=` | trimiterea unei poze, cu `Authorization: Bearer` |

## Ce face la trimitere

- Ia fișierele `.jpg`, `.jpeg`, `.png`; sare peste fișierele temporare și ascunse.
- Așteaptă ca fișierul să fie scris complet (mărimea nu se mai schimbă).
- **Originalul**: fișierul exact cum a fost exportat. **WebP 2560 px**: o copie mică, făcută local, cu poza
  întoarsă corect după EXIF. Profilul de culoare nu se păstrează în WebP: exportă în sRGB.
- La erori de rețea reîncearcă după 3, 10 și 30 de secunde. Ce nu a reușit se retrimite cu un clic.
- Ține minte ce a trimis (album + cale + mărime + dată), deci o repornire nu retrimite nimic.
  Serverul sare oricum peste duplicate.
- Dacă urmărirea era pornită, repornește odată cu aplicația și ia și pozele exportate între timp.

## Lucru local

Ai nevoie de Rust, Node și, pe Windows, WebView2 (există deja pe Windows 10/11).

```bash
npm install
npm run dev
```

```bash
npm run build
```

`HSK_API_BASE=http://127.0.0.1:8420 npm run dev` leagă o versiune de dezvoltare la alt server.

Verificare fără Mac/Windows (pe server, în Docker, fără Rust instalat pe gazdă):

```bash
docker run --rm -v "$PWD":/app -v hsk-cargo-registry:/usr/local/cargo/registry -w /app/src-tauri rust:1-bookworm bash -c "apt-get update -qq && apt-get install -y -qq libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev pkg-config && cargo test --lib"
```

## Installerele

Se construiesc pe GitHub (`.github/workflows/build.yml`): un tag `v0.1.0` produce `.dmg` pentru Apple Silicon,
`.dmg` pentru Intel și `setup.exe` pentru Windows, într-o versiune ciornă.

Fără semnătură, macOS spune că aplicația „nu poate fi verificată”, iar Windows arată SmartScreen. Pentru lansare:
cont Apple Developer (99 USD/an) pentru semnare și notarizare; certificat de semnare pentru Windows
(sau Azure Trusted Signing). Secretele se pun în GitHub, workflow-ul le folosește deja.

## Planul pe etape

**Etapa 1: conectare și albume** (făcut)
- pagina `/auth/desktop`, codul de asociere, tokenul în portofelul sistemului
- linkul `hsk://` + codul scris de mână
- lista albumelor, deconectare, o singură instanță, iconița din tray

**Etapa 2: folderul urmărit și procesarea locală** (făcut, de testat pe Mac și Windows)
- urmărirea folderului cu subfoldere, coada de trimitere, reîncercări
- originalul sau WebP 2560 px
- starea în fereastră și în tray

**Etapa 3: de făcut**
- prima construire pe GitHub și test pe un Mac și un PC reale (link `hsk://`, portofel, permisiuni de folder)
- semnare și notarizare; pagina de descărcare pe site
- trimitere pe bucăți, reluabilă (are nevoie de un endpoint nou pe server); 2-3 poze în paralel
- pornire odată cu sistemul; actualizare automată
- „calculatoare conectate” în panoul fotografului, cu revocare
- album nou direct din aplicație
- Lightroom: plugin „Publish Service”; Capture One: rețetă de export către folderul urmărit
- WebP acum, originalul mai târziu (înlocuire pe server)

## 2026-11-11 — new UI (preview only, not compiled yet)
- Fixed sidebar, equal-width workspace tabs, attention panel, cover dialog, "Folder smart" page (watched export folder + suggestions for new event folders), categorised app settings. Everything saves by itself; text after the typing stops.
- Notifications and the upload dock share the bottom-right corner (`#corner`). One upload button ("Încarcă poze") explains its options in a dialog; the send mode (originals / web copy) is set only in app settings.
- Rust written but **not compiled**: `inbox.rs`, flat `prefs_get/prefs_set`, `inbox_pending/resolve`, pause, WebP size/quality, per-type notifications, close-to-tray. Run `cargo check` and the tests in Docker before the next tag.
- Still to build: interactive tutorial (asked for at the end).
- 2026-11-11: "Cont" page (`ui/account.js`): profile (name, email, phone, picture), password, plan, sign-out (moved from the sidebar; the sidebar footer is now the avatar + name). Initials come from `initialsOf()` in `core.js` (rules, no model: camel case, titles, company forms and cities ignored; person = first + last name, business = first two words).
- 2026-11-11 (feature batch, UI checked in the preview, Rust **not compiled**):
  - Intro: large "hsk. studio" until everything is loaded (at least 1.7 s), once per start of the app and only when the window is first in front (`ui/boot.js`; `?nosplash` skips it in the preview). With the computer's login the app starts in the tray, and the watched folder resumes after 30 s.
  - Search button with magnifier, "Caută" and the shortcut as the keyboard shows it (⌘ on Mac, Ctrl on Windows).
  - Distribuire: "Selecția clienților" (copy the file names for Lightroom's filter; `.xmp` sidecars with 5 stars + green label next to RAW files: `xmp.rs`), "Mesaj pentru client" (template with {album} {link} {pin}), "Proiecție în sală" (`live.js`, full screen, new photos first, QR). Cartonașele pentru mese: the site's event kit, already linked.
  - Settings: speed limit all day or between two times (`uploader::limit_now`), watermark on web copies (`processor::stamp`), notification for new favourite lists.
  - Queue: SHA-256 made here is compared with the one the server returns (`sha256` added to the upload response) → "verificată cu serverul".
  - Catalog page (`catalog.js`, `catalog.rs`): index of names, dates, camera and lens per disk or folder, searchable while disks are unplugged; list stored as JSON in the config folder.
  - New crates: sha2, chrono, kamadak-exif. Run `cargo check` and `cargo test` in Docker before tagging.
- 2026-11-11: Distribuire has "Cartonașe, afiș și abțibilduri" (PDF from the server, page shown in the window, `save_file` saves to Downloads and opens it). Cont has the plan: what it includes, usage, renewal, other plans with "Cere acest plan" (no online payment yet). New Rust: `save_file` (base64 crate).
- 2026-11-11: plan change popup (Upgrade/Downgrade switch, Lunar / 3 luni / Anual, paid-until date, applied at once) in Cont; locked mode for plans below Activ (only the Cont page). "Retușează" → "Editează"; Setări › "Editorul tău": system default, Lightroom Classic, Capture One, Photoshop or any program (`editors.rs`: detection in the usual folders, else a file picker); `retouch_start` opens the exported originals in it, so one app replaces the separate hsk. editor. Rust uncompiled.
- 2026-11-11: `cargo check` and `cargo test --lib` (Docker rust:1-bookworm, Linux) pass: 14 tests, no warnings. One fix: the expected date in `inbox::days_are_formatted` was wrong (the code was right). Not yet built for macOS/Windows, not committed or tagged.

## Selecție (2026-11-23)

- `src-tauri/src/cull.rs`: the card is measured on every core. RAW → the camera's biggest embedded JPEG (no RAW decoder), turned by the RAW's EXIF; sharpness = variance of the Laplacian, mean of the 3 sharpest tiles of a 6×6 grid, curve `1 - e^(-v/160)`; clipping = share ≥250 or ≤4; dHash; time from EXIF (SubSec when present, else the date text in the first 256 KB, else mtime). Bursts: < 1.5 s apart and dHash distance ≤ 14. A 1600 px preview per frame goes to the app cache (`cull/`), cleared at the next scan.
- Commands: `cull_scan` (emits `cull-progress`), `cull_preview`, `cull_apply` (moves dropped frames with their .xmp/JPEG twin into `Respinse/`, nothing deleted), `cull_style_get` / `cull_style_set` (`cull-style.json` in the config dir).
- `ui/cull-eyes.js`: faces and closed eyes with MediaPipe Face Landmarker (vendored in `ui/vendor/mediapipe`, Apache-2.0, ~18 MB). Needs `'wasm-unsafe-eval'` in script-src and `'self'` in connect-src (tauri.conf.json). Faces < 6% of the width are skipped; closed = both eyeBlink > 0.6. Tested in Chromium with the same CSP on the demo photos (~250 ms per frame).
- `ui/cull.js`: learning = logistic model over [sharp, blink, clip, burst, best-of-burst, faces, sharp²], trained in the window after every "Aplică" on the last 4,000 decisions; decides alone after ≥ 5 albums when the last two matched ≥ 90%; then only frames at 35–65% are shown.
- `ui/tour.js`: tours are now `TOURS.app` (with a Selecție step) and `TOURS.cull` (runs once after the first card; the P/X step lets those keys through).
- **Not compiled.** `cargo test --lib` (6 new tests in cull.rs) must run in Docker before the next tag.

## Tema (2026-11-23)
- Dark is the default theme (`theme.js`, `core.js`, `prefs.js`); light and "Ca sistemul" stay in Setări.
- Dark palette greyed out (variant B): bg #111310, raise #1c1f1a, side glass rgba(62,70,57,.72), sage #66745e, moss #dfe3d8, sel rgba(102,116,94,.3); sidebar glow `saturate(.5) brightness(.85)` in dark only. Light theme unchanged. Not compiled.

## Installerele (2026-11-23, not compiled)
- **Windows: `setup/`** is "hsk. studio Setup", a small Tauri app with our own window (dark, 3 steps: Bun venit → Instalare → Gata; folder, desktop shortcut, start with Windows). It carries Tauri's NSIS installer (`setup/src-tauri/payload/setup-nsis.exe`, copied by the workflow) and runs it silently (`/S /D=<folder>`). Then it creates or removes the desktop shortcut (`mslnk`) and writes or deletes `HKCU\…\Run\hsk. studio = "<exe>" --hidden` (meant to match tauri-plugin-autostart; check on a real PC that the app's switch shows it). Its version comes from the root `package.json`. The UI was tested in Chromium with a mocked `__TAURI__`.
- The NSIS installer keeps dark hsk. images (`src-tauri/installer/nsis-*.bmp`); people see them only in the uninstaller or when running it directly.
- **macOS:** one universal `.dmg` (`--target universal-apple-darwin`) with a dark background (`src-tauri/installer/dmg-background.png`, app at 180,170 and Applications at 480,170).
- Workflow: the Windows job builds the main app, then `setup/` with `--no-bundle`, and uploads `hsk-studio-setup-<version>.exe` to the same draft release (`gh release upload`).
- To check on the first real build: the size of the setup, NSIS silent mode creating its own desktop shortcut, SmartScreen (no signing yet).
