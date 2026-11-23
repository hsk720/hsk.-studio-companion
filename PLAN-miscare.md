# hsk. studio: plan de mișcare și reîmprospătare

**Scopul:** în hsk. studio nimic să nu sară, să nu clipească și să nu te pună să aștepți. Fiecare schimbare are o mișcare scurtă, care îți arată de unde vine lucrul nou și unde s-a dus cel vechi. Mișcarea nu întârzie nimic: datele sunt deja pe ecran, ea doar le așază.

Planul acoperă tot ce se mișcă în aplicație, ecran cu ecran. La final sunt lucrurile care nu se pot face line și ce facem cu ele.

---

## 1. Reguli pentru toată aplicația

| Regula | Ce înseamnă concret |
|---|---|
| **Instant întâi, lin după** | Clicul schimbă datele pe loc, iar animația pornește din acel moment. Nicio animație nu blochează următorul clic. |
| **Trei durate, nu mai multe** | 120 ms pentru apăsări, bife, hover și comutatoare. 200 ms pentru pagini, ferestre, liste și dialoguri. 320 ms pentru intrări mari: vizualizarea pozei, Panoul la pornire, proiecția. |
| **O singură curbă** | Pornește repede și se așază încet (`cubic-bezier(.16, 1, .3, 1)`). Pentru ieșiri folosim aceeași curbă, cu 30% mai scurtă. |
| **Doar poziție și transparență** | Se animă numai deplasarea, mărimea vizuală (scale) și transparența. Așa merg la 60 de cadre pe secundă și pe un laptop slab. Lățimea, înălțimea și marginile nu se animă direct. Când o listă se reașază, folosim tehnica FLIP: fiecare element pornește din locul vechi și alunecă spre cel nou. |
| **Fără „Se încarcă…”** | Unde ceva chiar se încarcă, apare forma lui în gri (schelet), exact la locul și mărimea finală, iar conținutul o înlocuiește cu o estompare. Textul nu mai sare. |
| **Pozele nu apar pe bucăți** | O poză se arată doar după ce e decodată complet, cu o estompare de 160 ms. În vizualizare se vede întâi miniatura mărită și blurată, apoi poza clară se estompează peste ea. |
| **Mai puțină mișcare, la cerere** | Dacă sistemul cere „mai puține animații”, totul devine estompare de 80 ms sau schimbare directă. Fundalul animat din bara laterală se oprește. |
| **Același lucru, aceeași mișcare** | Orice dialog se deschide la fel, orice listă se reașază la fel, orice filă se schimbă la fel. |

Tehnic, construiesc patru unelte comune pe care le folosește toată aplicația:
- `motion.css`: duratele și curba, definite o singură dată;
- `swap()`: schimbarea paginilor, cu animația de schimbare a ecranului din browser (View Transitions) și o estompare simplă unde aceasta lipsește;
- `flip()`: reașezarea listelor;
- `reveal()`: pozele și scheletele.

---

## 2. Ctrl + R (și F5): reîmprospătează doar pagina pe care ești

| Tasta | Ce face |
|---|---|
| **Ctrl + R** / **F5** (pe Mac **⌘R**) | Reîncarcă de pe server doar datele paginii deschise. Locul derulării, selecția, filtrele, fila și poza deschisă rămân neschimbate. Iconița filei se rotește cât durează. Ce s-a schimbat se estompează în noua formă, iar ce e la fel nu se mișcă deloc. |
| **Ctrl + Shift + R** | Repornește toată interfața, ca acum. E pentru urgențe. Înainte să repornească, salvează filele deschise. |

Ce reîmprospătează Ctrl + R pe fiecare pagină:

| Pagina | Ce se reîncarcă |
|---|---|
| Panou | cifrele, „Atenție”, lista de albume, rezumatul asistentului |
| Album › Poze | pozele (cele noi, editate, ascunse), numărul de fețe, coperta |
| Album › Persoane | grupurile de fețe și potrivirile de verificat |
| Album › Distribuire | notițele, sesizările, statisticile, favoritele |
| Album › Setări album | setările salvate pe server; ce scrii acum nu se pierde |
| Folder smart | coada de încărcare și folderele observate |
| Selecție | lista de carduri; un card scanat nu se scanează din nou |
| Catalog | rezultatele căutării curente |
| Finanțe | perioada aleasă |
| Cont | planul, folosirea spațiului, profilul |
| Setări | setările aplicației, din fișierul local |

