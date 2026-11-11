// App-shell: bibliotheek, editor, instellingen en synchronisatiestatus.
import { store } from './store.js';
import { Board } from './board.js';
import { newDoc, cloneDoc, welcomeDoc, welcomeContent, WELCOME_VERSION, uid, docText, stickyStats, COVERS, PAPERS, STICKY_COLORS, INK_COLORS, HL_COLORS, BOARD_TEMPLATES } from './model.js';
import { thumbSVG } from './thumb.js';
import { printDoc } from './print.js';
import { listVersions, getVersion, snapshot } from './versions.js';
import { needsOcr, inkSignature, recognize } from './ocr.js';
import { STICKER_CATS, stickerSVG, stickerLabel, ensureStickerDefs, stickerFromSVG } from './stickers.js';
import { esc, icon, dialog, confirmDialog, popMenu, closeMenu, toast, fmtDate } from './ui.js';

const TOOLS = [
  { id: 'select', icon: 'pointer', label: 'Selecteren en verplaatsen', key: 'V' },
  { id: 'lasso', icon: 'lasso', label: 'Lasso: handschrift selecteren', key: 'L' },
  { id: 'pen', icon: 'pen', label: 'Pen · hou stil aan het einde voor een rechte lijn of vorm', key: 'P' },
  { id: 'highlighter', icon: 'highlighter', label: 'Markeerstift', key: 'H' },
  { id: 'shape', icon: 'shapes', label: 'Vormen en pijlen', key: 'S' },
  { id: 'eraser', icon: 'eraser', label: 'Gum', key: 'E' },
  { id: 'text', icon: 'text', label: 'Tekst', key: 'T' },
  { id: 'sticky', icon: 'sticky', label: 'Notitieblaadje', key: 'N' },
  { id: 'sticker', icon: 'sticker', label: 'Stickers', key: 'K' },
];

const SHAPES = [['arrow', 'Pijl'], ['line', 'Lijn'], ['rect', 'Rechthoek'], ['ellipse', 'Ellips']];
const TRASH_DAYS = 30;

// Alleen notebooks en whiteboards; de stickerbibliotheek is ook een (verborgen) document.
const isDoc = d => d.type === 'board' || d.type === 'notebook';

const FILTERS = {
  all: { title: 'Documenten', icon: 'folder', test: d => isDoc(d) && !d.trashedAt },
  fav: { title: 'Favorieten', icon: 'star', test: d => isDoc(d) && !d.trashedAt && d.favorite },
  board: { title: 'Whiteboards', icon: 'board', test: d => !d.trashedAt && d.type === 'board' },
  notebook: { title: 'Notebooks', icon: 'book', test: d => !d.trashedAt && d.type === 'notebook' },
  trash: { title: 'Prullenbak', icon: 'trash', test: d => isDoc(d) && !!d.trashedAt },
};

const S = { filter: 'all', query: '', sort: 'updated', board: null, doc: null, saveTimer: null, dirty: false, ocrError: '', tabs: [], lastTab: null };
const $ = id => document.getElementById(id);

function shell() {
  document.getElementById('app').innerHTML = `
  <section class="login" id="login" hidden>
    <form class="login-card" id="loginForm">
      <div class="brand">${icon('logo')}<span>Notitiemaker</span></div>
      <h1>Inloggen</h1>
      <label class="field"><span>Gebruikersnaam</span><input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
      <label class="field"><span>Wachtwoord</span><input name="password" type="password" autocomplete="current-password" required></label>
      <p class="err-text" id="loginErr" role="alert"></p>
      <button class="btn primary" type="submit">Inloggen</button>
      <p class="muted small">Nog geen account? Vraag de beheerder om er een voor je aan te maken. Je notities worden bewaard in de Google Sheet van de beheerder.</p>
    </form>
  </section>

  <section class="library" id="library" hidden>
    <aside class="sidebar">
      <div class="brand">${icon('logo')}<span>Notitiemaker</span></div>
      <nav>
        ${Object.entries(FILTERS).map(([k, f]) => `<button class="nav-item" data-filter="${k}">${icon(f.icon)}<span>${f.title}</span></button>`).join('')}
      </nav>
      <button class="sync-chip" id="syncChip"></button>
    </aside>
    <main class="lib-main">
      <header class="lib-top">
        <label class="search">${icon('search')}<input id="search" type="search" placeholder="Zoeken in titels, notities en handschrift"></label>
      </header>
      <h1 id="libTitle">Documenten</h1>
      <div class="lib-bar">
        <select id="sort" aria-label="Sorteren">
          <option value="updated">Laatst gewijzigd</option>
          <option value="title">Naam</option>
          <option value="created">Aangemaakt</option>
        </select>
        <button class="btn primary" id="newBtn">${icon('plus')}<span>Nieuw</span></button>
      </div>
      <div id="trashNote"></div>
      <div class="grid" id="grid"></div>
    </main>
  </section>

  <section class="editor" id="editor" hidden>
    <header class="ed-top">
      <div class="ed-tabs">
        <button class="icon-btn" id="homeBtn" title="Terug naar documenten">${icon('home')}</button>
        <div class="ed-tablist" id="tabList" role="tablist"></div>
        <button class="icon-btn" id="newTabBtn" title="Nieuw tabblad" aria-label="Nieuw tabblad">${icon('plus')}</button>
        <button class="icon-btn ed-sync" id="edSync" title="Synchronisatie"></button>
      </div>
      <div class="ed-tools">
        <div class="grp">
          <button class="icon-btn" id="undoBtn" title="Ongedaan maken (⌘Z)">${icon('undo')}</button>
          <button class="icon-btn" id="redoBtn" title="Opnieuw (⇧⌘Z)">${icon('redo')}</button>
        </div>
        <div class="grp tools" id="tools">
          ${TOOLS.map(t => `<button class="tool" data-tool="${t.id}" title="${t.label} (${t.key})" aria-label="${t.label}">${icon(t.icon)}</button>`).join('')}
        </div>
        <div class="grp">
          <button class="icon-btn" id="addPageBtn" title="Pagina toevoegen">${icon('filePlus')}</button>
          <button class="icon-btn" id="printBtn" title="Afdrukken of opslaan als PDF">${icon('printer')}</button>
          <button class="icon-btn" id="fitBtn" title="Alles in beeld (0)">${icon('fit')}</button>
        </div>
      </div>
    </header>
    <div class="ed-body">
      <div class="subbar" id="subbar"></div>
      <div class="board-host" id="boardHost"></div>
      <div class="zoom-pill">
        <button id="zoomOut" aria-label="Uitzoomen">−</button>
        <button id="zoomLabel" title="Alles in beeld">100%</button>
        <button id="zoomIn" aria-label="Inzoomen">+</button>
      </div>
    </div>
  </section>`;
}

// ---------- bibliotheek ----------

function sortedDocs() {
  const f = FILTERS[S.filter];
  const q = S.query.trim().toLowerCase();
  const docs = store.list().filter(d => f.test(d) && (!q || docText(d).includes(q)));
  const by = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    title: (a, b) => a.title.localeCompare(b.title, 'nl'),
  }[S.sort];
  return docs.sort(by);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Nog wakker? 🌙';
  if (h < 12) return 'Goedemorgen ☀️';
  if (h < 18) return 'Goedemiddag 👋';
  return 'Goedenavond 🌆';
}

