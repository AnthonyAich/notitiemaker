// Kleine UI-hulpjes: iconen, dialogen, menu's, meldingen.

const ICONS = {
  logo: '<path d="M6 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M10 8h5M10 12h5"/><path d="m20.5 6.5-6 6-1 2.5 2.5-1 6-6z" fill="currentColor" stroke="none" opacity=".9"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v11.5h13V9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  starFill: '<path fill="currentColor" d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  board: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4"/><path d="M7 8h4M7 11h6"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v16H6.5A1.5 1.5 0 0 0 5 20.5z"/><path d="M5 20.5A1.5 1.5 0 0 0 6.5 22H19v-3"/>',
  pointer: '<path d="M5 3.5 18.5 10l-5.8 1.9-2 5.8z"/><path d="m13 12 5 5"/>',
  pen: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/><path d="m14.5 5.5 3 3"/>',
  highlighter: '<path d="m9 11-5.5 5.5V20h3.5l5.5-5.5"/><path d="m9 11 7-7 4 4-7 7z"/><path d="M14 21h7"/>',
  eraser: '<path d="M9 20h11"/><path d="m4.6 14.6 9.2-9.2a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L11 20H9.4z"/><path d="m9 10 5 5"/>',
  text: '<path d="M5 7V4.5h14V7"/><path d="M12 4.5v15M9 19.5h6"/>',
  sticky: '<path d="M4.5 4.5h15V14l-5.5 5.5H4.5z"/><path d="M14 19.5V14h5.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  filePlus: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.6 1.46 3.75 3.75 0 0 1-.5 7.5z"/>',
  cloudOk: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.6 1.46 3.75 3.75 0 0 1-.5 7.5z"/><path d="m9.5 13.5 2 2 3.5-3.5"/>',
  cloudOff: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.6 1.46 3.75 3.75 0 0 1-.5 7.5z"/><path d="M4 4l16 16"/>',
  cloudErr: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.6 1.46 3.75 3.75 0 0 1-.5 7.5z"/><path d="M12 10v3"/><circle cx="12" cy="15.6" r=".6" fill="currentColor"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  front: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5" opacity=".45"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  lasso: '<path d="M7 17.5C4.5 16.3 3 14.3 3 12c0-4.4 4-8 9-8s9 3.6 9 8-4 8-9 8c-1 0-2-.1-2.9-.4" stroke-dasharray="3 2.6"/><path d="M8.5 16.5a2 2 0 1 1-2.6 2.9c-.6-.7-.4-2 .5-2.6"/>',
  shapes: '<path d="m4 20 6.5-6.5"/><path d="M10.5 18.5v-5h-5"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.2"/><circle cx="7" cy="7" r="3.5"/>',
  arrow: '<path d="M5 19 19 5M10 5h9v9"/>',
  line: '<path d="M5 19 19 5"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6.5"/>',
  printer: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 2"/>',
  restore: '<path d="M4 10a8 8 0 1 1 1.5 6"/><path d="M4 4v6h6"/>',
  template: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9h17M9 9v11.5"/>',
  wifiOff: '<path d="M2 8.5a15 15 0 0 1 4.5-2.8M10 5.1A15 15 0 0 1 22 8.5M5.5 12.5a10 10 0 0 1 3-1.9M15 11a10 10 0 0 1 3.5 1.5M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r=".8" fill="currentColor"/><path d="M3 3l18 18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8"/><circle cx="12" cy="17" r=".7" fill="currentColor"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.4-2-.5-1.2.3-2.5 1.6-2.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10" cy="7" r="1" fill="currentColor"/><circle cx="15" cy="7.5" r="1" fill="currentColor"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const time = d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (days === 0) return `Vandaag, ${time}`;
  if (days === 1) return `Gisteren, ${time}`;
  if (days === 2) return `Eergisteren, ${time}`;
  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
}

let toastTimer;
export function toast(msg, kind = '') {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), kind ? 7000 : 2600);
}

// Toont een modale dialoog. Geeft de formulierwaarden terug, of null bij annuleren.
export function dialog({ title, body = '', submit = 'OK', cancel = 'Annuleren', danger = false, onOpen }) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = `<form method="dialog">
      <h2>${esc(title)}</h2>
      <div class="dlg-body">${body}</div>
      <div class="dlg-actions">
        ${cancel ? `<button value="cancel" class="btn ghost" formnovalidate>${esc(cancel)}</button>` : ''}
        <button value="ok" class="btn ${danger ? 'danger' : 'primary'}">${esc(submit)}</button>
      </div>
    </form>`;
    document.body.append(d);
    const form = d.querySelector('form');
    d.addEventListener('close', () => {
      const data = d.returnValue === 'ok' ? Object.fromEntries(new FormData(form)) : null;
      d.remove();
      resolve(data);
    });
    onOpen?.(d);
    d.showModal();
    const first = d.querySelector('[autofocus]');
    if (first) { first.focus(); first.select?.(); }
  });
}

export const confirmDialog = (title, text, submit = 'Verwijderen') =>
  dialog({ title, body: `<p class="muted">${esc(text)}</p>`, submit, danger: true }).then(Boolean);

let openMenu = null;
export function closeMenu() {
  openMenu?.remove();
  openMenu = null;
}

// Klein contextmenu onder een knop. items: [{ icon, label, action, danger }] of '-'.
export function popMenu(anchor, items) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' :
    `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`).join('');
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  let left = Math.min(r.left, innerWidth - w - 8);
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  m.style.left = `${Math.max(8, left)}px`;
  m.style.top = `${top}px`;
  m.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    closeMenu();
    items[+b.dataset.i].action();
  });
  openMenu = m;
  setTimeout(() => {
    const away = e => {
      if (openMenu !== m) return document.removeEventListener('pointerdown', away, true);
      if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', away, true); }
    };
    document.addEventListener('pointerdown', away, true);
  });
}