Bara laterală și antetul se actualizează odată cu pagina, fără să se redeseneze. Dacă reîmprospătarea nu reușește, rămâne ce era pe ecran, plus o notificare scurtă. Pagina nu se golește.

---

## 3. Fiecare mișcare, ecran cu ecran

### 3.1 Pornirea și conectarea
- **Fereastra:** apare abia după ce e desenată, deci fără ecran alb. Acum e deja așa.
- **Ecranul de pornire → aplicație:** logo-ul „hsk. studio” rămâne pe loc și se micșorează spre colțul din stânga sus, în locul lui din bara laterală. Restul interfeței se estompează în jurul lui (320 ms). Nu mai e un ecran care dispare peste altul.
- **Conectarea:** după ce confirmi pe site, butonul „Conectează-te” devine ✓, iar ecranul de bun venit se estompează în Panou. Codul scris de mână se verifică literă cu literă, iar o greșeală face câmpul să tremure scurt.
- **Fără internet:** banda „Ești offline” coboară de sus în 200 ms, iar cele de dedesubt alunecă cu ea. Banda urcă la loc când revine internetul.
- **Pornirea cu Windows (ascunsă):** doar iconița de lângă ceas, fără animații.

### 3.2 Navigarea
- **Paginile din bara laterală** (Panou, Folder smart, Selecție, Catalog, Finanțe, Setări): conținutul vechi se estompează, iar cel nou apare de 8 px mai jos și urcă la locul lui, în 200 ms. Evidențierea din bara laterală alunecă de la elementul vechi la cel nou, nu sare.
- **Filele de sus:**
  - *Deschidere:* fila nouă crește din lățime zero, iar celelalte se dau la o parte.
  - *Comutare:* conținutul se schimbă ca la pagini, iar linia de sub filă alunecă.
  - *Închidere:* fila se strânge, vecinele vin peste locul ei, iar conținutul trece la fila de alături.
  - *Clic din mijloc:* aceeași închidere.
  - *Multe file:* lista de file alunecă singură până la fila activă.
  - *Mutarea cu mouse-ul (nouă):* fila se ridică ușor, celelalte îi fac loc, iar la eliberare se așază.
- **Paginile albumului** (Poze → Persoane → Distribuire → Setări album): paginile alunecă lateral, în ordinea lor. Spre dreapta, conținutul vine din dreapta, iar înapoi vine din stânga. Distanța e de 24 px plus estompare, ca să se înțeleagă ordinea fără să amețească.
- **Sub-meniul unui album în bara laterală:** se desface și se strânge lin (200 ms), iar albumele de dedesubt alunecă.
- **Căutarea rapidă (Ctrl + K):**
  - fereastra coboară 6 px și apare (120 ms), cu fundalul estompat;
  - rezultatele se reașază pe măsură ce scrii, fără să clipească lista;
  - selecția cu săgețile alunecă între rânduri;
  - la Enter, fereastra dispare odată cu schimbarea paginii.
- **Scurtăturile** (Ctrl + 1…9, Ctrl + W, Ctrl + N): fac aceleași mișcări ca un clic.

### 3.3 Bara laterală
- **Căutarea unui album:** albumele care nu se potrivesc se estompează și se strâng, iar cele rămase urcă (FLIP).
- **Album nou:** apare primul în listă, crescând din înălțime zero. Are o umbră sage scurtă, ca să-l vezi.
- **Album șters sau expirat:** se strânge și dispare. Dacă era deschis, fila lui se închide la fel.
- **Numărul de poze:** cifrele se rotesc spre noua valoare, nu sar.
- **Lumina din spatele barei:** rămâne mișcarea lentă de acum.

### 3.4 Panou
- **La deschidere:** blocurile apar pe rând (cifre, asistent, albume, „Atenție”), la 40 ms unul după altul, în 320 ms cu totul. Se întâmplă doar la prima deschidere din sesiune. La revenire, Panoul apare direct, la locul unde l-ai lăsat.
- **Cifrele:** la o schimbare, cifra numără până la noua valoare în 400 ms. Nu se întâmplă la fiecare desenare.
- **„Atenție”:** o problemă nouă intră de sus, iar una rezolvată se strânge și dispare.
- **Asistentul:** răspunsul apare treptat, cu cuvintele estompându-se în timp ce sosesc. Sugestiile de sub el se schimbă cu estompare.
- **Butonul de reîmprospătare:** se rotește cât durează.