function progressHTML(d) {
  const { total, done } = stickyStats(d);
  if (!total) return '';
  const pct = Math.round((done / total) * 100);
  return `<div class="progress${done === total ? ' full' : ''}" title="${pct}% gemarkeerd">
    <span class="bar"><i style="width:${pct}%"></i></span>${done}/${total}${done === total ? ' 🎉' : ''}
  </div>`;
}

// Alleen gevonden in de herkende handschrift-tekst?
function foundInInk(d, q) {
  return q && (d.ocr?.text || '').toLowerCase().includes(q) && !docText({ ...d, ocr: null }).includes(q);
}

function trashDaysLeft(d) {
  return Math.max(0, TRASH_DAYS - Math.floor((Date.now() - d.trashedAt) / 86400000));
}

function renderLibrary() {
  $('libTitle').textContent = S.filter === 'all' && !S.query ? greeting() : FILTERS[S.filter].title;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('on', b.dataset.filter === S.filter));
  const q = S.query.trim().toLowerCase();
  const docs = sortedDocs();
  const inTrash = S.filter === 'trash';
  $('trashNote').innerHTML = inTrash && docs.length
    ? `<p class="trash-note">Documenten blijven ${TRASH_DAYS} dagen in de prullenbak en worden daarna definitief verwijderd.
        <button class="btn ghost" id="emptyTrash">${icon('trash')} Prullenbak leegmaken</button></p>`
    : '';
  $('grid').innerHTML = docs.length ? docs.map(d => `
    <article class="card type-${d.type}${d.trashedAt ? ' trashed' : ''}" data-id="${d.id}">
      <div class="thumb-area">
        <div class="thumb" role="button" tabindex="0" aria-label="Open ${esc(d.title)}">
          ${thumbSVG(d)}
          ${inTrash ? '' : `<button class="fav${d.favorite ? ' on' : ''}" data-fav title="Favoriet">${icon(d.favorite ? 'starFill' : 'star')}</button>`}
        </div>
      </div>
      <div class="meta">
        <button class="name" data-menu>${esc(d.title)}${icon('chevron')}</button>
        <div class="date">${inTrash ? `Nog ${trashDaysLeft(d)} dagen` : fmtDate(d.updatedAt)}</div>
        ${inTrash ? '' : progressHTML(d)}
        ${foundInInk(d, q) ? '<span class="ocr-hit">✍️ gevonden in handschrift</span>' : ''}
      </div>
    </article>`).join('')
    : `<div class="empty">${S.query ? 'Niets gevonden.' : inTrash ? 'De prullenbak is leeg.' : 'Nog niets hier. Maak iets met <b>Nieuw</b>.'}</div>`;
}

const coverOptions = selected => Object.entries(COVERS).map(([k, c], i) =>
  `<label class="cover-opt" title="${k}"><input type="radio" name="cover" value="${k}"${(selected ? selected === k : !i) ? ' checked' : ''}><i style="background:linear-gradient(135deg,${c.bg} 42%,${c.accent} 42% 56%,${c.bg} 56%)"></i></label>`).join('');
const paperOptions = selected => Object.entries(PAPERS).map(([k, l]) =>
  `<option value="${k}"${selected === k ? ' selected' : ''}>${l}</option>`).join('');

async function askNotebook() {
  const res = await dialog({
    title: 'Nieuw notebook',
    submit: 'Maken',
    body: `
      <label class="field"><span>Titel</span><input name="title" value="Naamloos notebook" required autofocus></label>
      <div class="field"><span>Kaft</span><div class="covers">${coverOptions()}</div></div>
      <label class="field"><span>Papier</span><select name="paper">${paperOptions('lijnen')}</select></label>`,
  });
  if (!res) return;
  const d = newDoc('notebook', res.title.trim() || 'Naamloos notebook', res);
  store.save(d);
  openDoc(d.id);
}

async function askBoard() {
  const res = await dialog({
    title: 'Nieuw whiteboard',
    submit: 'Maken',
    body: `
      <label class="field"><span>Titel</span><input name="title" value="Naamloos whiteboard" required autofocus></label>
      <div class="field"><span>Sjabloon</span><div class="templates">
        ${Object.entries(BOARD_TEMPLATES).map(([k, t], i) => `<label class="tpl"><input type="radio" name="template" value="${k}"${i ? '' : ' checked'}><span>${t.label}<small>${t.hint}</small></span></label>`).join('')}
      </div></div>`,
  });
  if (!res) return;
  const title = res.title.trim() || 'Naamloos whiteboard';
  const d = newDoc('board', title === 'Naamloos whiteboard' && res.template !== 'leeg' ? BOARD_TEMPLATES[res.template].label : title, res);
  store.save(d);
  openDoc(d.id);
}

async function rename(doc) {
  const res = await dialog({
    title: 'Naam wijzigen',
    submit: 'Opslaan',
    body: `<label class="field"><span>Titel</span><input name="title" value="${esc(doc.title)}" required autofocus></label>`,
  });
  if (!res?.title.trim()) return;
  doc.title = res.title.trim();
  saveNow(doc);
}

async function changeCover(doc) {
  const res = await dialog({
    title: 'Kaft en papier',
    submit: 'Opslaan',
    body: `
      <div class="field"><span>Kaft</span><div class="covers">${coverOptions(doc.cover)}</div></div>
      <label class="field"><span>Papier</span><select name="paper">${paperOptions(doc.paper)}</select></label>`,
  });
  if (!res) return;
  doc.cover = res.cover;
  doc.paper = res.paper;
  saveNow(doc);
}

function downloadJSON(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
}

function importFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      const n = store.importDocs(Array.isArray(data) ? data : [data]);
      toast(n ? `${n} document${n === 1 ? '' : 'en'} geïmporteerd` : 'Geen documenten gevonden in dit bestand', n ? '' : 'err');
      renderLibrary();
    } catch {
      toast('Dit is geen geldig back-upbestand', 'err');
    }
  };
  input.click();
}

// ---------- prullenbak ----------

function moveToTrash(doc) {
  closeTab(doc.id);
  doc.trashedAt = Date.now();
  store.save(doc);
  renderLibrary();
  toast(`"${doc.title}" staat in de prullenbak`);
}

function restoreFromTrash(doc) {
  delete doc.trashedAt;
  store.save(doc);
  renderLibrary();
  toast(`"${doc.title}" is teruggezet`);
}

async function deleteForever(doc) {
  if (await confirmDialog(`"${doc.title}" definitief verwijderen?`, 'Dit kan niet ongedaan gemaakt worden. Het document verdwijnt ook uit je Google Sheet en van je andere toestellen.')) {
    store.remove(doc.id);
    renderLibrary();
  }
}

async function emptyTrash() {
  const docs = store.list().filter(d => d.trashedAt);
  if (!docs.length) return;
  if (await confirmDialog('Prullenbak leegmaken?', `${docs.length} document${docs.length === 1 ? '' : 'en'} definitief verwijderen. Dit kan niet ongedaan gemaakt worden.`, 'Leegmaken')) {
    docs.forEach(d => store.remove(d.id));
    renderLibrary();
  }
}

