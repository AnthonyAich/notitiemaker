// App-shell: bibliotheek, editor, instellingen en synchronisatiestatus.
import { store } from './store.js';
import { Board } from './board.js';
import { newDoc, cloneDoc, docText, stickyStats, COVERS, PAPERS, STICKY_COLORS, INK_COLORS, HL_COLORS, BOARD_TEMPLATES } from './model.js';
import { thumbSVG } from './thumb.js';
import { printDoc } from './print.js';
import { listVersions, getVersion, snapshot } from './versions.js';
import { needsOcr, inkSignature, recognize } from './ocr.js';
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
];

const SHAPES = [['arrow', 'Pijl'], ['line', 'Lijn'], ['rect', 'Rechthoek'], ['ellipse', 'Ellips']];
const TRASH_DAYS = 30;

const FILTERS = {
  all: { title: 'Documenten', icon: 'folder', test: d => !d.trashedAt },
  fav: { title: 'Favorieten', icon: 'star', test: d => !d.trashedAt && d.favorite },
  board: { title: 'Whiteboards', icon: 'board', test: d => !d.trashedAt && d.type === 'board' },
  notebook: { title: 'Notebooks', icon: 'book', test: d => !d.trashedAt && d.type === 'notebook' },
  trash: { title: 'Prullenbak', icon: 'trash', test: d => !!d.trashedAt },
};

const S = { filter: 'all', query: '', sort: 'updated', board: null, doc: null, saveTimer: null, dirty: false, ocrError: '', tabs: [], lastTab: null };
const $ = id => document.getElementById(id);

function shell() {
  document.getElementById('app').innerHTML = `
  <section class="library" id="library">
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
  if (store.config.url) {
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
  return !!store.config.url && store.api >= 2;
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

// ---------- tabbladen ----------

const TABS_KEY = 'notitiemaker.tabs.v1';

function loadTabs() {
  try { return JSON.parse(localStorage.getItem(TABS_KEY)) || []; } catch { return []; }
}

function saveTabs() {
  try { localStorage.setItem(TABS_KEY, JSON.stringify(S.tabs)); } catch { /* niet erg */ }
}

function tabDocs() {
  // Verwijderde of weggegooide documenten verdwijnen vanzelf uit de tabbladen.
  S.tabs = S.tabs.filter(id => { const d = store.get(id); return d && !d.trashedAt; });
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
    .filter(d => !d.trashedAt && !S.tabs.includes(d.id))
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
    default:
      h = '<span class="hint">Sleep om te verplaatsen · tik op een regel om te markeren · dubbeltik om te bewerken</span>';
  }
  $('subbar').innerHTML = h;
}

// ---------- synchronisatie ----------

function renderStatus() {
  const { state, message, at } = store.status;
  const map = {
    off: ['cloudOff', 'Alleen lokaal: koppel Google Sheets'],
    idle: ['cloud', 'Google Sheets gekoppeld'],
    syncing: ['sync', 'Synchroniseren…'],
    ok: ['cloudOk', `Gesynchroniseerd ${new Date(at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}`],
    error: ['cloudErr', message || 'Synchronisatie mislukt'],
  };
  const [ic, label] = map[state];
  const html = icon(ic, state === 'syncing' ? 'spin' : '');
  $('syncChip').innerHTML = `${html}<span>${esc(label)}</span>`;
  $('syncChip').className = `sync-chip st-${state}`;
  $('edSync').innerHTML = html;
  $('edSync').className = `icon-btn ed-sync st-${state}`;
  $('edSync').title = label;
}

async function openSettings() {
  const c = store.config;
  const oldScript = c.url && store.api === 1;
  await dialog({
    title: 'Google Sheets-koppeling',
    submit: 'Opslaan',
    body: `
      <p class="muted">Je notities worden altijd op dit toestel bewaard. Koppel een Google Sheet om ze te bewaren in de cloud en te synchroniseren tussen toestellen. Hoe je dat instelt, staat in de README.</p>
      <label class="field"><span>Web-app URL (Apps Script)</span><input name="url" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c.url)}"></label>
      <label class="field"><span>Token (staat bovenaan Code.gs)</span><input name="token" type="password" autocomplete="off" value="${esc(c.token)}"></label>
      <div class="row"><button type="button" class="btn ghost" data-test>${icon('sync')} Verbinding testen</button><span class="test-out muted"></span></div>
      ${store.status.state === 'error' ? `<p class="err-text">${esc(store.status.message)}</p>` : ''}
      ${oldScript ? '<p class="warn-text">Je Apps Script is een oudere versie. Werk het bij (README → "Apps Script bijwerken") voor versies in de cloud en zoeken in handschrift.</p>' : ''}
      <hr>
      <p class="muted">Zoeken in handschrift: je pennenstreken worden met Google tekstherkenning gelezen zodra je een document sluit.</p>
      <div class="row"><button type="button" class="btn ghost" data-ocr${ocrAvailable() ? '' : ' disabled'}>${icon('search')} Alle handschrift nu herkennen</button><span class="ocr-out muted">${esc(S.ocrError)}</span></div>
      <hr>
      <div class="row">
        <button type="button" class="btn ghost" data-export>${icon('download')} Back-up downloaden</button>
        <button type="button" class="btn ghost" data-import>${icon('upload')} Back-up terugzetten</button>
      </div>`,
    onOpen(d) {
      const out = d.querySelector('.test-out');
      d.querySelector('[data-test]').onclick = async () => {
        out.textContent = 'Bezig…';
        out.className = 'test-out muted';
        try {
          const res = await store.test(d.querySelector('[name=url]').value.trim(), d.querySelector('[name=token]').value.trim());
          out.textContent = res.api >= 2 ? 'Verbinding werkt ✓' : 'Verbinding werkt ✓ (oudere scriptversie)';
          out.className = 'test-out st-ok';
        } catch (e) {
          out.textContent = e.message;
          out.className = 'test-out st-error';
        }
      };
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
  }).then(res => {
    if (res) store.setConfig({ url: res.url.trim(), token: res.token.trim() });
  });
}

// ---------- routes en events ----------

function route() {
  const m = location.hash.match(/^#\/d\/(.+)$/);
  const doc = m && store.get(decodeURIComponent(m[1]));
  if (doc && !doc.trashedAt) showEditor(doc);
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
  $('syncChip').addEventListener('click', openSettings);
  $('edSync').addEventListener('click', openSettings);

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
  $('subbar').addEventListener('click', e => {
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

  store.addEventListener('status', renderStatus);
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

shell();
S.tabs = loadTabs();
bindEvents();
purgeOldTrash();
renderStatus();
route();
store.sync();
// Lettertypes kunnen na de eerste weergave binnenkomen; daarna klopt de maat van tekst pas.
document.fonts?.ready.then(() => { if (!$('library').hidden) renderLibrary(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