### 3.5 Album › Poze
- **Prima încărcare:** grila de schelete are exact numărul și forma pozelor, iar fiecare miniatură se estompează când e decodată. Pozele nu mai apar rând cu rând, de sus în jos.
- **Filtrele** (Toate, Cu fețe, Fără fețe, Notate, Ascunse) și **sortarea:** pozele care rămân alunecă spre locul nou (FLIP), cele care ies se estompează, iar cele noi apar.
- **Mărimea grilei** (glisorul și Ctrl + rotiță): grila se scalează lin și se reașază la eliberare. Poza de sub mouse rămâne sub mouse.
- **Selecția:**
  - bifa crește cu un mic arc (120 ms);
  - Shift + clic selectează un interval, bifele apărând în val;
  - bara de selecție urcă de jos (200 ms), iar numărul din ea se rotește.
- **Ascunde / Arată:** eticheta „Ascunsă” apare peste poză (imediat, cum e deja), iar poza se estompează la 60%. Dacă filtrul curent n-o mai include, iese din grilă și vecinele alunecă peste locul ei.
- **Ștergerea:** pozele se micșorează la 92%, se estompează și se strâng, iar restul grilei alunecă. Ultimele 5 secunde au un buton „Anulează” în notificare (nou).
- **Nota:** stelele cresc pe rând, iar cea apăsată pulsează o dată.
- **Încărcarea:**
  - o poză nouă apare la locul ei în ordine, cu o umbră sage scurtă;
  - bara de progres din colț se umple continuu, nu în trepte;
  - fereastra „Trage aici pozele” se estompează, iar chenarul ei respiră cât ții fișierele deasupra.
- **Editarea:** cât se trimite, poza are eticheta „se trimite”. Când vine versiunea nouă, poza veche se estompează în cea nouă, în același loc.
- **Coperta:** antetul albumului schimbă imaginea cu estompare, iar caseta de copertă păstrează punctul ales.

### 3.6 Vizualizarea pozei
- **Deschiderea:** poza crește din locul miniaturii ei până pe tot ecranul (320 ms), iar fundalul se întunecă. Închiderea face drumul invers, până la miniatura ei. Dacă grila s-a derulat între timp, poza se micșorează spre centru și se estompează.
- **Următoarea / anterioara** (săgeți, butoane): poza alunecă 40 px și se estompează în direcția apăsată. Vecinele sunt pregătite dinainte, deci nu există pauză. Ținând săgeata apăsată, pozele trec repede, fără animație.
- **Calitatea:** întâi miniatura blurată, apoi poza clară.
- **Ascunde, nota, ștergerea din vizualizare:** cum sunt acum, instant. La ștergere, poza pleacă în sus și o aduce pe următoarea.
- **Bara de informații:** se estompează după 2 secunde fără mișcarea mouse-ului și revine la mișcare.

### 3.7 Album › Persoane
- **Fețele** apar ca pozele, după decodare.
- **Unirea a două persoane:** fețele zboară spre persoana țintă (FLIP), iar persoana goală se strânge.
- **Mutarea unei fețe:** la fel, o singură față.
- **Numele:** se scrie direct în rând, fără dialog. Salvarea arată un ✓ care se estompează.
- **„De verificat”:** când rezolvi o potrivire, următoarea alunecă în locul ei.

### 3.8 Album › Distribuire
- **„Copiază linkul”:** butonul devine „✓ Copiat” timp de 1,5 secunde, fără notificare separată.
- **Notițele:** una nouă intră de sus, una rezolvată se estompează la 60% și e tăiată cu o linie animată, iar una ștearsă se strânge.
- **Sesizările:** cea rezolvată se strânge, iar insigna din filă se rotește spre noul număr.
- **Cartonașe, afiș, abțibilduri:** previzualizarea apare cu estompare, cu schelet cât se generează PDF-ul.
- **Favoritele clienților:** lista nouă intră cu evidențiere sage.