function purgeOldTrash() {
  for (const d of store.list()) {
    if (d.trashedAt && Date.now() - d.trashedAt > TRASH_DAYS * 86400000) store.remove(d.id);
  }
}

// ---------- versiegeschiedenis ----------

const fmtWhen = at => new Date(at).toLocaleString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function showVersions(doc) {
  flushSave();
  const local = (await listVersions(doc.id)).map(v => ({ ...v, src: 'local' }));
  let cloud = [], note = '';
  if (store.session) {
    try {
      cloud = (await store.request('versions', { id: doc.id })).versions.map(v => ({ ...v, src: 'cloud' }));
    } catch (e) {
      note = /Onbekende actie/.test(e.message)
        ? 'Werk je Apps Script bij (zie README) om versies ook in Google Sheets te bewaren.'
        : `Versies in Google Sheets zijn nu niet beschikbaar: ${e.message}`;
    }
  }
  const rows = [...local, ...cloud].sort((a, b) => b.at - a.at);
  await dialog({
    title: `Versies van "${doc.title}"`,
    submit: 'Sluiten',
    cancel: '',
    body: `
      <p class="muted">Er wordt automatisch een versie bewaard als je een document opent, en terwijl je werkt hoogstens om de 20 minuten. Terugzetten kun je ongedaan maken.</p>
      ${note ? `<p class="warn-text">${esc(note)}</p>` : ''}
      ${rows.length ? `<ul class="versions">${rows.map((v, i) => `
        <li>
          <div class="v-main">
            <div class="v-when">${fmtWhen(v.at)}</div>
            <div class="v-meta">${v.src === 'local' ? 'Op dit toestel' : 'In Google Sheets'}${v.size != null ? ` · ${v.size} onderdelen` : ''}</div>
          </div>
          <button type="button" class="btn ghost" data-restore="${i}">${icon('restore')} Terugzetten</button>
        </li>`).join('')}</ul>` : '<p class="muted">Nog geen eerdere versies.</p>'}`,
    onOpen(d) {
      d.addEventListener('click', e => {
        const b = e.target.closest('[data-restore]');
        if (!b) return;
        d.close();
        restoreVersion(doc, rows[+b.dataset.restore]);
      });
    },
  });
}

async function restoreVersion(doc, v) {
  let old;
  try {
    old = v.src === 'local' ? await getVersion(v.key) : (await store.request('version', { id: doc.id, at: v.at })).doc;
  } catch (e) {
    return toast(e.message, 'err');
  }
  if (!old?.content) return toast('Deze versie kon niet gelezen worden', 'err');
  await snapshot(doc, 0);
  const live = S.doc?.id === doc.id && S.board;
  if (live) S.board.pushUndo(S.board.snapshot());
  doc.content = old.content;
  for (const k of ['title', 'cover', 'paper']) if (old[k] !== undefined) doc[k] = old[k];
  store.save(doc);
  if (live) {
    S.board.load(doc);
    renderTabs();
  } else {
    renderLibrary();
  }
  toast(`Versie van ${fmtWhen(v.at)} teruggezet`);
}

// ---------- handschrift herkennen ----------

const ocrQueue = new Set();
let ocrRunning = false;

function ocrAvailable() {
  return !!store.session && store.api >= 2;
}

function queueOcr(doc) {
  if (!doc || !ocrAvailable() || !needsOcr(doc)) return;
  ocrQueue.add(doc.id);
  runOcr();
}

async function runOcr(onProgress) {
  if (ocrRunning) return;
  ocrRunning = true;
  let done = 0;
  try {
    for (const id of ocrQueue) {
      ocrQueue.delete(id);
      const doc = store.get(id);
      if (!doc || !needsOcr(doc)) continue;
      const res = await recognize(doc, (action, payload) => store.request(action, payload));
      const fresh = store.get(id);
      // Intussen opnieuw getekend? Dan later nog eens.
      if (!fresh || inkSignature(fresh) !== res.sig) continue;
      fresh.ocr = res;
      store.save(fresh);
      onProgress?.(++done);
    }
    S.ocrError = '';
  } catch (e) {
    S.ocrError = e.message;
    console.warn('Handschrift herkennen mislukt:', e.message);
  } finally {
    ocrRunning = false;
  }
}

// ---------- menu's ----------

function docMenuItems(doc) {
  return [
    { icon: 'edit', label: 'Naam wijzigen', action: () => rename(doc) },
    { icon: doc.favorite ? 'star' : 'starFill', label: doc.favorite ? 'Uit favorieten' : 'Aan favorieten toevoegen', action: () => { doc.favorite = !doc.favorite; saveNow(doc); } },
    ...(doc.type === 'notebook' ? [{ icon: 'palette', label: 'Kaft en papier', action: () => changeCover(doc) }] : []),
    { icon: 'printer', label: 'Afdrukken of opslaan als PDF', action: () => { flushSave(); printDoc(doc); } },
    { icon: 'history', label: 'Versiegeschiedenis', action: () => showVersions(doc) },
    { icon: 'download', label: 'Exporteren (.json)', action: () => downloadJSON(`${slug(doc.title)}.json`, doc) },
  ];
}

function cardMenu(anchor, doc) {
  if (doc.trashedAt) {
    popMenu(anchor, [
      { icon: 'restore', label: 'Terugzetten', action: () => restoreFromTrash(doc) },
      '-',
      { icon: 'trash', label: 'Definitief verwijderen', danger: true, action: () => deleteForever(doc) },
    ]);
    return;
  }
  popMenu(anchor, [
    { icon: 'open', label: 'Openen', action: () => openDoc(doc.id) },
    ...docMenuItems(doc),
    { icon: 'copy', label: 'Dupliceren', action: () => { store.save(cloneDoc(doc)); renderLibrary(); } },
    '-',
    { icon: 'trash', label: 'Naar prullenbak', danger: true, action: () => moveToTrash(doc) },
  ]);
}

// ---------- rondleiding ----------

const welcomeId = () => `welkom-${store.session.id || store.session.username}`;

// Opent de rondleiding; maakt ze opnieuw aan als ze weg is, en werkt een oude versie bij.
async function openWelcome() {
  const existing = store.get(welcomeId());
  if (existing) {
    let changed = !!existing.trashedAt;
    delete existing.trashedAt;
    if ((existing.welcomeVersion || 1) < WELCOME_VERSION) {
      changed = true;
      await snapshot(existing, 0); // de oude inhoud blijft terug te halen via Versiegeschiedenis
      existing.content = welcomeContent();
      existing.welcomeVersion = WELCOME_VERSION;
      if (S.doc?.id === existing.id) S.board.load(existing);
      toast('De rondleiding is bijgewerkt met de nieuwste functies');
    }
    if (changed) store.save(existing);
    return openDoc(existing.id);
  }
  const doc = welcomeDoc(store.session.id || store.session.username);
  // Was ze ooit definitief verwijderd, dan is de vaste id bezet.
  if (store.docs[doc.id]) doc.id = uid();
  store.save(doc);
  openDoc(doc.id);
}

