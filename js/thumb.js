// Miniatuurweergave van een document voor de bibliotheek.
import { STICKY_COLORS, coverSVG } from './model.js';
import { strokePath, strokeBBox } from './ink.js';
import { esc } from './ui.js';
import { stickerParts } from './stickers.js';

export function thumbSVG(doc) {
  if (doc.type === 'notebook') return coverSVG(doc);

  const { items = [], strokes = [] } = doc.content || {};
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y, w, h) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  };
  const parts = [];

  for (const it of items) {
    if (it.kind === 'sticky') {
      const col = STICKY_COLORS[it.color] || STICKY_COLORS.geel;
      const lines = it.lines || [];
      const h = Math.max(it.h, 56 + lines.length * 26);
      grow(it.x, it.y, it.w, h);
      parts.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${h}" fill="${col.bg}"/>`);
      if (it.title) parts.push(`<rect x="${it.x + 16}" y="${it.y + 18}" width="${Math.min(it.w - 32, 12 + it.title.length * 9)}" height="9" rx="3" fill="rgba(0,0,0,.45)"/>`);
      lines.forEach((l, i) => {
        const lx = it.x + 16 + (l.indent || 0) * 20;
        parts.push(`<rect x="${lx}" y="${it.y + 48 + i * 26}" width="${Math.min(it.x + it.w - 16 - lx, 14 + l.text.length * 8)}" height="${l.hl ? 16 : 8}" rx="${l.hl ? 8 : 3}" fill="${l.hl ? col.hl : 'rgba(0,0,0,.28)'}"/>`);
      });
    } else if (it.kind === 'sticker') {
      const p = stickerParts(it);
      grow(it.x, it.y, it.w, it.h);
      parts.push(`<g transform="rotate(${it.rot || 0} ${it.x + it.w / 2} ${it.y + it.h / 2})"><svg x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" viewBox="${p.vb}" overflow="visible">${p.body}</svg></g>`);
    } else {
      const rows = String(it.text || '').split('\n');
      const w = Math.max(...rows.map(r => r.length)) * it.size * 0.45;
      grow(it.x, it.y, w, rows.length * it.size * 1.2);
      rows.forEach((r, i) => parts.push(`<rect x="${it.x}" y="${it.y + i * it.size * 1.2 + it.size * 0.4}" width="${r.length * it.size * 0.45}" height="${it.size * 0.4}" rx="3" fill="${esc(it.color)}" opacity=".7"/>`));
    }
  }

  for (const s of strokes) {
    const b = strokeBBox(s);
    grow(b.x, b.y, b.w, b.h);
    const hl = s.tool === 'highlighter' ? ' opacity=".45"' : '';
    parts.push(`<path d="${strokePath(s)}" stroke="${esc(s.color)}" stroke-width="${s.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"${hl}/>`);
  }

  if (!parts.length) return '<svg viewBox="0 0 400 300"></svg>';
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06 + 20;
  return `<svg viewBox="${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
}
