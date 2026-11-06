// Pennenstreken: vloeiende paden, omkadering en raaktest voor de gum.

const r1 = v => Math.round(v * 10) / 10;

export function pathFromPoints(pts) {
  if (!pts.length) return '';
  const [x0, y0] = pts[0];
  if (pts.length === 1) return `M${x0} ${y0}L${x0 + 0.1} ${y0}`;
  let d = `M${x0} ${y0}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    d += `Q${x1} ${y1} ${r1((x1 + x2) / 2)} ${r1((y1 + y2) / 2)}`;
  }
  const [xl, yl] = pts[pts.length - 1];
  return `${d}L${xl} ${yl}`;
}

const boxes = new WeakMap();
export function strokeBBox(s) {
  let b = boxes.get(s);
  if (b) return b;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of s.points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const h = s.width / 2;
  b = { x: x0 - h, y: y0 - h, w: x1 - x0 + s.width, h: y1 - y0 + s.width };
  boxes.set(s, b);
  return b;
}

function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0;
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}

export function hitStroke(s, x, y, radius) {
  const b = strokeBBox(s);
  if (x < b.x - radius || x > b.x + b.w + radius || y < b.y - radius || y > b.y + b.h + radius) return false;
  const p = s.points;
  const rr = radius + s.width / 2;
  if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= rr;
  for (let i = 0; i < p.length - 1; i++) if (segDist(x, y, p[i], p[i + 1]) <= rr) return true;
  return false;
}