// Wie (na de eerste synchronisatie) nog geen enkel document heeft, krijgt de rondleiding.
function maybeWelcome() {
  if (S.welcomeChecked || !store.session || store.status.state !== 'ok') return;
  S.welcomeChecked = true;
  if (Object.values(store.docs).some(d => d.type !== 'stickers')) return;
  const doc = welcomeDoc(store.session.id || store.session.username);
  store.save(doc);
  if (!S.doc) openDoc(doc.id);
}

// ---------- tabbladen ----------

const tabsKey = () => `notitiemaker.tabs.v2.${store.session?.id || store.session?.username}`;

function loadTabs() {
  try { return JSON.parse(localStorage.getItem(tabsKey())) || []; } catch { return []; }
}

function saveTabs() {
  try { localStorage.setItem(tabsKey(), JSON.stringify(S.tabs)); } catch { /* niet erg */ }
}

function tabDocs() {
  // Verwijderde of weggegooide documenten verdwijnen vanzelf uit de tabbladen.
  S.tabs = S.tabs.filter(id => { const d = store.get(id); return d && isDoc(d) && !d.trashedAt; });
  return S.tabs.map(id => store.get(id));
}

function renderTabs() {
  $('tabList').innerHTML = tabDocs().map(d => {
    const on = d.id === S.doc?.id;
    return `<div class="ed-tab${on ? ' on' : ''}" data-id="${d.id}" role="tab" aria-selected="${on}" title="${esc(d.title)}">
      <button class="ed-tab-title">${icon(d.type === 'notebook' ? 'book' : 'board', 'type')}<span>${esc(d.title)}</span>${on ? icon('chevron') : ''}</button>
      <button class="ed-tab-close" title="Tabblad sluiten" aria-label="Sluit ${esc(d.title)}">${icon('x')}</button>
    </div>`;
  }).join('');
  $('tabList').querySelector('.ed-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function closeTab(id) {
  const i = S.tabs.indexOf(id);
  if (i < 0) return;
  S.tabs.splice(i, 1);
  saveTabs();
  if (S.doc?.id === id) {
    const next = S.tabs[i] || S.tabs[i - 1];
    if (next) openDoc(next);
    else location.hash = '';
  } else {
    renderTabs();
  }
}

function newTabMenu(anchor) {
  const recent = store.list()
    .filter(d => isDoc(d) && !d.trashedAt && !S.tabs.includes(d.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);
  popMenu(anchor, [
    { icon: 'book', label: 'Nieuw notebook', action: askNotebook },
    { icon: 'board', label: 'Nieuw whiteboard', action: askBoard },
    ...(recent.length ? ['-', ...recent.map(d => ({ icon: d.type === 'notebook' ? 'book' : 'board', label: d.title, action: () => openDoc(d.id) }))] : []),
  ]);
}

// ---------- editor ----------

function openDoc(id) {
  location.hash = `#/d/${id}`;
}

function saveNow(doc) {
  store.save(doc);
  if (S.doc === doc) {
    renderTabs();
    S.board.renderPages();
  } else {
    renderLibrary();
  }
}

function scheduleSave() {
  S.dirty = true;
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(flushSave, 400);
}

function flushSave() {
  clearTimeout(S.saveTimer);
  if (S.dirty && S.doc) {
    S.dirty = false;
    store.save(S.doc);
    snapshot(S.doc, 20);
  }
}

function showEditor(doc) {
  closeMenu();
  if (S.doc?.id === doc.id) return;
  closeEditor();
  S.doc = doc;
  if (!S.tabs.includes(doc.id)) S.tabs.splice(S.tabs.indexOf(S.lastTab) + 1, 0, doc.id);
  S.lastTab = doc.id;
  saveTabs();
  renderTabs();
  snapshot(doc, 5);
  $('library').hidden = true;
  $('editor').hidden = false;
  $('editor').classList.toggle('is-notebook', doc.type === 'notebook');
  renderTabs();
  $('addPageBtn').hidden = doc.type !== 'notebook';
  document.title = `${doc.title} · Notitiemaker`;
  S.board = new Board($('boardHost'), doc, {
    onChange: scheduleSave,
    onView: z => { $('zoomLabel').textContent = `${Math.round(z * 100)}%`; },
    onHistory: (u, r) => { $('undoBtn').disabled = !u; $('redoBtn').disabled = !r; },
    onToolKey: setTool,
    stickerData,
    onSaveSticker: st => {
      saveCustomSticker(st);
      S.board.setOpt('stickerKey', `c:${st.id}`);
      S.board.setOpt('stickerCat', 'mijn');
      toast('Bewaard bij Mijn stickers ✓ Kies het stickers-icoon om hem te plakken.');
    },
    onMessage: msg => toast(msg),
  });
  setTool(S.board.tool);
}

function closeEditor() {
  if (!S.board) return;
  const doc = S.doc;
  S.board.destroy();
  flushSave();
  S.board = null;
  S.doc = null;
  $('boardHost').innerHTML = '';
  queueOcr(doc);
}

function showLibrary() {
  closeEditor();
  $('editor').hidden = true;
  $('library').hidden = false;
  document.title = 'Notitiemaker';
  renderLibrary();
}

function setTool(t) {
  S.board.setTool(t);
  document.querySelectorAll('#tools .tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  renderSubbar();
}

function renderSubbar() {
  const b = S.board;
  const o = b.opts;
  const swatches = (colors, cur, key) => colors.map(c =>
    `<button class="swatch${c === cur ? ' on' : ''}" style="--c:${c}" data-k="${key}" data-v="${c}" aria-label="Kleur ${c}"></button>`).join('');
  const custom = (key, cur) =>
    `<label class="swatch custom" title="Eigen kleur"><input type="color" data-k="${key}" value="${cur}"></label>`;
  const widths = (list, cur, key, color) => list.map(([w, dot]) =>
    `<button class="width${w === cur ? ' on' : ''}" data-k="${key}" data-v="${w}" data-num aria-label="Dikte ${w}"><i style="width:${dot}px;height:${dot}px;background:${color}"></i></button>`).join('');
  const sep = '<span class="sep"></span>';
  const penWidths = () => widths([[1.5, 4], [3, 7], [5, 11]], o.penWidth, 'penWidth', '#ffffff');
  let h;
  switch (b.tool) {
    case 'pen':
      h = penWidths() + sep + swatches(INK_COLORS, o.penColor, 'penColor') + custom('penColor', o.penColor);
      break;
    case 'shape':
      h = SHAPES.map(([k, l]) => `<button class="shape-kind${o.shapeKind === k ? ' on' : ''}" data-k="shapeKind" data-v="${k}" title="${l}" aria-label="${l}">${icon(k)}</button>`).join('')
        + sep + penWidths() + sep + swatches(INK_COLORS, o.penColor, 'penColor');
      break;
    case 'highlighter':
      h = widths([[12, 7], [20, 11], [32, 16]], o.hlWidth, 'hlWidth', o.hlColor) + sep + swatches(HL_COLORS, o.hlColor, 'hlColor') + custom('hlColor', o.hlColor);
      break;
    case 'text':
      h = [[20, 'A'], [28, 'A'], [40, 'A']].map(([s, l], i) =>
        `<button class="width txt${s === o.textSize ? ' on' : ''}" data-k="textSize" data-v="${s}" data-num style="font-size:${13 + i * 4}px">${l}</button>`).join('')
        + sep + swatches(INK_COLORS, o.textColor, 'textColor') + '<span class="hint">Tik om tekst te plaatsen</span>';
      break;
    case 'sticky':
      h = Object.entries(STICKY_COLORS).map(([k, c]) =>
        `<button class="swatch${k === o.stickyColor ? ' on' : ''}" style="--c:${c.bg}" data-k="stickyColor" data-v="${k}" title="${k}"></button>`).join('')
        + '<span class="hint">Tik om een blaadje te plaatsen</span>';
      break;
    case 'lasso':
      h = '<span class="hint">Omcirkel handschrift om het te verplaatsen · blauw bolletje = groter of kleiner</span>';
      break;
    case 'eraser':
      h = '<span class="hint">Veeg over een lijn om ze te wissen</span>';
      break;
    case 'sticker':
      h = stickerPanelHTML(o);
      break;
    default:
      h = '<span class="hint">Sleep om te verplaatsen · tik op een regel om te markeren · dubbeltik om te bewerken</span>';
  }
  $('subbar').classList.toggle('stickers', b.tool === 'sticker');
  $('subbar').innerHTML = h;
}

// ---------- stickers ----------

const libraryId = () => `stickers-${store.session.id || store.session.username}`;

function customStickers() {
  return store.get(libraryId())?.content.stickers || [];
}

function saveCustomSticker(st) {
  let lib = store.get(libraryId());
  if (!lib) {
    const now = Date.now();
    lib = { id: libraryId(), type: 'stickers', title: 'Mijn stickers', createdAt: now, updatedAt: now, content: { stickers: [] } };
  }
  lib.content.stickers.unshift(st);
  store.save(lib);
}

function removeCustomSticker(id) {
  const lib = store.get(libraryId());
  if (!lib) return;
  lib.content.stickers = lib.content.stickers.filter(s => s.id !== id);
  store.save(lib);
}

// Gegevens om een sticker te plakken: een naam (ingebouwd) of de eigen SVG.
function stickerData(key) {
  if (key?.startsWith('c:')) {
    const st = customStickers().find(s => s.id === key.slice(2));
    return st ? { svg: st.svg, vb: st.vb, w: st.w, h: st.h } : null;
  }
  return { key: key || 'klaar', w: 100, h: 100 };
}

function stickerPanelHTML(o) {
  const cat = o.stickerCat || 'status';
  const tabs = [...STICKER_CATS.map(([k, l]) => [k, l]), ['mijn', 'Mijn stickers']]
    .map(([k, l]) => `<button class="st-tab${k === cat ? ' on' : ''}" data-st-cat="${k}">${l}</button>`).join('');
  let tiles, hint = '<p class="st-hint">Tik op het canvas om de sticker te plakken. Met het pijltje kun je hem daarna verslepen, groter maken en draaien.</p>';
  if (cat === 'mijn') {
    const mine = customStickers();
    tiles = `<button class="st-tile st-add" data-st-upload title="SVG-bestand toevoegen">${icon('upload')}<span>SVG</span></button>`
      + mine.map(st => `<button class="st-tile${o.stickerKey === `c:${st.id}` ? ' on' : ''}" data-k="stickerKey" data-v="c:${st.id}" title="${esc(st.name)}">
          ${stickerSVG(st)}<span class="st-del" data-st-del="${st.id}" title="Verwijderen">×</span></button>`).join('');
    if (!mine.length) hint = '<p class="st-hint">Teken iets, omcirkel het met de lasso en kies <b>Sticker</b>. Of voeg een SVG-bestand toe.</p>';
  } else {
    tiles = (STICKER_CATS.find(c => c[0] === cat) || STICKER_CATS[0])[2]
      .map(k => `<button class="st-tile${o.stickerKey === k ? ' on' : ''}" data-k="stickerKey" data-v="${k}" title="${stickerLabel(k)}" aria-label="${stickerLabel(k)}">${stickerSVG({ key: k })}</button>`).join('');
  }
  return `<div class="st-tabs">${tabs}</div><div class="st-grid">${tiles}</div>${hint}`;
}

function uploadSticker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.svg,image/svg+xml';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const st = stickerFromSVG(await file.text(), file.name.replace(/\.svg$/i, ''));
      saveCustomSticker(st);
      S.board?.setOpt('stickerKey', `c:${st.id}`);
      renderSubbar();
      toast('Sticker toegevoegd ✓');
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  input.click();
}

// ---------- account en synchronisatie ----------

function statusInfo() {
  const { state, message, at } = store.status;
  const map = {
    off: ['cloudOff', 'Niet ingelogd'],
    idle: ['cloud', 'Verbonden'],
    syncing: ['sync', 'Synchroniseren…'],
    ok: ['cloudOk', `Gesynchroniseerd ${new Date(at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}`],
    error: ['cloudErr', message || 'Synchronisatie mislukt'],
  };
  const [ic, label] = map[state];
  return { state, label, html: icon(ic, state === 'syncing' ? 'spin' : '') };
}

function renderStatus() {
  const { state, label, html } = statusInfo();
  const name = store.session?.name || '';
  $('syncChip').innerHTML = `${html}<span>${name ? `<b>${esc(name)}</b>` : ''}${esc(label)}</span>`;
  $('syncChip').className = `sync-chip st-${state}`;
  $('syncChip').title = 'Account en synchronisatie';
  $('edSync').innerHTML = html;
  $('edSync').className = `icon-btn ed-sync st-${state}`;
  $('edSync').title = label;
}

const SITE_URL = () => location.origin + location.pathname;

function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(10)), n => chars[n % chars.length]).join('');
}

