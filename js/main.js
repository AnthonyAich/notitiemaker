// App-shell: bibliotheek, editor, instellingen en synchronisatiestatus.
import { store } from './store.js';
import { Board } from './board.js';
import { newDoc, cloneDoc, docText, stickyStats, COVERS, PAPERS, STICKY_COLORS, INK_COLORS, HL_COLORS } from './model.js';
import { thumbSVG } from './thumb.js';
import { esc, icon, dialog, confirmDialog, popMenu, closeMenu, toast, fmtDate } from './ui.js';

const TOOLS = [
  { id: 'select', icon: 'pointer', label: 'Selecteren en verplaatsen', key: 'V' },
  { id: 'pen', icon: 'pen', label: 'Pen', key: 'P' },
  { id: 'highlighter', icon: 'highlighter', label: 'Markeerstift', key: 'H' },
  { id: 'eraser', icon: 'eraser', label: 'Gum', key: 'E' },
  { id: 'text', icon: 'text', label: 'Tekst', key: 'T' },
  { id: 'sticky', icon: 'sticky', label: 'Notitieblaadje', key: 'N' },
];

const FILTERS = {
  all: { title: 'Documenten', test: () => true },
  fav: { title: 'Favorieten', test: d => d.favorite },
  board: { title: 'Whiteboards', test: d => d.type === 'board' },
  notebook: { title: 'Notebooks', test: d => d.type === 'notebook' },
};

const S = { filter: 'all', query: '', sort: 'updated', board: null, doc: null, saveTimer: null, dirty: false };
const $ = id => document.getElementById(id);

