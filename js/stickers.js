// Stickers: ingebouwde SVG-stickers en eigen stickers (getekend of geüpload).
// Een ingebouwde sticker wordt in een document alleen bewaard als zijn naam (`key`);
// een eigen sticker bewaart zijn eigen SVG-code, genormaliseerd naar max. 100 eenheden.
import { uid } from './model.js';
import { strokePath, strokeBBox } from './ink.js';
import { esc } from './ui.js';

// [label, SVG-inhoud in een vak van 100 × 100, zonder witte rand (tape en stempel)]
const DEFS = {
  // ---------- status ----------
  klaar: ['Klaar!', `<circle cx="50" cy="50" r="40" fill="#40c057"/><path d="M30 51l13 13 27-29" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`],
  belangrijk: ['Belangrijk', `<path d="M50 12L91 82H9Z" fill="#f03e3e" stroke="#f03e3e" stroke-width="10" stroke-linejoin="round"/><rect x="45" y="34" width="10" height="27" rx="5" fill="#fff"/><circle cx="50" cy="71" r="5.5" fill="#fff"/>`],
  deadline: ['Deadline', `<path d="M20 24l10-10M80 24L70 14" stroke="#1d1d1f" stroke-width="7" stroke-linecap="round"/><circle cx="50" cy="55" r="34" fill="#ffd43b" stroke="#1d1d1f" stroke-width="5"/><circle cx="50" cy="55" r="26" fill="#fff"/><path d="M50 55V38M50 55l11 7" stroke="#1d1d1f" stroke-width="5" stroke-linecap="round"/><path d="M30 88l6-8M70 88l-6-8" stroke="#1d1d1f" stroke-width="6" stroke-linecap="round"/>`],
  idee: ['Idee', `<path d="M50 14a26 26 0 0 0-15 47c3 2 5 6 5 10v3h20v-3c0-4 2-8 5-10a26 26 0 0 0-15-47z" fill="#ffd43b" stroke="#e8a500" stroke-width="3"/><rect x="40" y="76" width="20" height="10" rx="3" fill="#868e96"/><path d="M44 50l6 8 6-8" fill="none" stroke="#e8a500" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M50 2v6M14 18l5 4M86 18l-5 4M4 44h7M89 44h7" stroke="#fab005" stroke-width="5" stroke-linecap="round"/>`],
  vraag: ['Vraag', `<path d="M18 14h64a10 10 0 0 1 10 10v36a10 10 0 0 1-10 10H46L28 86V70H18A10 10 0 0 1 8 60V24a10 10 0 0 1 10-10z" fill="#4dabf7"/><path d="M40 33a10 10 0 1 1 14 9c-3 1-4 3-4 6" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="50" cy="59" r="4.5" fill="#fff"/>`],
  bezig: ['Bezig', `<path d="M30 10h40M30 90h40" stroke="#5f3dc4" stroke-width="8" stroke-linecap="round"/><path d="M34 12h32c0 18-12 24-12 38s12 20 12 38H34c0-18 12-24 12-38S34 30 34 12z" fill="#e5dbff" stroke="#5f3dc4" stroke-width="4" stroke-linejoin="round"/><path d="M40 24h20c-2 8-10 12-10 18-0-6-8-10-10-18zM38 86c2-10 12-14 12-20 0 6 10 10 12 20z" fill="#fab005"/>`],
  prioriteit: ['Prioriteit', `<path d="M50 8c4 16 26 26 26 50a26 26 0 0 1-52 0c0-12 6-20 12-26 0 10 4 15 9 17-2-14 0-28 5-41z" fill="#fd7e14"/><path d="M50 50c3 8 13 12 13 24a13 13 0 0 1-26 0c0-8 6-12 8-18 1 6 3 8 5 9 0-6-1-10 0-15z" fill="#ffd43b"/>`],
  later: ['Later', `<path d="M60 14a36 36 0 1 0 26 52A30 30 0 0 1 60 14z" fill="#748ffc"/><text x="58" y="38" font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="900" font-size="16" fill="#1d1d1f">z</text><text x="70" y="26" font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="900" font-size="12" fill="#1d1d1f">z</text>`],
  checklist: ['Checklist', `<rect x="18" y="14" width="64" height="78" rx="8" fill="#ced4da"/><rect x="24" y="22" width="52" height="64" rx="4" fill="#fff"/><rect x="36" y="8" width="28" height="14" rx="5" fill="#495057"/><path d="M30 38l4 4 8-9M30 56l4 4 8-9" fill="none" stroke="#40c057" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="31" y="70" width="10" height="10" rx="2" fill="none" stroke="#adb5bd" stroke-width="3"/><path d="M48 39h20M48 57h20M48 75h16" stroke="#adb5bd" stroke-width="4" stroke-linecap="round"/>`],
  top: ['Top!', `<path d="M50 6l12 26 28 3-21 19 6 28-25-15-25 15 6-28-21-19 28-3z" fill="#ffd43b" stroke="#f59f00" stroke-width="3" stroke-linejoin="round"/><text x="50" y="59" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="17" fill="#c25e00">TOP</text>`],

  // ---------- dingen ----------
  koffie: ['Koffie', `<path d="M38 8c-4 6 4 8 0 14M52 8c-4 6 4 8 0 14" fill="none" stroke="#adb5bd" stroke-width="4" stroke-linecap="round"/><path d="M68 40h6a12 12 0 0 1 0 24h-7" fill="none" stroke="#a0522d" stroke-width="7"/><path d="M16 30h56v40a16 16 0 0 1-16 16H32a16 16 0 0 1-16-16z" fill="#c8794a"/><path d="M16 30h56v8H16z" fill="#6f3b1d"/><path d="M34 54c4-6 14-6 18 0-4 6-14 6-18 0z" fill="#fff" opacity=".9"/>`],
  kalender: ['Kalender', `<rect x="12" y="18" width="76" height="70" rx="10" fill="#fff" stroke="#dee2e6" stroke-width="3"/><path d="M12 28a10 10 0 0 1 10-10h56a10 10 0 0 1 10 10v10H12z" fill="#fa5252"/><rect x="28" y="10" width="7" height="18" rx="3.5" fill="#495057"/><rect x="65" y="10" width="7" height="18" rx="3.5" fill="#495057"/><text x="50" y="76" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="32" fill="#1d1d1f">17</text>`],
  punaise: ['Punaise', `<path d="M50 62L44 94" stroke="#868e96" stroke-width="5" stroke-linecap="round"/><ellipse cx="50" cy="60" rx="28" ry="9" fill="#c92a2a"/><path d="M36 20h28l-4 34H40z" fill="#fa5252"/><ellipse cx="50" cy="18" rx="20" ry="9" fill="#ff8787"/>`],
  hart: ['Hart', `<path d="M50 88S10 62 10 34a20 20 0 0 1 40-6 20 20 0 0 1 40 6c0 28-40 54-40 54z" fill="#f06595"/><path d="M26 30a8 8 0 0 1 10-6" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".8"/>`],
  trofee: ['Trofee', `<path d="M26 18H12c0 18 8 24 18 26M74 18h14c0 18-8 24-18 26" fill="none" stroke="#f59f00" stroke-width="6"/><path d="M26 10h48v20a24 24 0 0 1-48 0z" fill="#fcc419"/><rect x="44" y="52" width="12" height="18" fill="#f59f00"/><rect x="30" y="70" width="40" height="16" rx="4" fill="#495057"/><path d="M50 18l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="#fff" opacity=".85"/>`],
  doel: ['Doel', `<circle cx="46" cy="54" r="38" fill="#fa5252"/><circle cx="46" cy="54" r="27" fill="#fff"/><circle cx="46" cy="54" r="16" fill="#fa5252"/><circle cx="46" cy="54" r="6" fill="#fff"/><path d="M46 54L86 14" stroke="#1d1d1f" stroke-width="5" stroke-linecap="round"/><path d="M78 8l10 10-4 6-12-12z" fill="#1d1d1f"/>`],
  raket: ['Raket', `<path d="M50 6c20 14 24 40 16 62H34C26 46 30 20 50 6z" fill="#e9ecef" stroke="#adb5bd" stroke-width="3"/><circle cx="50" cy="36" r="9" fill="#4dabf7" stroke="#1971c2" stroke-width="3"/><path d="M34 56L18 72l16 0zM66 56l16 16H66z" fill="#fa5252"/><path d="M40 70h20c0 10-4 18-10 24-6-6-10-14-10-24z" fill="#fd7e14"/><path d="M45 70h10c0 6-2 10-5 14-3-4-5-8-5-14z" fill="#ffd43b"/>`],
  boeken: ['Boeken', `<rect x="14" y="66" width="72" height="18" rx="4" fill="#4c6ef5"/><rect x="20" y="46" width="64" height="18" rx="4" fill="#40c057" transform="rotate(-4 52 55)"/><rect x="16" y="26" width="62" height="18" rx="4" fill="#fab005" transform="rotate(3 47 35)"/><path d="M22 72h56M26 52h48M22 32h50" stroke="#fff" stroke-width="3" opacity=".6"/>`],
  potlood: ['Potlood', `<g transform="rotate(-40 50 50)"><rect x="18" y="40" width="58" height="20" fill="#fcc419"/><rect x="18" y="40" width="58" height="6" fill="#fab005"/><rect x="8" y="40" width="12" height="20" rx="3" fill="#f783ac"/><rect x="18" y="40" width="6" height="20" fill="#adb5bd"/><path d="M76 40l18 10-18 10z" fill="#ffe8cc"/><path d="M88 46.7l6 3.3-6 3.3z" fill="#1d1d1f"/></g>`],
  paperclip: ['Paperclip', `<path d="M60 22v46a14 14 0 0 1-28 0V26a9 9 0 0 1 18 0v40a4 4 0 0 1-8 0V30" fill="none" stroke="#868e96" stroke-width="6" stroke-linecap="round" transform="rotate(20 50 50)"/>`],
  plant: ['Plantje', `<path d="M50 60C50 40 40 28 22 26c0 20 12 30 28 30M50 56c0-22 10-36 30-38 0 22-12 34-30 38" fill="#51cf66" stroke="#2b8a3e" stroke-width="3" stroke-linejoin="round"/><path d="M50 30v32" stroke="#2b8a3e" stroke-width="4"/><path d="M28 60h44l-6 30H34z" fill="#e8590c"/><rect x="24" y="56" width="52" height="10" rx="4" fill="#fd7e14"/>`],
  smiley: ['Smiley', `<circle cx="50" cy="50" r="40" fill="#ffd43b"/><circle cx="36" cy="42" r="5" fill="#1d1d1f"/><circle cx="64" cy="42" r="5" fill="#1d1d1f"/><path d="M32 58c8 12 28 12 36 0" fill="none" stroke="#1d1d1f" stroke-width="5" stroke-linecap="round"/><circle cx="28" cy="56" r="5" fill="#ff8787" opacity=".7"/><circle cx="72" cy="56" r="5" fill="#ff8787" opacity=".7"/>`],

  // ---------- tape, stempels, accenten ----------
  tapeRoze: ['Tape roze', `<g transform="rotate(-12 50 50)"><path d="M6 38l4 4-4 4 4 4-4 4 4 4-4 4h88l-4-4 4-4-4-4 4-4-4-4 4-4-4-4 4-4z" fill="#fcc2d7" opacity=".85"/><path d="M20 38v28M38 38v28M56 38v28M74 38v28" stroke="#f783ac" stroke-width="5" opacity=".5"/></g>`, true],
  tapeBlauw: ['Tape blauw', `<g transform="rotate(8 50 50)"><path d="M6 38l4 4-4 4 4 4-4 4 4 4-4 4h88l-4-4 4-4-4-4 4-4-4-4 4-4-4-4 4-4z" fill="#a5d8ff" opacity=".85"/><circle cx="22" cy="52" r="4" fill="#fff" opacity=".8"/><circle cx="42" cy="46" r="4" fill="#fff" opacity=".8"/><circle cx="62" cy="56" r="4" fill="#fff" opacity=".8"/><circle cx="80" cy="48" r="4" fill="#fff" opacity=".8"/></g>`, true],
  tapeGeel: ['Tape geel', `<g transform="rotate(-4 50 50)"><path d="M6 38l4 4-4 4 4 4-4 4 4 4-4 4h88l-4-4 4-4-4-4 4-4-4-4 4-4-4-4 4-4z" fill="#ffec99" opacity=".9"/><path d="M6 46h88M6 58h88" stroke="#fab005" stroke-width="3" opacity=".6"/></g>`, true],
  gedaan: ['Stempel', `<g transform="rotate(-14 50 50)" fill="none" stroke="#e03131" opacity=".85"><circle cx="50" cy="50" r="40" stroke-width="5"/><circle cx="50" cy="50" r="32" stroke-width="2"/><text x="50" y="57" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="14.5" fill="#e03131" stroke="none">GEDAAN</text></g>`, true],
  kijk: ['Kijk hier', `<path d="M14 70C20 36 46 22 74 26" fill="none" stroke="#fd7e14" stroke-width="9" stroke-linecap="round"/><path d="M62 12l20 14-16 18" fill="none" stroke="#fd7e14" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="92" font-family="Caveat, cursive" font-weight="700" font-size="26" fill="#e8590c">kijk!</text>`],
  wow: ['Wow!', `<path d="M50 4l9 18 19-10-3 21 21 4-17 13 13 17-21 0 2 21-18-12-11 18-6-20-20 6 9-19-18-9 19-8-8-19 20 5z" fill="#ffd43b" stroke="#f08c00" stroke-width="3" stroke-linejoin="round"/><text x="50" y="58" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="21" fill="#e8590c" transform="rotate(-8 50 50)">WOW!</text>`],
};