### 3.9 Album › Setări album
- **Comutatoarele:** bila alunecă (120 ms), iar fundalul își schimbă culoarea odată cu ea.
- **Alegerile cu 2–4 variante:** pastila sage alunecă de la o variantă la alta, nu sare.
- **Câmpurile de text:** schimbarea se vede deja instant în antet. După salvare, lângă câmp apare „Salvat”, care se estompează după 1,2 secunde.
- **Secțiunile care depind de o alegere** (de exemplu minorii): se desfac și se strâng lin.
- **Ștergerea albumului:** confirmarea, apoi fila se închide și albumul se strânge din listă.

### 3.10 Folder smart și încărcări
- **Coada din colț:** urcă din colț (200 ms). Rândurile se mută din „în așteptare” în „se încarcă” și în „încărcată” fără salturi, iar bara de progres e continuă.
- **„Folder nou observat”:** banda coboară de sus. „Creează albumul” transformă banda în albumul nou din bara laterală.
- **Pauză / Reia:** iconița se schimbă cu rotire, iar bara îngheață sau pornește din nou.

### 3.11 Selecție
- **Scanarea cardului:** bara de progres e continuă. Cadrele apar în banda de jos pe măsură ce sunt măsurate.
- **P / X:**
  - cadrul curent primește un contur sage (păstrat) sau se estompează la 40% (respins), timp de 120 ms;
  - următorul cadru vine imediat, fără pauză;
  - banda de jos alunecă și ține cadrul curent la mijloc. Asta e deja făcut.
- **Rafalele:** se desfac și se strâng lin.
- **„Aplică”:** cadrele respinse zboară spre un contor „Respinse”, iar cele păstrate rămân pe loc.
- **Învățarea:** procentul de potrivire se umple ca o bară.

### 3.12 Catalog
- **Căutarea:** rezultatele vechi rămân până vin cele noi, apoi se schimbă cu estompare. Nu mai apare un ecran gol între ele.
- **Adăugarea unui folder:** rândul intră, iar progresul scanării e continuu.

### 3.13 Finanțe
- **Graficele:** barele cresc de jos la prima desenare (320 ms, pe rând). La schimbarea perioadei se transformă din forma veche în cea nouă, fără să se redeseneze de la zero.
- **Totalurile** numără până la noua valoare.
- **Rândurile noi** intră de sus, iar cele șterse se strâng.

### 3.14 Cont și planul
- **Fereastra de schimbare a planului:** comutatorul Upgrade / Downgrade alunecă, iar prețurile se schimbă cu rotirea cifrelor. Intervalele Lunar, 3 luni și Anual alunecă la fel.
- **Poza de profil:** cea nouă se estompează peste inițiale.

### 3.15 Setări aplicație
- **Tema:** toată fereastra trece de la o temă la alta printr-o estompare de 240 ms, fără clipire.
- **Grupurile:** cele care depind de un comutator (de exemplu notificările) se desfac și se strâng.

### 3.16 Ferestre, notificări, ajutoare
- **Dialogurile:**
  - apar din 98% la 100%, cu estompare (200 ms), iar fundalul se întunecă;
  - la închidere fac drumul invers, în 140 ms;
  - când se schimbă conținutul (de exemplu progresul actualizării), înălțimea crește lin.
- **Notificările din colț:** intră din dreapta, iar cele de deasupra urcă să le facă loc. La ieșire se estompează spre dreapta, iar celelalte coboară.
- **Turul de prezentare:** zona luminată alunecă de la un element la altul (deja făcut), iar cartonașul cu text o urmează.
- **Actualizarea:** butonul „Actualizează” apare sus, lângă căutare, cu o singură pulsare. Progresul descărcării e continuu.
- **Meniurile și indiciile la hover:** apar după 400 ms și se estompează în 120 ms.
- **Butoanele:** la apăsare scad la 97% (80 ms) și revin. Hover-ul își schimbă culoarea în 120 ms.

### 3.17 Proiecția în sală
- **Între poze:** schimbarea e o estompare lungă (1,2 s, cum e acum), plus o apropiere foarte lentă, de 3%, cât stă poza.
- **Bara de control:** apare la mișcarea mouse-ului și dispare după 2 secunde.
- **Pornirea și oprirea:** ecranul se întunecă, apoi apare prima poză.

### 3.18 Derularea (deja făcută, o completez)
- **Rotița:** derularea e lină. E deja făcut.
- **Tastele PageUp / PageDown / Space / Home / End:** aceeași derulare lină.
- **„Înapoi sus”:** după 2 ecrane de derulare apare un buton mic, care urcă lin.
- **Locul derulării:** fiecare pagină și filă își ține minte locul, iar la revenire nu mai pornește de sus.

