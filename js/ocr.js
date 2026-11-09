// Handschrift doorzoekbaar maken: de pennenstreken worden als afbeelding naar
// het Apps Script gestuurd, dat ze met Google Drive-tekstherkenning (OCR) leest.
import { strokePath, strokeBBox } from './ink.js';
import { PAGE_W, PAGE_H, pageTop } from './model.js';

const MAX_SIDE = 2000;

const penStrokes = doc => (doc.content.strokes || []).filter(s => s.tool !== 'highlighter' && !s.shape);

// Verandert zodra er handschrift bijkomt, verdwijnt of verschuift.
export function inkSignature(doc) {
  const strokes = penStrokes(doc);
  let n = 0;
  for (const s of strokes) n += s.points.length + s.points[0][0] + s.points[0][1];
  return `${strokes.length}:${Math.round(n)}`;
}

export function needsOcr(doc) {
  const sig = inkSignature(doc);
  return (doc.ocr?.sig || '0:0') !== sig;
}

// Gebieden om te herkennen: per notebookpagina, of het hele whiteboard.
function regions(doc) {
  const strokes = penStrokes(doc);
  if (!strokes.length) return [];
  if (doc.type === 'notebook') {
    const out = [];
    for (let i = 1; i < (doc.content.pages || 1); i++) {
      const top = pageTop(i);
      const own = strokes.filter(s => { const b = strokeBBox(s); return b.y < top + PAGE_H && b.y + b.h > top; });
      if (own.length) out.push({ x: 0, y: top, w: PAGE_W, h: PAGE_H, strokes: own });
    }
    return out;
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const b = strokeBBox(s);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return [{ x: x0 - 20, y: y0 - 20, w: x1 - x0 + 40, h: y1 - y0 + 40, strokes }];
}

async function toPNG(region) {
  const scale = Math.min(2, MAX_SIDE / Math.max(region.w, region.h));
  const w = Math.max(1, Math.round(region.w * scale)), h = Math.max(1, Math.round(region.h * scale));
  const paths = region.strokes.map(s =>
    `<path d="${strokePath(s)}" stroke="#000" stroke-width="${Math.max(2, s.width)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${region.x} ${region.y} ${region.w} ${region.h}"><rect x="${region.x}" y="${region.y}" width="${region.w}" height="${region.h}" fill="#fff"/>${paths}</svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
}

// Geeft { sig, text } terug, of null als er geen handschrift is.
export async function recognize(doc, request) {
  const sig = inkSignature(doc);
  const parts = regions(doc);
  if (!parts.length) return { sig, text: '' };
  const images = [];
  for (const r of parts) images.push(await toPNG(r));
  const { texts } = await request('ocr', { images });
  return { sig, text: texts.join('\n').replace(/\s+\n/g, '\n').trim() };
}