export const STICKER_CATS = [
  ['status', 'Status', ['klaar', 'belangrijk', 'deadline', 'idee', 'vraag', 'bezig', 'prioriteit', 'later', 'checklist', 'top']],
  ['dingen', 'Dingen', ['koffie', 'kalender', 'punaise', 'hart', 'trofee', 'doel', 'raket', 'boeken', 'potlood', 'paperclip', 'plant', 'smiley']],
  ['tape', 'Tape en accenten', ['tapeRoze', 'tapeBlauw', 'tapeGeel', 'gedaan', 'kijk', 'wow']],
];

export const stickerLabel = key => DEFS[key]?.[0] || 'Sticker';

// Eén filter voor alle stickers: witte uitgesneden rand en een zachte schaduw.
export function ensureStickerDefs() {
  if (document.getElementById('sticker-defs')) return;
  document.body.insertAdjacentHTML('afterbegin', `<svg id="sticker-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <filter id="sticker-cut" x="-25%" y="-25%" width="150%" height="150%">
      <feMorphology in="SourceAlpha" operator="dilate" radius="4.5" result="grow"/>
      <feFlood flood-color="#ffffff"/>
      <feComposite in2="grow" operator="in" result="white"/>
      <feGaussianBlur in="grow" stdDeviation="2.4" result="blur"/>
      <feOffset in="blur" dy="2.5" result="drop"/>
      <feFlood flood-color="#000" flood-opacity=".22"/>
      <feComposite in2="drop" operator="in" result="shadow"/>
      <feMerge><feMergeNode in="shadow"/><feMergeNode in="white"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter></defs></svg>`);
}

