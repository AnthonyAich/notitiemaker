# Notitiemaker

Een notitie-app in de browser met whiteboards (notitieblaadjes, tekst, pen en markeerstift) en notebooks met een kaft en pagina's.
De app is gemaakt met gewone HTML, CSS en JavaScript, zonder build-stap. Je host hem gratis op **GitHub Pages** en bewaart de data in je eigen **Google Sheet**.

## Wat kan het?

- **Bibliotheek** met Documenten, Favorieten, Whiteboards en Notebooks. Je kunt zoeken in titels en in de tekst van je notities.
- **Whiteboard**: een oneindig canvas met stippen. Je verschuift met slepen of het trackpad en zoomt met knijpen of ⌘/Ctrl + scrollen.
- **Notitieblaadjes** in 6 kleuren, met een titel en een lijst met bolletjes.
  - Tik op een regel om ze te markeren, zoals een to-do die af of belangrijk is.
  - Dubbeltik om te bewerken. Elke regel wordt een bolletje, en twee spaties vooraan laten de regel inspringen.
  - Sleep om te verplaatsen. Met het blauwe bolletje rechtsonder pas je de grootte aan.
- **Pen, markeerstift en gum** met kleuren en diktes. Werkt met de Apple Pencil: zodra je de Pencil gebruikt, verschuift je vinger het canvas in plaats van te tekenen.
- **Tekstvakken** in handschriftstijl.
- **Notebooks** met een kaft en gelinieerd, geruit, gestippeld of blanco papier. Nieuwe pagina's voeg je toe met de knop rechtsboven.
- **Ongedaan maken / opnieuw** (⌘Z / ⇧⌘Z), een back-up als .json en het terugzetten ervan.
- **Op het beginscherm zetten** van je iPad: Safari → Deel → *Zet op beginscherm*. De app opent dan schermvullend.

Sneltoetsen: `V` selecteren, `P` pen, `H` markeerstift, `E` gum, `T` tekst, `N` notitieblaadje, `0` alles in beeld, `+`/`-` zoomen, `⌫` verwijderen, `⌘D` dupliceren, spatiebalk ingedrukt houden om te verschuiven.

## Hoe wordt alles bewaard?

1. **Altijd lokaal** in je browser (localStorage). De app werkt dus ook zonder internet.
2. **Optioneel in Google Sheets.** Elke wijziging gaat na 1,5 seconde naar je sheet. De app synchroniseert ook elke minuut en telkens als je hem opent. Zo blijven je iPad, laptop en telefoon gelijk.

In de Google Sheet verschijnen twee tabbladen:

- **Documenten**: één rij per document. Kolom `data` (en de kolommen erna) bevat het volledige document als JSON. Pas die niet met de hand aan.
- **Overzicht**: een leesbare lijst van al je blaadjes en regels, met een kolom *Gemarkeerd*. Handig om te filteren of af te drukken.

Bij een conflict wint de laatste wijziging: als je hetzelfde document tegelijk op twee toestellen bewerkt, blijft de versie die het laatst bewaard werd.

---

## Installatie

### Stap 1: Google Sheet en Apps Script

1. Maak een nieuwe Google Sheet aan op [sheets.new](https://sheets.new) en geef ze een naam, bijvoorbeeld *Notitiemaker data*.
2. Kies **Extensies → Apps Script**.
3. Verwijder de voorbeeldcode in `Code.gs` en plak de volledige inhoud van [`apps-script/Code.gs`](apps-script/Code.gs).
4. Verander bovenaan `const TOKEN = 'VERANDER-MIJ';` in een lang, zelfgekozen wachtwoord, bijvoorbeeld `'zon-fiets-banaan-8274-kast'`. Klik op 💾 Opslaan.
5. Klik rechtsboven op **Implementeren → Nieuwe implementatie**.
   - Klik op het tandwiel naast *Type selecteren* en kies **Web-app**.
   - *Uitvoeren als*: **Ik**.
   - *Wie heeft toegang*: **Iedereen**. Dat is nodig zodat de app de URL kan bereiken; zonder je token kan niemand iets lezen of schrijven.
   - Klik op **Implementeren** en geef toestemming. Google waarschuwt dat de app niet geverifieerd is: kies *Geavanceerd → Ga naar … (onveilig)*. Dat is normaal, want het is je eigen script.
6. Kopieer de **Web-app-URL**. Die eindigt op `/exec`.

> Pas je `Code.gs` later aan? Kies dan **Implementeren → Implementaties beheren → ✏️ → Versie: Nieuwe versie**. Zo blijft de URL dezelfde.

### Stap 2: op GitHub Pages zetten

1. Maak op GitHub een nieuwe repository, bijvoorbeeld `notitiemaker`.
2. Upload alle bestanden uit deze map: `index.html`, `css/`, `js/`, `apps-script/`, `icon.svg`, `icon-180.png`, `manifest.webmanifest`, `.nojekyll` en `README.md`. De screenshots `IMG_*.PNG` zijn niet nodig.
   - Via de website: *Add file → Upload files* en sleep de bestanden erin.
   - Of via de terminal:
     ```bash
     git init && git add . && git commit -m "Notitiemaker" && git branch -M main
     git remote add origin https://github.com/<jouw-naam>/notitiemaker.git && git push -u origin main
     ```
3. Ga in de repository naar **Settings → Pages**. Kies onder *Build and deployment* **Deploy from a branch**, met branch **main** en map **/ (root)**, en klik op **Save**.
4. Na een minuutje staat de app op `https://<jouw-naam>.github.io/notitiemaker/`.

### Stap 3: koppelen

1. Open de app en klik op het **wolkje**: linksonder in de bibliotheek, of rechtsboven in een document.
2. Plak de Web-app-URL en je token, en klik op **Verbinding testen**.
3. Klik op **Opslaan**. Het wolkje krijgt een vinkje zodra alles gesynchroniseerd is.
4. Herhaal stap 1 tot 3 op elk toestel. Gebruik dezelfde URL en token, en je ziet overal dezelfde notities.

De URL en de token staan alleen in de browser van je toestel, niet in de code op GitHub. Je repository mag dus gerust openbaar zijn.

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
| `js/main.js` | Bibliotheek, editor-werkbalk, dialogen en routes |
| `js/board.js` | Het canvas: tekenen, blaadjes, tekst, zoomen en ongedaan maken |
| `js/store.js` | Lokale opslag en synchronisatie met Google Sheets |
| `js/model.js` | Kleuren, kaften en het datamodel |
| `js/ink.js`, `js/thumb.js` | Pennenstreken en miniaturen |
| `apps-script/Code.gs` | De Google Apps Script-backend |
