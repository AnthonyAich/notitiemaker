# Notitiemaker

Een notitie-app in de browser met whiteboards (notitieblaadjes, tekst, pen en markeerstift) en notebooks met een kaft en pagina's.
De app is gemaakt met gewone HTML, CSS en JavaScript, zonder build-stap. Je host hem gratis op **GitHub Pages** en bewaart de data van al je gebruikers in je eigen **Google Sheet**.

## Wat kan het?

- **Bibliotheek** met Documenten, Favorieten, Whiteboards en Notebooks. Je kunt zoeken in titels en in de tekst van je notities.
- **Whiteboard**: een oneindig canvas met stippen. Je verschuift met slepen of het trackpad en zoomt met knijpen of ⌘/Ctrl + scrollen.
- **Notitieblaadjes** in 6 kleuren, met een titel en een lijst met bolletjes.
  - Tik op een regel om ze te markeren, zoals een to-do die af of belangrijk is.
  - Dubbeltik om te bewerken. Elke regel wordt een bolletje, en twee spaties vooraan laten de regel inspringen.
  - Sleep om te verplaatsen. Met het blauwe bolletje rechtsonder pas je de grootte aan.
- **Pen, markeerstift en gum** met kleuren en diktes. Werkt met de Apple Pencil: zodra je de Pencil gebruikt, verschuift je vinger het canvas in plaats van te tekenen.
  - **Hou de pen even stil** aan het einde van een lijn: ze wordt een perfect rechte lijn, en een getekende rechthoek of cirkel wordt netjes.
- **Vormen en pijlen**: pijl, lijn, rechthoek en ellips. Hou Shift ingedrukt voor een vierkant of cirkel.
- **Lasso**: omcirkel handschrift (en blaadjes) om het te verplaatsen, groter of kleiner te maken (blauw bolletje), van kleur te veranderen, te dupliceren of te verwijderen.
- **Sjablonen**: whiteboards als weekplanner, kanban, vergadering of mindmap; notebooks met Cornell- of weekplanner-papier.
- **Tekstvakken** in handschriftstijl.
- **Stickers** (`K`): 28 ingebouwde SVG-stickers (status, dingen, tape en accenten). Plakken, verslepen, groter maken en draaien met het bolletje erboven.
  - **Eigen stickers**: teken iets, omcirkel het met de lasso en kies **Sticker**. Of voeg een SVG-bestand toe onder *Mijn stickers*. Je eigen stickers synchroniseren mee naar al je toestellen.
- **Tabbladen**: open meerdere notebooks en whiteboards tegelijk. Met + open je een nieuw of bestaand document, met × sluit je een tabblad.
- **Notebooks** met een kaft en gelinieerd, geruit, gestippeld of blanco papier. Nieuwe pagina's voeg je toe met de knop rechtsboven.
- **Ongedaan maken / opnieuw** (⌘Z / ⇧⌘Z), een back-up als .json en het terugzetten ervan.
- **Afdrukken of opslaan als PDF** (⌘P of het printer-icoon): een notebook wordt één A4 per pagina, een whiteboard past op één liggende A4. Kies in het afdrukvenster *Opslaan als PDF*.
- **Prullenbak**: verwijderde documenten blijven 30 dagen bewaard en kun je terugzetten.
- **Versiegeschiedenis** (documentmenu → Versiegeschiedenis): terug naar een eerdere versie. Versies worden bewaard op je toestel en in de Google Sheet.
- **Zoeken in handschrift**: je handschrift wordt herkend met Google tekstherkenning, zodat de zoekbalk het ook vindt.
- **Gebruikers**: iedereen logt in met een eigen gebruikersnaam en wachtwoord en ziet alleen de eigen documenten.
- **Rondleiding**: wie nog geen documenten heeft, krijgt bij de eerste login een whiteboard *Welkom bij Notitiemaker* met uitleg en een oefenblaadje. Terug te openen via **Nieuw → Rondleiding**.
- **Werkt offline**: na het eerste bezoek opent de app ook zonder internet.
- **Op het beginscherm zetten** van je iPad: Safari → Deel → *Zet op beginscherm*. De app opent dan schermvullend.

Sneltoetsen: `V` selecteren, `L` lasso, `P` pen, `H` markeerstift, `S` vormen, `E` gum, `T` tekst, `N` notitieblaadje, `K` stickers, `⌘P` afdrukken, `0` alles in beeld, `+`/`-` zoomen, `⌫` verwijderen, `⌘D` dupliceren, spatiebalk ingedrukt houden om te verschuiven.

## Gebruikers

Iedereen logt in met een **gebruikersnaam en wachtwoord**. Alle gebruikers delen één Google Sheet (die van de beheerder), maar in de app ziet elke gebruiker alleen zijn of haar eigen documenten.

