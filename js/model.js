// Datamodel, kleuren en vaste maten.
import { esc } from './ui.js';

export const PAGE_W = 820;
export const PAGE_H = 1160;
export const PAGE_GAP = 48;
export const pageTop = i => i * (PAGE_H + PAGE_GAP);

// Notitieblaadjes: achtergrond + markeerkleur voor regels.
export const STICKY_COLORS = {
  roze: { bg: '#f8aeb5', hl: '#f2738b' },
  paars: { bg: '#e8d6fb', hl: '#c79ef4' },
  geel: { bg: '#f9e17a', hl: '#f3bd35' },
  blauw: { bg: '#cde3fb', hl: '#7fc0f4' },
  oranje: { bg: '#fbc898', hl: '#f5994f' },
  groen: { bg: '#c9ecc1', hl: '#86d27b' },
};

export const INK_COLORS = ['#1d1d1f', '#ffffff', '#8e6bbf', '#2f9e44', '#2b8a9e', '#e03131', '#1c7ed6', '#f08c00'];
export const HL_COLORS = ['#ffe066', '#b2f2bb', '#a5d8ff', '#fcc2d7', '#d0bfff', '#ffc078'];

export const COVERS = {
  bordeaux: { bg: '#66262a', accent: '#e0d49a' },
  marine: { bg: '#1f3a5f', accent: '#9cc3e6' },
  bos: { bg: '#24432f', accent: '#c9dd9a' },
  oker: { bg: '#b7791f', accent: '#fbe7b5' },
  grafiet: { bg: '#2b2b2e', accent: '#f08c8c' },
  lila: { bg: '#5f4b8b', accent: '#f3c6e0' },
};

export const PAPERS = { lijnen: 'Gelinieerd', ruitjes: 'Ruitjes', puntjes: 'Puntjes', blanco: 'Blanco' };

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function newDoc(type, title, opts = {}) {
  const now = Date.now();
  const base = { id: uid(), type, title, favorite: false, createdAt: now, updatedAt: now };
  if (type === 'notebook') {
    // Pagina 0 is de kaft.
    return { ...base, cover: opts.cover || 'bordeaux', paper: opts.paper || 'lijnen', content: { pages: 3, items: [], strokes: [] } };
  }
  return { ...base, content: { items: [], strokes: [] } };
}

export function cloneDoc(doc) {
  const d = JSON.parse(JSON.stringify(doc));
  d.id = uid();
  d.title = `${doc.title} (kopie)`;
  d.favorite = false;
  d.createdAt = d.updatedAt = Date.now();
  return d;
}

// Alle tekst in een document, voor de zoekfunctie.
export function docText(doc) {
  const parts = [doc.title];
  for (const it of doc.content?.items || []) {
    if (it.kind === 'sticky') parts.push(it.title, ...(it.lines || []).map(l => l.text));
    else parts.push(it.text);
  }
  return parts.join(' ').toLowerCase();
}

// Herkent een datum vooraan een regel, zoals "9/11:" of "23/11/2026".
// Geeft { label, rest, state } terug; state is 'today', 'soon', 'past' of 'later'.
export function lineDate(text, now = new Date()) {
  const m = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(\s*:?\s*)/);
  if (!m) return null;
  const day = +m[1], month = +m[2];
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let date;
  if (m[3]) {
    date = new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], month - 1, day);
  } else {
    // Zonder jaartal: kies het jaar waarbij de datum het dichtst bij vandaag ligt.
    date = [-1, 0, 1].map(o => new Date(today.getFullYear() + o, month - 1, day))
      .sort((a, b) => Math.abs(a - today) - Math.abs(b - today))[0];
  }
  const days = Math.round((date - today) / 86400000);
  const state = days === 0 ? 'today' : days < 0 ? 'past' : days <= 2 ? 'soon' : 'later';
  return { label: m[0].replace(/\s*:?\s*$/, ''), rest: text.slice(m[0].length), state, days };
}

// Aantal regels en gemarkeerde regels in alle blaadjes van een document.
export function stickyStats(doc) {
  let total = 0, done = 0;
  for (const it of doc.content?.items || []) {
    if (it.kind !== 'sticky') continue;
    for (const l of it.lines || []) {
      total++;
      if (l.hl) done++;
    }
  }
  return { total, done };
}

const SWIRL ='M300 -40 C 140 200, 90 420, 160 560 C 230 690, 420 660, 420 560 C 420 470, 300 470, 270 560 C 230 690, 400 860, 600 860 C 760 860, 790 760, 730 720 C 650 670, 560 780, 600 920 C 640 1060, 760 1100, 880 1100';

function wrapTitle(title) {
  const lines = [];
  let cur = '';
  for (const w of title.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + w).length > 14) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  if (lines.length > 3) { lines.length = 3; lines[2] += '…'; }
  return lines.length ? lines : ['Notebook'];
}

export function coverSVG(doc) {
  const c = COVERS[doc.cover] || COVERS.bordeaux;
  const lines = wrapTitle(doc.title || '');
  const lh = 76;
  const boxH = 70 + lines.length * lh;
  const boxY = 600 - boxH / 2;
  const tspans = lines.map((l, i) => `<tspan x="410" dy="${i ? lh : 0}">${esc(l)}</tspan>`).join('');
  return `<svg viewBox="0 0 ${PAGE_W} ${PAGE_H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <rect width="${PAGE_W}" height="${PAGE_H}" fill="${c.bg}"/>
    <path d="${SWIRL}" fill="none" stroke="${c.accent}" stroke-width="54" stroke-linecap="round"/>
    <rect x="150" y="${boxY}" width="520" height="${boxH}" rx="30" fill="#fff"/>
    <text y="${boxY + 35 + lh * 0.75}" text-anchor="middle" font-family="Caveat, cursive" font-weight="500" font-size="74" fill="#111">${tspans}</text>
  </svg>`;
}