// viewBox en inhoud van een sticker-item (ingebouwd of eigen).
export function stickerParts(it) {
  if (it.key) {
    const def = DEFS[it.key];
    if (!def) return { vb: '0 0 100 100', body: '<rect x="10" y="10" width="80" height="80" rx="16" fill="#dee2e6"/>', cut: true };
    return { vb: '0 0 100 100', body: def[1], cut: !def[2] };
  }
  return { vb: it.vb || '0 0 100 100', body: it.svg || '', cut: it.cut !== false };
}

// De sticker als <svg>, bv. voor het paneel.
export function stickerSVG(it, attrs = '') {
  const p = stickerParts(it);
  return `<svg viewBox="${p.vb}" ${attrs} overflow="visible"><g${p.cut ? ' filter="url(#sticker-cut)"' : ''}>${p.body}</g></svg>`;
}

// ---------- eigen stickers ----------

const MAX_SVG = 60000;

// Zet lassostreken om naar een eigen sticker (pure SVG, max. 100 eenheden breed of hoog).
export function stickerFromStrokes(strokes) {
  if (!strokes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const b = strokeBBox(s);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  const k = 100 / Math.max(x1 - x0, y1 - y0, 1);
  const w = Math.round((x1 - x0) * k * 10) / 10, h = Math.round((y1 - y0) * k * 10) / 10;
  const paths = strokes.map(s => `<path d="${strokePath(s)}" stroke="${esc(s.color)}" stroke-width="${s.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"${s.tool === 'highlighter' ? ' opacity=".45"' : ''}/>`).join('');
  return { id: uid(), name: 'Mijn tekening', vb: `0 0 ${w} ${h}`, w, h, svg: `<g transform="scale(${k.toFixed(4)}) translate(${-x0} ${-y0})">${paths}</g>` };
}

const ALLOWED = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'use', 'pattern', 'symbol', 'title', 'desc']);