> De beheerder kan in de Google Sheet wel alles lezen. Zeg dat eerlijk tegen de mensen die je toevoegt.

### Een nieuwe gebruiker toevoegen

**In de app** (op elk toestel, ook iPad):
1. Klik linksonder op je naam (of rechtsboven op het wolkje) → **Gebruikers beheren**.
2. Vul een naam in. De gebruikersnaam wordt automatisch ingevuld en er staat al een willekeurig wachtwoord klaar.
3. Klik op **Toevoegen** en daarna op **Kopiëren**. Stuur de gekopieerde tekst (website, gebruikersnaam en wachtwoord) naar de nieuwe gebruiker.

De nieuwe gebruiker opent de website, logt in en kan meteen beginnen. Een eigen wachtwoord kiezen kan via naam → **Wachtwoord wijzigen**.

**Of rechtstreeks in de Google Sheet**: typ een nieuwe rij in het tabblad **Gebruikers**:

| gebruikersnaam | naam | wachtwoord | rol | actief |
| --- | --- | --- | --- | --- |
| yvonne | Yvonne Peeters | een-wachtwoord | user | ja |

De kolommen *aangemaakt* en *id* vult het script zelf in.

Het wachtwoord mag je gewoon leesbaar typen: bij de eerste aanvraag vervangt het script het door een versleutelde versie. Zet `admin` in de kolom *rol* voor een extra beheerder.

### Beheren

In **Gebruikers beheren** kan een beheerder:
- de **naam of gebruikersnaam wijzigen** (de documenten blijven bij die gebruiker);
- een **nieuw wachtwoord** maken (de gebruiker wordt dan overal afgemeld);
- iemand **beheerder** maken of dat terugdraaien (er blijft altijd minstens één beheerder);
- een account **uitschakelen** of weer inschakelen. Een uitgeschakelde gebruiker wordt meteen afgemeld; de documenten blijven in de Sheet staan.

Elke gebruiker heeft in de Sheet een vaste **id** (laatste kolom van *Gebruikers*). Documenten horen bij die id, dus een gebruikersnaam mag je ook rechtstreeks in de Sheet wijzigen. Laat de kolom *id* wel met rust.