function credentialsHTML(title, u, password) {
  const text = `Notitiemaker\n${SITE_URL()}\nGebruikersnaam: ${u.username}\nWachtwoord: ${password}`;
  return `<div class="cred">
    <div class="cred-title">${esc(title)}</div>
    <pre>${esc(text)}</pre>
    <button type="button" class="btn ghost" data-copy="${esc(text)}">${icon('copy')} Kopiëren</button>
  </div>`;
}

async function openAccount() {
  const u = store.session;
  if (!u) return showLogin();
  const st = statusInfo();
  const initials = (u.name || u.username).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  await dialog({
    title: 'Account',
    submit: 'Sluiten',
    cancel: '',
    body: `
      <div class="account-head">
        <span class="avatar">${esc(initials)}</span>
        <div><div class="v-when">${esc(u.name)}</div><div class="v-meta">${esc(u.username)}${u.role === 'admin' ? ' · beheerder' : ''}</div></div>
      </div>
      <div class="row"><span class="sync-line st-${st.state}">${st.html} ${esc(st.label)}</span>
        <button type="button" class="btn ghost" data-sync>${icon('sync')} Nu synchroniseren</button></div>
      <div class="row">
        <button type="button" class="btn ghost" data-pw>${icon('edit')} Wachtwoord wijzigen</button>
        ${u.role === 'admin' ? `<button type="button" class="btn ghost" data-users>${icon('folder')} Gebruikers beheren</button>` : ''}
        <button type="button" class="btn ghost" data-logout>${icon('open')} Afmelden</button>
      </div>
      <hr>
      <p class="muted">Zoeken in handschrift: je pennenstreken worden met Google tekstherkenning gelezen zodra je een document sluit.</p>
      <div class="row"><button type="button" class="btn ghost" data-ocr${ocrAvailable() ? '' : ' disabled'}>${icon('search')} Alle handschrift nu herkennen</button><span class="ocr-out muted">${esc(S.ocrError)}</span></div>
      <hr>
      <div class="row">
        <button type="button" class="btn ghost" data-export>${icon('download')} Back-up downloaden</button>
        <button type="button" class="btn ghost" data-import>${icon('upload')} Back-up terugzetten</button>
      </div>`,
    onOpen(d) {
      d.querySelector('[data-sync]').onclick = async () => {
        await store.sync();
        const s2 = statusInfo();
        d.querySelector('.sync-line').className = `sync-line st-${s2.state}`;
        d.querySelector('.sync-line').innerHTML = `${s2.html} ${esc(s2.label)}`;
      };
      d.querySelector('[data-pw]').onclick = () => { d.close(); changePassword(); };
      d.querySelector('[data-users]')?.addEventListener('click', () => { d.close(); manageUsers(); });
      d.querySelector('[data-logout]').onclick = () => { d.close(); logout(); };
      const ocrOut = d.querySelector('.ocr-out');
      d.querySelector('[data-ocr]').onclick = async () => {
        const todo = store.list().filter(needsOcr);
        if (!todo.length) { ocrOut.textContent = 'Alles is al herkend ✓'; return; }
        todo.forEach(doc => ocrQueue.add(doc.id));
        ocrOut.textContent = `Bezig… 0/${todo.length}`;
        await runOcr(n => { ocrOut.textContent = `Bezig… ${n}/${todo.length}`; });
        ocrOut.textContent = S.ocrError || 'Klaar ✓';
        ocrOut.className = `ocr-out ${S.ocrError ? 'st-error' : 'st-ok'}`;
      };
      d.querySelector('[data-export]').onclick = () => downloadJSON(`notitiemaker-backup-${new Date().toISOString().slice(0, 10)}.json`, store.list());
      d.querySelector('[data-import]').onclick = () => { d.close(); importFile(); };
    },
  });
}