// Een geüploade SVG veilig maken: geen scripts, events of externe links; id's krijgen een eigen voorvoegsel.
export function stickerFromSVG(text, name = 'Eigen sticker') {
  if (text.length > MAX_SVG * 4) throw new Error('Dit SVG-bestand is te groot (max. ongeveer 200 kB).');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('Dit is geen geldig SVG-bestand.');

  let vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some(n => !isFinite(n))) {
    const w = parseFloat(root.getAttribute('width')) || 100, h = parseFloat(root.getAttribute('height')) || 100;
    vb = [0, 0, w, h];
  }
  const [vx, vy, vw, vh] = vb;
  if (!(vw > 0 && vh > 0)) throw new Error('Dit SVG-bestand heeft geen geldige afmetingen.');

  const prefix = `s${uid()}-`;
  const clean = el => {
    for (const child of [...el.children]) {
      if (!ALLOWED.has(child.nodeName.toLowerCase())) { child.remove(); continue; }
      for (const a of [...child.attributes]) {
        const n = a.name.toLowerCase(), v = a.value;
        if (n.startsWith('on') || n === 'style' && /url\(\s*['"]?(?!#)/i.test(v)) child.removeAttribute(a.name);
        else if ((n === 'href' || n === 'xlink:href') && !v.startsWith('#')) child.removeAttribute(a.name);
        else if (n === 'id') child.setAttribute('id', prefix + v);
        else if (/url\(#/.test(v)) child.setAttribute(a.name, v.replace(/url\(#/g, `url(#${prefix}`));
        else if (n === 'href' || n === 'xlink:href') child.setAttribute(a.name, `#${prefix}${v.slice(1)}`);
      }
      clean(child);
    }
  };
  clean(root);
  const inner = [...root.children].map(c => new XMLSerializer().serializeToString(c)).join('')
    .replace(/ xmlns(:\w+)?="[^"]*"/g, '');
  if (!inner.trim()) throw new Error('Er staat niets bruikbaars in dit SVG-bestand.');
  if (inner.length > MAX_SVG) throw new Error('Dit SVG-bestand is te ingewikkeld (te veel punten).');

  const k = 100 / Math.max(vw, vh);
  const w = Math.round(vw * k * 10) / 10, h = Math.round(vh * k * 10) / 10;
  return { id: uid(), name, vb: `0 0 ${w} ${h}`, w, h, svg: `<g transform="scale(${k.toFixed(4)}) translate(${-vx} ${-vy})">${inner}</g>` };
}