Staan er toch documenten bij een gebruikersnaam die niet meer bestaat (bijvoorbeeld van vóór de vaste id's), dan toont **Gebruikers beheren** een blok *Documenten zonder gebruiker*. Kies daar de juiste gebruiker en klik op **Toewijzen**.

Na 5 verkeerde wachtwoorden wordt inloggen voor die gebruikersnaam 10 minuten geblokkeerd. Een sessie blijft 90 dagen geldig.

## Hoe wordt alles bewaard?

1. **Lokaal** in je browser (localStorage), per gebruiker. De app werkt dus ook zonder internet.
2. **In de Google Sheet van de beheerder.** Elke wijziging gaat na 1,5 seconde naar de Sheet. De app synchroniseert ook elke minuut en telkens als je hem opent. Zo blijven je iPad, laptop en telefoon gelijk.

Bij afmelden wordt de lokale kopie gewist (ze staat veilig in de Sheet), behalve als niet alles gesynchroniseerd raakte.

In de Google Sheet staan deze tabbladen:

- **Gebruikers**: gebruikersnaam, naam, versleuteld wachtwoord, rol en of het account actief is.
- **Documenten**: één rij per document, met de eigenaar in de eerste kolom. Kolom `data` (en de kolommen erna) bevat het volledige document als JSON. Pas die niet met de hand aan.
- **Versies**: hoogstens één kopie per uur per document, de laatste 30.
- **Overzicht**: een leesbare lijst van alle blaadjes en regels (en herkend handschrift), per gebruiker, met een kolom *Gemarkeerd*.

**Samenvoegen**: elk blaadje, tekstvak, elke streep en sticker heeft een eigen tijdstempel. Werd een document op twee toestellen tegelijk aangepast (bijvoorbeeld op een iPad die even offline was), dan worden beide versies samengevoegd: nieuwe dingen van beide kanten blijven staan, verwijderingen worden toegepast, en als hetzelfde blaadje aan beide kanten veranderde, wint de laatste wijziging aan dat blaadje.

---

## Installatie

### Stap 1: Google Sheet en Apps Script

1. Maak een nieuwe Google Sheet aan op [sheets.new](https://sheets.new) en geef ze een naam, bijvoorbeeld *Notitiemaker data*.
2. Kies **Extensies → Apps Script**.
3. Verwijder de voorbeeldcode in `Code.gs` en plak de volledige inhoud van [`apps-script/Code.gs`](apps-script/Code.gs). Klik op 💾 Opslaan.
4. Voor **zoeken in handschrift**: klik links naast *Services* op **+**, kies **Drive API** en klik op **Toevoegen**.
5. Klik rechtsboven op **Implementeren → Nieuwe implementatie**.
   - Klik op het tandwiel naast *Type selecteren* en kies **Web-app**.
   - *Uitvoeren als*: **Ik**.
   - *Wie heeft toegang*: **Iedereen**. Dat is nodig zodat de app de URL kan bereiken; zonder gebruikersnaam en wachtwoord kan niemand iets lezen of schrijven.
   - Klik op **Implementeren** en geef toestemming. Google waarschuwt dat de app niet geverifieerd is: kies *Geavanceerd → Ga naar … (onveilig)*. Dat is normaal, want het is je eigen script.
6. Kopieer de **Web-app-URL**. Die eindigt op `/exec`.
7. Open die URL één keer in je browser. Het script maakt dan de tabbladen aan, waaronder **Gebruikers**.
8. Typ in het tabblad **Gebruikers** jezelf als eerste beheerder: je gebruikersnaam, je naam, een wachtwoord en in de kolom *rol* het woord `admin`.

### Stap 2: de URL in de app zetten

Open [`js/config.js`](js/config.js) en zet je Web-app-URL bij `API_URL`. Iedereen die de website opent, gebruikt dan deze server en hoeft niets in te stellen.

### Stap 3: op GitHub Pages zetten

1. Maak op GitHub een nieuwe repository, bijvoorbeeld `notitiemaker`.
2. Upload alle bestanden uit deze map. De screenshots `IMG_*.PNG` zijn niet nodig.
   ```bash
   git init && git add . && git commit -m "Notitiemaker" && git branch -M main
   git remote add origin https://github.com/<jouw-naam>/notitiemaker.git && git push -u origin main
   ```
3. Ga in de repository naar **Settings → Pages**. Kies onder *Build and deployment* **Deploy from a branch**, met branch **main** en map **/ (root)**, en klik op **Save**.
4. Na een minuutje staat de app op `https://<jouw-naam>.github.io/notitiemaker/`. Log in met de beheerder uit stap 1.

De URL in `config.js` is openbaar, en dat is niet erg: zonder geldige gebruikersnaam en wachtwoord geeft het script niets prijs.

### Apps Script bijwerken

Komt er een nieuwe versie van `Code.gs`?

1. Open je Google Sheet → **Extensies → Apps Script**.
2. Vervang de code door de nieuwe [`apps-script/Code.gs`](apps-script/Code.gs) en klik op 💾 Opslaan.
3. Klik op **Implementeren → Implementaties beheren → ✏️ (bewerken) → Versie: Nieuwe versie → Implementeren**. Geef opnieuw toestemming als Google erom vraagt.

De URL blijft dezelfde.

### Overstappen van de versie zonder gebruikers

- Bestaande rijen in **Documenten** en **Versies** krijgen vanzelf een kolom *eigenaar* vooraan. Rijen zonder eigenaar horen bij de **eerste beheerder** in het tabblad *Gebruikers*.
- Notities die nog **lokaal op een toestel** staan, worden bij de eerste login op dat toestel overgenomen door wie daar inlogt. Zo raakt niemand iets kwijt.
- De oude `TOKEN` is niet meer nodig.

## Lokaal testen

```bash
python3 -m http.server 5173
```

Open daarna <http://localhost:5173>. Dubbelklikken op `index.html` werkt niet, omdat JavaScript-modules een webserver nodig hebben.

## Bestanden

| Bestand | Wat |
| --- | --- |
| `index.html` | De pagina |
| `css/styles.css` | Alle opmaak |
| `js/main.js` | Inloggen, bibliotheek, editor-werkbalk, dialogen en routes |
| `js/board.js` | Het canvas: tekenen, blaadjes, tekst, zoomen en ongedaan maken |
| `js/config.js` | Adres van de Apps Script-server |
| `js/store.js` | Lokale opslag, inloggen en synchronisatie met Google Sheets |
| `js/model.js` | Kleuren, kaften en het datamodel |
| `js/ink.js`, `js/thumb.js` | Pennenstreken, vormen, vormherkenning en miniaturen |
| `js/print.js` | Afdrukken en PDF |
| `js/versions.js` | Versiegeschiedenis op het toestel |
| `js/ocr.js` | Handschrift omzetten naar afbeeldingen voor de tekstherkenning |
| `js/fx.js` | Confetti |
| `js/stickers.js` | Ingebouwde stickers, eigen stickers en het opschonen van SVG-uploads |
| `sw.js` | Service worker om offline te werken |
| `apps-script/Code.gs` | De Google Apps Script-backend |
