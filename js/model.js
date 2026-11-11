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

export const PAPERS = {
  lijnen: 'Gelinieerd', ruitjes: 'Ruitjes', puntjes: 'Puntjes', blanco: 'Blanco',
  cornell: 'Cornell-notities', week: 'Weekplanner',
};

const DAYS = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];

// Een weekplanner-pagina: zeven vakken plus een vak voor notities.
export function weekPageSVG() {
  const cells = [...DAYS, 'Notities'].map((d, i) => {
    const x = 40 + (i % 2) * 380, y = 40 + Math.floor(i / 2) * 270;
    return `<rect x="${x}" y="${y}" width="360" height="250" rx="14" fill="none" stroke="#c8d7ec" stroke-width="2"/>
      <text x="${x + 18}" y="${y + 34}" font-family="Caveat, cursive" font-size="30" font-weight="700" fill="#5b7aa6">${d}</text>
      <line x1="${x + 16}" y1="${y + 48}" x2="${x + 344}" y2="${y + 48}" stroke="#c8d7ec" stroke-width="1.5"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${PAGE_W} ${PAGE_H}" width="100%" height="100%" aria-hidden="true">${cells}</svg>`;
}

function weekDates() {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return DAYS.map((d, i) => {
    const t = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return `${d} ${t.getDate()}/${t.getMonth() + 1}`;
  });
}

const sticky = (x, y, color, title, lines = [], w = 260, h = 200) =>
  ({ id: uid(), kind: 'sticky', x, y, w, h, color, title, lines: lines.map(t => ({ text: t.trim(), indent: t.startsWith('  ') ? 1 : 0, hl: false })) });
const label = (x, y, text, size = 34) => ({ id: uid(), kind: 'text', x, y, text, size, color: '#1d1d1f' });
const shape = (kind, a, b, color = '#1d1d1f', width = 3) => ({ id: uid(), tool: 'pen', shape: kind, color, width, points: [a, b] });

// Sjablonen voor een nieuw whiteboard.
export const BOARD_TEMPLATES = {
  leeg: { label: 'Leeg', hint: 'Een leeg whiteboard', make: () => ({ items: [], strokes: [] }) },
  week: {
    label: 'Weekplanner',
    hint: 'Een blaadje per dag van deze week',
    make: () => {
      const colors = ['geel', 'roze', 'blauw', 'groen', 'oranje', 'paars', 'geel'];
      const items = weekDates().map((d, i) => sticky((i % 4) * 290, Math.floor(i / 4) * 260, colors[i], d));
      items.push(sticky(870, 260, 'blauw', 'Deze week niet vergeten', []));
      return { items, strokes: [] };
    },
  },
  kanban: {
    label: 'Kanban',
    hint: 'To do, bezig en klaar: sleep blaadjes van kolom naar kolom',
    make: () => {
      const cols = ['To do', 'Bezig', 'Klaar'];
      return {
        items: [
          ...cols.map((c, i) => label(i * 340 + 16, -10, c, 40)),
          sticky(30, 60, 'geel', 'Taak', ['Sleep me naar Bezig'], 260, 120),
          sticky(30, 210, 'roze', 'Nog een taak', [], 260, 120),
        ],
        strokes: cols.map((_, i) => shape('rect', [i * 340, -20], [i * 340 + 320, 760], '#b9c4d4', 2)),
      };
    },
  },
  vergadering: {
    label: 'Vergadering',
    hint: 'Agenda, notities, beslissingen en acties',
    make: () => ({
      items: [
        label(0, -70, 'Vergadering ' + new Date().toLocaleDateString('nl-BE'), 40),
        sticky(0, 0, 'geel', 'Agenda', ['Opening', 'Vorig verslag', 'Rondvraag']),
        sticky(290, 0, 'blauw', 'Notities', [], 380, 420),
        sticky(0, 230, 'groen', 'Beslissingen', []),
        sticky(700, 0, 'roze', 'Acties', ['Wie · wat · tegen wanneer'], 280, 420),
      ],
      strokes: [],
    }),
  },
  mindmap: {
    label: 'Mindmap',
    hint: 'Een centraal idee met vier takken',
    make: () => {
      const c = sticky(380, 260, 'oranje', 'Centraal idee', [], 240, 120);
      const arms = [[0, 0, 'geel'], [760, 0, 'blauw'], [0, 520, 'groen'], [760, 520, 'paars']];
      const items = [c, ...arms.map(([x, y, col], i) => sticky(x, y, col, `Idee ${i + 1}`, [], 240, 140))];
      const strokes = [[370, 270, 250, 150], [630, 270, 750, 150], [370, 380, 250, 510], [630, 380, 750, 510]]
        .map(([ax, ay, bx, by]) => shape('arrow', [ax, ay], [bx, by], '#5f6b7a', 3));
      return { items, strokes };
    },
  },
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Rondleiding voor nieuwe gebruikers. De vaste id voorkomt dubbele exemplaren
// als iemand op twee toestellen tegelijk voor het eerst inlogt.
export function welcomeDoc(userId) {
  const now = new Date();
  const today = `${now.getDate()}/${now.getMonth() + 1}`;
  const W = 320, gap = 30, col = i => i * (W + gap), row2 = 340;
  const items = [
    label(0, -130, 'Welkom bij Notitiemaker 👋', 58),
    label(4, -56, 'Een korte rondleiding. Alles hier mag je aanpassen, verslepen of weggooien.', 26),
    sticky(col(0), 0, 'geel', 'Begin hier', [
      'Kies bovenaan het pijltje',
      'Tik op een regel om ze te markeren',
      'Dubbeltik op een blaadje om te bewerken',
      'Sleep een blaadje om het te verplaatsen',
      'Blauw bolletje = groter of kleiner',
    ], W, 280),
    sticky(col(1), 0, 'blauw', 'Tekenen', [
      'Pen, markeerstift en gum staan bovenaan',
      'Hou de pen even stil aan het einde',
      '  = een rechte lijn of nette vorm',
      'Vormen en pijlen: het vormen-icoon',
      'Lasso: omcirkel om te verplaatsen',
      'Met een Apple Pencil schuift je vinger',
    ], W, 280),
    sticky(col(2), 0, 'groen', 'Rondkijken', [
      'Knijpen om in en uit te zoomen',
      'Twee vingers slepen om te schuiven',
      'Computer: scrollen, of ⌘ + scrollen om te zoomen',
      'Het kader-icoon zet alles in beeld',
    ], W, 280),
    sticky(col(0), row2, 'roze', 'Documenten', [
      'Nieuw: een notebook of whiteboard',
      'Kies een sjabloon: weekplanner, kanban, …',
      '+ bovenaan opent een extra tabblad',
      'Weggegooid? Kijk in de prullenbak',
      'Klik op de documentnaam voor versies en PDF',
    ], W, 280),
    sticky(col(1), row2, 'paars', 'Handig om te weten', [
      'Alles synchroniseert vanzelf met je andere toestellen',
      'Werkt ook zonder internet',
      'Zoeken vindt ook je handschrift',
      'iPad: Deel → Zet op beginscherm',
      'Je naam linksonder: account en wachtwoord',
    ], W, 280),
    sticky(col(2), row2, 'oranje', 'Probeer het zelf', [
      `${today}: deze rondleiding bekijken`,
      'Tik op deze regel',
      'En op deze',
      'Alles gemarkeerd? Kijk wat er gebeurt',
    ], W, 280),
    label(col(3) + 20, 6, 'Teken hier iets ✍️', 34),
  ];
  const strokes = [
    shape('rect', [col(3), 0], [col(3) + 380, row2 + 280], '#9aa6b8', 4),
    shape('arrow', [col(2) + W + 6, row2 + 150], [col(3) + 110, row2 + 70], '#5f6b7a', 3),
  ];
  return { ...newDoc('board', 'Welkom bij Notitiemaker'), id: `welkom-${userId}`, content: { items, strokes } };
}

export function newDoc(type, title, opts = {}) {
  const now = Date.now();
  const base = { id: uid(), type, title, favorite: false, createdAt: now, updatedAt: now };
  if (type === 'notebook') {
    // Pagina 0 is de kaft.
    return { ...base, cover: opts.cover || 'bordeaux', paper: opts.paper || 'lijnen', content: { pages: 3, items: [], strokes: [] } };
  }
  return { ...base, content: (BOARD_TEMPLATES[opts.template] || BOARD_TEMPLATES.leeg).make() };
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
  if (doc.ocr?.text) parts.push(doc.ocr.text);
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