### 3.19 Albumele foarte mari (peste 1.000 de poze)
- **Grila desenează doar ce se vede,** plus un ecran deasupra și unul dedesubt. Așa derularea rămâne lină și la 10.000 de poze, iar toate mișcările de mai sus funcționează la fel.

---

## 4. Ce nu se poate face lin și ce facem în schimb

| Situația | De ce nu se poate | Ce facem |
|---|---|---|
| Ferestrele sistemului (alegerea unui folder sau fișier, salvarea) | Le desenează Windows sau macOS, nu aplicația | Le deschidem instant. La întoarcere, rezultatul intră cu mișcarea obișnuită. |
| Pornirea „la rece” a aplicației | Motorul ferestrei pornește în 0,5–1,5 s, înainte să existe orice animație | Fereastra rămâne ascunsă până e gata, apoi ecranul de pornire face trecerea în aplicație. |
| Notificările sistemului și meniul de lângă ceas | Le desenează sistemul | Le lăsăm cum sunt. Conținutul lor e scurt și clar. |
| Redimensionarea ferestrei de către sistem | Sistemul trimite mărimile în trepte | Grila se reașază fără animație cât tragi și o dată, lin, la sfârșit. |
| Programul de editare extern (Lightroom etc.) | E altă aplicație | Revenim cu poza nouă estompată peste cea veche, pe loc. |
| Repornirea la actualizare | Aplicația chiar se închide | Fereastra se estompează înainte să se închidă. Installerul hsk. continuă cu aceeași temă și o redeschide. |
| Calculatoarele foarte slabe sau fără placă video | Nu țin 60 de cadre pe secundă | Aplicația măsoară primele animații. Dacă pierde cadre, trece singură pe varianta „mai puțină mișcare”. |
| Prima afișare a unei poze care încă se descarcă | Fișierul nu e încă în calculator | Schelet, apoi miniatura blurată, apoi poza clară. Nu golim ecranul. |
| Mac-uri vechi (macOS 11–12) | Le lipsește animația de schimbare a ecranului (View Transitions) | O estompare simplă, cu aceleași durate. |
| Drag & drop dintre ferestre (de exemplu din Finder) | Sistemul controlează imaginea care se trage | Animăm doar zona de lansare din aplicație. |

---

## 5. Ordinea de lucru

1. **Fundația:** duratele și curba, `swap()`, `flip()`, `reveal()`, scheletele, Ctrl + R pe pagină și „mai puțină mișcare” automat.
2. **Navigarea:** paginile, filele (inclusiv mutarea lor cu mouse-ul), paginile albumului, Ctrl + K, bara laterală.
3. **Albumul:** grila, filtrele, selecția, ștergerea cu „Anulează”, încărcarea, editarea, vizualizarea cu creșterea din miniatură.
4. **Restul paginilor:** Panou, Persoane, Distribuire, Setări album, Folder smart, Selecție, Catalog, Finanțe, Cont, Setări.
5. **Ferestre și detalii:** dialoguri, notificări, butoane, proiecție, derularea cu tastatura, „Înapoi sus”.
6. **Albume foarte mari:** grila care desenează doar ce se vede.
7. **Verificarea:** înregistrez fiecare pagină în previzualizare și măsor cadrele pe secundă. Îți trimit un video scurt cu tot și apoi compilăm.

Eu aș face pașii 1–3 într-o primă versiune, pentru că acolo se simte cea mai mare diferență, și pașii 4–6 în următoarea.

---

## 6. Ce trebuie să decizi

1. **Intensitatea:** *discretă* (distanțe mici, 8–24 px, cum e descris mai sus) sau *mai expresivă* (distanțe mai mari, plus un mic arc la final). Eu recomand discretă, pentru că e o aplicație de lucru, în care stai ore întregi.
2. **Ctrl + Shift + R** rămâne repornirea completă, pentru urgențe? Eu zic da.
3. **Ștergerea cu „Anulează” 5 secunde:** poza se șterge de pe server abia după cele 5 secunde. Ești de acord?
4. **Mutarea filelor cu mouse-ul:** o adaug?
5. **Versiunea 0.4.5** (actualizarea din aplicație, editarea mai rapidă, schimbările instant, derularea lină) o publicăm acum, separat, sau o ținem până e gata și planul acesta?