function shell() {
  document.getElementById('app').innerHTML = `
  <section class="library" id="library">
    <aside class="sidebar">
      <div class="brand">${icon('logo')}<span>Notitiemaker</span></div>
      <nav>
        ${Object.entries(FILTERS).map(([k, f]) => `<button class="nav-item" data-filter="${k}">${icon({ all: 'folder', fav: 'star', board: 'board', notebook: 'book' }[k])}<span>${f.title}</span></button>`).join('')}
      </nav>
      <button class="sync-chip" id="syncChip"></button>
    </aside>
    <main class="lib-main">
      <header class="lib-top">
        <label class="search">${icon('search')}<input id="search" type="search" placeholder="Zoeken in titels en notities"></label>
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
      <div class="grid" id="grid"></div>
    </main>
  </section>

  <section class="editor" id="editor" hidden>
    <header class="ed-top">
      <div class="ed-tabs">
        <button class="icon-btn" id="homeBtn" title="Terug naar documenten">${icon('home')}</button>
        <button class="ed-title" id="docTitle" title="Naam wijzigen"></button>
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

function renderLibrary() {
  $('libTitle').textContent = S.filter === 'all' && !S.query ? greeting() : FILTERS[S.filter].title;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('on', b.dataset.filter === S.filter));
  const docs = sortedDocs();
  $('grid').innerHTML = docs.length ? docs.map(d => `
    <article class="card type-${d.type}" data-id="${d.id}">
      <div class="thumb-area">
        <div class="thumb" role="button" tabindex="0" aria-label="Open ${esc(d.title)}">
          ${thumbSVG(d)}
          <button class="fav${d.favorite ? ' on' : ''}" data-fav title="Favoriet">${icon(d.favorite ? 'starFill' : 'star')}</button>
        </div>
      </div>
      <div class="meta">
        <button class="name" data-menu>${esc(d.title)}${icon('chevron')}</button>
        <div class="date">${fmtDate(d.updatedAt)}</div>
        ${progressHTML(d)}
      </div>
    </article>`).join('')
    : `<div class="empty">${S.query ? 'Niets gevonden.' : 'Nog niets hier. Maak iets met <b>Nieuw</b>.'}</div>`;
}

async function askNotebook() {
  const res = await dialog({
    title: 'Nieuw notebook',
    submit: 'Maken',
    body: `
      <label class="field"><span>Titel</span><input name="title" value="Naamloos notebook" required autofocus></label>
      <div class="field"><span>Kaft</span><div class="covers">
        ${Object.entries(COVERS).map(([k, c], i) => `<label class="cover-opt" title="${k}"><input type="radio" name="cover" value="${k}"${i ? '' : ' checked'}><i style="background:linear-gradient(135deg,${c.bg} 42%,${c.accent} 42% 56%,${c.bg} 56%)"></i></label>`).join('')}
      </div></div>
      <label class="field"><span>Papier</span><select name="paper">
        ${Object.entries(PAPERS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
      </select></label>`,
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
    body: '<label class="field"><span>Titel</span><input name="title" value="Naamloos whiteboard" required autofocus></label>',
  });
  if (!res) return;
  const d = newDoc('board', res.title.trim() || 'Naamloos whiteboard');
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
      <div class="field"><span>Kaft</span><div class="covers">
        ${Object.entries(COVERS).map(([k, c]) => `<label class="cover-opt" title="${k}"><input type="radio" name="cover" value="${k}"${doc.cover === k ? ' checked' : ''}><i style="background:linear-gradient(135deg,${c.bg} 42%,${c.accent} 42% 56%,${c.bg} 56%)"></i></label>`).join('')}
      </div></div>
      <label class="field"><span>Papier</span><select name="paper">
        ${Object.entries(PAPERS).map(([k, l]) => `<option value="${k}"${doc.paper === k ? ' selected' : ''}>${l}</option>`).join('')}
      </select></label>`,
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

function cardMenu(anchor, doc) {
  popMenu(anchor, [
    { icon: 'open', label: 'Openen', action: () => openDoc(doc.id) },
    { icon: 'edit', label: 'Naam wijzigen', action: () => rename(doc) },
    { icon: doc.favorite ? 'star' : 'starFill', label: doc.favorite ? 'Uit favorieten' : 'Aan favorieten toevoegen', action: () => { doc.favorite = !doc.favorite; saveNow(doc); } },
    ...(doc.type === 'notebook' ? [{ icon: 'palette', label: 'Kaft en papier', action: () => changeCover(doc) }] : []),
    { icon: 'copy', label: 'Dupliceren', action: () => { store.save(cloneDoc(doc)); renderLibrary(); } },
    { icon: 'download', label: 'Exporteren (.json)', action: () => downloadJSON(`${slug(doc.title)}.json`, doc) },
    '-',
    {
      icon: 'trash', label: 'Verwijderen', danger: true, action: async () => {
        if (await confirmDialog(`"${doc.title}" verwijderen?`, 'Het document verdwijnt ook uit je Google Sheet en van je andere toestellen.')) {
          store.remove(doc.id);
          renderLibrary();
        }
      },
    },
  ]);
}

// ---------- editor ----------

function openDoc(id) {
  location.hash = `#/d/${id}`;
}

function saveNow(doc) {
  store.save(doc);
  if (S.doc === doc) {
    $('docTitle').innerHTML = `<span>${esc(doc.title)}</span>${icon('chevron')}`;
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
  }
}

function showEditor(doc) {
  closeMenu();
  if (S.doc?.id === doc.id) return;
  closeEditor();
  S.doc = doc;
  $('library').hidden = true;
  $('editor').hidden = false;
  $('editor').classList.toggle('is-notebook', doc.type === 'notebook');
  $('docTitle').innerHTML = `<span>${esc(doc.title)}</span>${icon('chevron')}`;
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
  S.board.destroy();
  flushSave();
  S.board = null;
  S.doc = null;
  $('boardHost').innerHTML = '';
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
  let h;
  switch (b.tool) {
    case 'pen':
      h = widths([[1.5, 4], [3, 7], [5, 11]], o.penWidth, 'penWidth', '#ffffff') + sep + swatches(INK_COLORS, o.penColor, 'penColor') + custom('penColor', o.penColor);
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
  await dialog({
    title: 'Google Sheets-koppeling',
    submit: 'Opslaan',
    body: `
      <p class="muted">Je notities worden altijd op dit toestel bewaard. Koppel een Google Sheet om ze te bewaren in de cloud en te synchroniseren tussen toestellen. Hoe je dat instelt, staat in de README.</p>
      <label class="field"><span>Web-app URL (Apps Script)</span><input name="url" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c.url)}"></label>
      <label class="field"><span>Token (staat bovenaan Code.gs)</span><input name="token" type="password" autocomplete="off" value="${esc(c.token)}"></label>
      <div class="row"><button type="button" class="btn ghost" data-test>${icon('sync')} Verbinding testen</button><span class="test-out muted"></span></div>
      ${store.status.state === 'error' ? `<p class="err-text">${esc(store.status.message)}</p>` : ''}
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
          await store.test(d.querySelector('[name=url]').value.trim(), d.querySelector('[name=token]').value.trim());
          out.textContent = 'Verbinding werkt ✓';
          out.className = 'test-out st-ok';
        } catch (e) {
          out.textContent = e.message;
          out.className = 'test-out st-error';
        }
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
  if (doc) showEditor(doc);
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
      openDoc(doc.id);
    }
  });
  $('grid').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('thumb')) openDoc(e.target.closest('.card').dataset.id);
  });
  $('syncChip').addEventListener('click', openSettings);
  $('edSync').addEventListener('click', openSettings);

  $('homeBtn').addEventListener('click', () => { location.hash = ''; });
  $('docTitle').addEventListener('click', e => {
    const doc = S.doc;
    popMenu(e.currentTarget, [
      { icon: 'edit', label: 'Naam wijzigen', action: () => rename(doc) },
      ...(doc.type === 'notebook' ? [{ icon: 'palette', label: 'Kaft en papier', action: () => changeCover(doc) }] : []),
      { icon: doc.favorite ? 'star' : 'starFill', label: doc.favorite ? 'Uit favorieten' : 'Aan favorieten toevoegen', action: () => { doc.favorite = !doc.favorite; saveNow(doc); } },
      { icon: 'download', label: 'Exporteren (.json)', action: () => downloadJSON(`${slug(doc.title)}.json`, doc) },
    ]);
  });
  $('tools').addEventListener('click', e => {
    const b = e.target.closest('[data-tool]');
    if (b) setTool(b.dataset.tool);
  });
  $('undoBtn').addEventListener('click', () => S.board.undo());
  $('redoBtn').addEventListener('click', () => S.board.redo());
  $('addPageBtn').addEventListener('click', () => S.board.addPage());
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
    if (!S.board || document.querySelector('dialog[open]')) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (S.board.key(e)) e.preventDefault();
  });
  document.addEventListener('keyup', e => S.board?.keyup(e));

  addEventListener('hashchange', route);
  addEventListener('pagehide', flushSave);
  addEventListener('online', () => store.sync());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { flushSave(); store.sync(); }
    else store.sync();
  });
  setInterval(() => { if (!document.hidden) store.sync(); }, 60000);

  store.addEventListener('status', renderStatus);
  store.addEventListener('change', e => {
    if (e.detail.source !== 'remote') return;
    if (S.doc && e.detail.ids.includes(S.doc.id)) {
      const fresh = store.get(S.doc.id);
      if (!fresh) {
        toast('Dit document is op een ander toestel verwijderd');
        location.hash = '';
      } else if (!S.board.busy() && !S.dirty) {
        S.doc = fresh;
        S.board.load(fresh);
        $('docTitle').innerHTML = `<span>${esc(fresh.title)}</span>${icon('chevron')}`;
      }
    }
    if (!$('library').hidden) renderLibrary();
  });
}

shell();
bindEvents();
renderStatus();
route();
store.sync();
// Lettertypes kunnen na de eerste weergave binnenkomen; daarna klopt de maat van tekst pas.
document.fonts?.ready.then(() => { if (!$('library').hidden) renderLibrary(); });