async function changePassword() {
  const res = await dialog({
    title: 'Wachtwoord wijzigen',
    submit: 'Opslaan',
    body: `
      <label class="field"><span>Huidig wachtwoord</span><input name="old" type="password" autocomplete="current-password" required autofocus></label>
      <label class="field"><span>Nieuw wachtwoord (minstens 6 tekens)</span><input name="pw" type="password" autocomplete="new-password" minlength="6" required></label>
      <label class="field"><span>Nieuw wachtwoord herhalen</span><input name="pw2" type="password" autocomplete="new-password" minlength="6" required></label>`,
  });
  if (!res) return;
  if (res.pw !== res.pw2) return toast('De nieuwe wachtwoorden zijn niet hetzelfde', 'err');
  try {
    await store.changePassword(res.old, res.pw);
    toast('Je wachtwoord is gewijzigd');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function logout() {
  closeEditor();
  await store.sync();
  if (store.status.state !== 'ok') {
    const ok = await confirmDialog('Niet alles is gesynchroniseerd',
      'Als je nu afmeldt, blijven je laatste wijzigingen op dit toestel bewaard en worden ze gesynchroniseerd zodra je opnieuw inlogt.', 'Toch afmelden');
    if (!ok) return;
    store.logout({ keepLocal: true });
  } else {
    store.logout();
  }
}

// Beheer van gebruikers (alleen voor beheerders).
async function manageUsers() {
  let users;
  try {
    users = (await store.request('users')).users;
  } catch (e) {
    return toast(e.message, 'err');
  }
  const listHTML = () => users.map(u => `
    <li>
      <div class="v-main">
        <div class="v-when">${esc(u.name)}${u.role === 'admin' ? ' <span class="badge">beheerder</span>' : ''}${u.active ? '' : ' <span class="badge off">uitgeschakeld</span>'}</div>
        <div class="v-meta">${esc(u.username)}</div>
      </div>
      <div class="user-actions">
        <button type="button" class="btn ghost" data-act="rename" data-u="${esc(u.username)}" title="Naam of gebruikersnaam wijzigen">${icon('edit')}<span>Wijzigen</span></button>
        <button type="button" class="btn ghost" data-act="pw" data-u="${esc(u.username)}" title="Nieuw wachtwoord">${icon('restore')}<span>Wachtwoord</span></button>
        <button type="button" class="btn ghost" data-act="role" data-u="${esc(u.username)}">${u.role === 'admin' ? 'Geen beheerder' : 'Beheerder'}</button>
        <button type="button" class="btn ghost" data-act="active" data-u="${esc(u.username)}">${u.active ? 'Uitschakelen' : 'Inschakelen'}</button>
      </div>
    </li>`).join('');

  await dialog({
    title: 'Gebruikers',
    submit: 'Sluiten',
    cancel: '',
    body: `
      <ul class="versions users">${listHTML()}</ul>
      <div class="orphans"></div>
      <hr>
      <h3 class="dlg-sub">Nieuwe gebruiker</h3>
      <div class="grid2">
        <label class="field"><span>Naam</span><input data-f="name" placeholder="bv. Yvonne Peeters"></label>
        <label class="field"><span>Gebruikersnaam</span><input data-f="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="bv. yvonne"></label>
        <label class="field"><span>Wachtwoord</span><input data-f="password" value="${randomPassword()}" autocomplete="off"></label>
        <label class="check"><input type="checkbox" data-f="admin"> Ook beheerder</label>
      </div>
      <div class="row"><button type="button" class="btn primary" data-add>${icon('plus')} Toevoegen</button></div>
      <div class="user-out"></div>`,
    onOpen(d) {
      const f = k => d.querySelector(`[data-f="${k}"]`);
      const out = d.querySelector('.user-out');
      const list = d.querySelector('.users');
      const orphanBox = d.querySelector('.orphans');
      const refresh = async () => {
        users = (await store.request('users')).users;
        list.innerHTML = listHTML();
        await renderOrphans();
      };
      // Documenten waarvan de eigenaar niet meer bestaat (bv. na een gewijzigde gebruikersnaam).
      let orphans = [];
      const renderOrphans = async () => {
        try { orphans = (await store.request('orphans')).orphans; } catch { orphans = []; }
        orphanBox.innerHTML = orphans.length ? `
          <div class="orphan-box">
            <div class="cred-title warn">Documenten zonder gebruiker</div>
            <p class="muted">Deze documenten horen bij een gebruikersnaam die niet meer bestaat. Kies aan wie ze toebehoren.</p>
            ${orphans.map((o, i) => `
              <div class="orphan">
                <div class="v-main"><div class="v-when">"${esc(o.from || 'zonder naam')}" · ${o.count} document${o.count === 1 ? '' : 'en'}</div>
                  <div class="v-meta">${esc(o.titles.join(', '))}${o.count > o.titles.length ? ', …' : ''}</div></div>
                <select data-orphan-to="${i}">${users.map(u => `<option value="${esc(u.username)}"${u.username === store.session.username ? ' selected' : ''}>${esc(u.name)} (${esc(u.username)})</option>`).join('')}</select>
                <button type="button" class="btn primary" data-orphan="${i}">Toewijzen</button>
              </div>`).join('')}
          </div>` : '';
      };
      renderOrphans();
      let typedUsername = false;
      f('username').addEventListener('input', () => { typedUsername = true; });
      f('name').addEventListener('input', () => {
        if (!typedUsername) {
          f('username').value = f('name').value.split(/\s+/)[0].toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]/g, '');
        }
      });
      d.addEventListener('click', async e => {
        const copy = e.target.closest('[data-copy]');
        if (copy) {
          try { await navigator.clipboard.writeText(copy.dataset.copy); copy.lastChild.textContent = ' Gekopieerd ✓'; } catch { /* selecteer het dan zelf */ }
          return;
        }
        if (e.target.closest('[data-add]')) {
          const req = {
            isNew: true,
            username: f('username').value.trim().toLowerCase(),
            name: f('name').value.trim() || f('username').value.trim(),
            password: f('password').value.trim(),
            role: f('admin').checked ? 'admin' : 'user',
          };
          try {
            const { user } = await store.request('saveUser', req);
            out.innerHTML = credentialsHTML(`Account voor ${user.name} aangemaakt ✓ Geef deze gegevens door:`, user, req.password);
            out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            f('name').value = f('username').value = '';
            f('password').value = randomPassword();
            f('admin').checked = false;
            typedUsername = false;
            await refresh();
          } catch (err) {
            out.innerHTML = `<p class="err-text">${esc(err.message)}</p>`;
          }
          return;
        }
        const ob = e.target.closest('[data-orphan]');
        if (ob) {
          const o = orphans[+ob.dataset.orphan];
          const to = d.querySelector(`[data-orphan-to="${ob.dataset.orphan}"]`).value;
          try {
            const { moved } = await store.request('assignOrphans', { from: o.from, to });
            out.innerHTML = `<p class="st-ok">${moved} document${moved === 1 ? '' : 'en'} toegewezen ✓</p>`;
            await renderOrphans();
            store.sync();
          } catch (err) {
            out.innerHTML = `<p class="err-text">${esc(err.message)}</p>`;
          }
          return;
        }
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const u = users.find(x => x.username === b.dataset.u);
        try {
          if (b.dataset.act === 'rename') {
            const res = await dialog({
              title: `${u.name} wijzigen`,
              submit: 'Opslaan',
              body: `
                <label class="field"><span>Naam</span><input name="name" value="${esc(u.name)}" required autofocus></label>
                <label class="field"><span>Gebruikersnaam</span><input name="username" value="${esc(u.username)}" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
                <p class="muted">De documenten blijven bij deze gebruiker, ook met een nieuwe gebruikersnaam.</p>`,
            });
            if (!res) return;
            const { user } = await store.request('saveUser', { username: u.username, name: res.name, newUsername: res.username });
            if (u.username === store.session.username) store.renamed(user);
            out.innerHTML = `<p class="st-ok">Opgeslagen ✓ ${esc(user.name)} logt voortaan in als <b>${esc(user.username)}</b>.</p>`;
          } else if (b.dataset.act === 'pw') {
            // Je eigen wachtwoord wijzig je met je huidige wachtwoord; anders word je afgemeld.
            if (u.id === store.session.id || u.username === store.session.username) {
              d.close();
              return changePassword();
            }
            if (!await confirmDialog(`Nieuw wachtwoord voor ${u.name}?`,
              `Er wordt een nieuw wachtwoord gemaakt. ${u.name} wordt overal afgemeld en kan alleen nog inloggen met het nieuwe wachtwoord.`,
              'Nieuw wachtwoord maken')) return;
            const password = randomPassword();
            await store.request('saveUser', { username: u.username, password });
            out.innerHTML = credentialsHTML(`Nieuw wachtwoord voor ${u.name} ✓ Oude sessies zijn afgemeld.`, u, password);
            out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else if (b.dataset.act === 'role') {
            await store.request('saveUser', { username: u.username, role: u.role === 'admin' ? 'user' : 'admin' });
            out.innerHTML = '';
          } else {
            if (u.active && !await confirmDialog(`${u.name} uitschakelen?`,
              `${u.name} wordt meteen afgemeld en kan niet meer inloggen. De documenten blijven bewaard; je kunt het account later weer inschakelen.`,
              'Uitschakelen')) return;
            await store.request('saveUser', { username: u.username, active: !u.active });
            out.innerHTML = '';
          }
          await refresh();
        } catch (err) {
          out.innerHTML = `<p class="err-text">${esc(err.message)}</p>`;
        }
      });
    },
  });
}

// ---------- inloggen ----------

const LAST_USER_KEY = 'notitiemaker.lastuser';

function showLogin(message = '') {
  closeEditor();
  closeMenu();
  $('library').hidden = true;
  $('editor').hidden = true;
  $('login').hidden = false;
  document.title = 'Inloggen · Notitiemaker';
  $('loginErr').textContent = message;
  const form = $('loginForm');
  try { form.username.value ||= localStorage.getItem(LAST_USER_KEY) || ''; } catch { /* niet erg */ }
  (form.username.value ? form.password : form.username).focus();
}

async function submitLogin(e) {
  e.preventDefault();
  const form = $('loginForm');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Bezig…';
  $('loginErr').textContent = '';
  try {
    await store.login(form.username.value, form.password.value);
    try { localStorage.setItem(LAST_USER_KEY, store.session.username); } catch { /* niet erg */ }
    form.password.value = '';
  } catch (err) {
    $('loginErr').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Inloggen';
  }
}

function startSession() {
  $('login').hidden = true;
  S.tabs = loadTabs();
  purgeOldTrash();
  route();
}

// ---------- routes en events ----------

function route() {
  if (!store.session) return showLogin();
  const m = location.hash.match(/^#\/d\/(.+)$/);
  const doc = m && store.get(decodeURIComponent(m[1]));
  if (doc && isDoc(doc) && !doc.trashedAt) showEditor(doc);
  else {
    if (m) history.replaceState(null, '', location.pathname + location.search);
    showLibrary();
  }
}

function bindEvents() {
  document.querySelector('.sidebar nav').addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    if (b) { S.filter = b.dataset.filter; renderLibrary(); }
  });
  $('search').addEventListener('input', e => { S.query = e.target.value; renderLibrary(); });
  $('sort').addEventListener('change', e => { S.sort = e.target.value; renderLibrary(); });
  $('newBtn').addEventListener('click', e => popMenu(e.currentTarget, [
    { icon: 'book', label: 'Notebook', action: askNotebook },
    { icon: 'board', label: 'Whiteboard', action: askBoard },
    '-',
    { icon: 'help', label: 'Rondleiding', action: openWelcome },
    { icon: 'upload', label: 'Importeren (.json)', action: importFile },
  ]));
  $('trashNote').addEventListener('click', e => { if (e.target.closest('#emptyTrash')) emptyTrash(); });
  $('grid').addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    const doc = store.get(card.dataset.id);
    if (!doc) return;
    if (e.target.closest('[data-fav]')) {
      doc.favorite = !doc.favorite;
      store.save(doc);
      renderLibrary();
    } else if (e.target.closest('[data-menu]')) {
      cardMenu(e.target.closest('[data-menu]'), doc);
    } else if (e.target.closest('.thumb')) {
      if (doc.trashedAt) cardMenu(e.target.closest('.card').querySelector('[data-menu]'), doc);
      else openDoc(doc.id);
    }
  });
  $('grid').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('thumb')) e.target.click();
  });
  $('syncChip').addEventListener('click', openAccount);
  $('edSync').addEventListener('click', openAccount);
  $('loginForm').addEventListener('submit', submitLogin);

  $('homeBtn').addEventListener('click', () => { location.hash = ''; });
  $('tabList').addEventListener('click', e => {
    const tab = e.target.closest('.ed-tab');
    if (!tab) return;
    if (e.target.closest('.ed-tab-close')) return closeTab(tab.dataset.id);
    if (tab.dataset.id !== S.doc?.id) return openDoc(tab.dataset.id);
    const doc = S.doc;
    popMenu(tab, [
      ...docMenuItems(doc),
      '-',
      { icon: 'trash', label: 'Naar prullenbak', danger: true, action: () => moveToTrash(doc) },
    ]);
  });
  // Middelste muisknop sluit een tabblad, zoals in een browser.
  $('tabList').addEventListener('auxclick', e => {
    const tab = e.target.closest('.ed-tab');
    if (tab && e.button === 1) { e.preventDefault(); closeTab(tab.dataset.id); }
  });
  $('newTabBtn').addEventListener('click', e => newTabMenu(e.currentTarget));
  $('tools').addEventListener('click', e => {
    const b = e.target.closest('[data-tool]');
    if (b) setTool(b.dataset.tool);
  });
  $('undoBtn').addEventListener('click', () => S.board.undo());
  $('redoBtn').addEventListener('click', () => S.board.redo());
  $('addPageBtn').addEventListener('click', () => S.board.addPage());
  $('printBtn').addEventListener('click', () => { S.board.finishEdit(); flushSave(); printDoc(S.doc); });
  $('fitBtn').addEventListener('click', () => S.board.fit());
  $('zoomLabel').addEventListener('click', () => S.board.fit());
  $('zoomIn').addEventListener('click', () => S.board.zoomBy(1.25));
  $('zoomOut').addEventListener('click', () => S.board.zoomBy(0.8));
  $('subbar').addEventListener('click', async e => {
    const del = e.target.closest('[data-st-del]');
    if (del) {
      e.stopPropagation();
      if (await confirmDialog('Sticker verwijderen?', 'Hij verdwijnt uit Mijn stickers. Waar je hem al geplakt hebt, blijft hij staan.')) {
        removeCustomSticker(del.dataset.stDel);
        renderSubbar();
      }
      return;
    }
    const tab = e.target.closest('[data-st-cat]');
    if (tab) { S.board.setOpt('stickerCat', tab.dataset.stCat); renderSubbar(); return; }
    if (e.target.closest('[data-st-upload]')) return uploadSticker();
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    S.board.setOpt(b.dataset.k, 'num' in b.dataset ? Number(b.dataset.v) : b.dataset.v);
    renderSubbar();
  });
  $('subbar').addEventListener('change', e => {
    if (e.target.dataset.k) { S.board.setOpt(e.target.dataset.k, e.target.value); renderSubbar(); }
  });

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p' && S.doc) {
      e.preventDefault();
      S.board.finishEdit();
      flushSave();
      printDoc(S.doc);
      return;
    }
    if (!S.board || document.querySelector('dialog[open]')) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (S.board.key(e)) e.preventDefault();
  });
  document.addEventListener('keyup', e => S.board?.keyup(e));

  addEventListener('hashchange', route);
  addEventListener('pagehide', flushSave);
  addEventListener('online', () => store.sync());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { flushSave(); store.sync(); queueOcr(S.doc); }
    else store.sync();
  });
  setInterval(() => { if (!document.hidden) store.sync(); }, 60000);

  store.addEventListener('status', () => { renderStatus(); maybeWelcome(); });
  store.addEventListener('tidied', e => {
    const n = e.detail.count;
    toast(`${n} overbodige conflictkopie${n === 1 ? '' : 'ën'} naar de prullenbak verplaatst: ze bevatten niets wat niet al in een ander document staat`);
    if (!$('library').hidden) renderLibrary();
    if (S.tabs.length) renderTabs();
  });
  const reportedBroken = new Set();
  store.addEventListener('broken', e => {
    const fresh = e.detail.titles.filter(t => !reportedBroken.has(t));
    if (!fresh.length) return;
    fresh.forEach(t => reportedBroken.add(t));
    toast(`In de Google Sheet is de data van ${fresh.map(t => `"${t}"`).join(', ')} beschadigd. Op dit toestel staat er geen kopie van; open de app op een toestel dat het document nog heeft, dan wordt het hersteld.`, 'warn');
  });
  store.addEventListener('conflict', e => {
    const list = e.detail.conflicts;
    for (const c of list) {
      if (S.doc?.id !== c.id) continue;
      // Het open document was een oude kopie: toon de serverversie en zet jouw versie ernaast.
      clearTimeout(S.saveTimer);
      S.dirty = false;
      const fresh = store.get(c.id);
      if (fresh && !fresh.trashedAt) {
        S.doc = fresh;
        S.board.load(fresh);
      }
      if (!S.tabs.includes(c.copyId)) S.tabs.splice(S.tabs.indexOf(c.id) + 1, 0, c.copyId);
      saveTabs();
      renderTabs();
    }
    toast(list.length === 1
      ? `"${list[0].title}" werd intussen op een ander toestel gewijzigd. Jouw versie staat apart als conflictkopie.`
      : `${list.length} documenten werden intussen op een ander toestel gewijzigd. Jouw versies staan apart als conflictkopie.`, 'warn');
  });
  store.addEventListener('session', () => {
    S.welcomeChecked = false;
    renderStatus();
    if (store.session) startSession();
    else showLogin();
  });
  store.addEventListener('auth', e => {
    // Sessie verlopen of account uitgeschakeld: lokale wijzigingen blijven bewaard.
    flushSave();
    store.logout({ keepLocal: true });
    showLogin(e.detail.message);
  });
  store.addEventListener('change', e => {
    if (e.detail.source !== 'remote') return;
    if (S.doc && e.detail.ids.includes(S.doc.id)) {
      const fresh = store.get(S.doc.id);
      if (!fresh || fresh.trashedAt) {
        toast(fresh ? 'Dit document is op een ander toestel naar de prullenbak verplaatst' : 'Dit document is op een ander toestel verwijderd');
        location.hash = '';
      } else if (!S.board.busy() && !S.dirty) {
        S.doc = fresh;
        S.board.load(fresh);
        renderTabs();
      }
    }
    if (!$('library').hidden) renderLibrary();
  });
}

ensureStickerDefs();
shell();
bindEvents();
renderStatus();
if (store.session) {
  startSession();
  store.sync();
} else {
  showLogin();
}
// Lettertypes kunnen na de eerste weergave binnenkomen; daarna klopt de maat van tekst pas.
document.fonts?.ready.then(() => { if (!$('library').hidden) renderLibrary(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
