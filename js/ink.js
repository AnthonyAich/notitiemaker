// Pennenstreken en vormen: paden, omkadering, raaktest en vormherkenning.
// Een gewone streek heeft `points`; een vorm heeft daarnaast `shape`
// ('line', 'arrow', 'rect' of 'ellipse') en precies twee punten (begin en einde).

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

function arrowWings(s) {
  const [[x0, y0], [x1, y1]] = s.points;
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.max(14, s.width * 4.5);
  const wing = a => [r1(x1 - len * Math.cos(ang + a)), r1(y1 - len * Math.sin(ang + a))];
  return [wing(0.5), wing(-0.5)];
}

// Het SVG-pad van een streek of vorm.
export function strokePath(s) {
  if (!s.shape) return pathFromPoints(s.points);
  const [[x0, y0], [x1, y1]] = s.points;
  switch (s.shape) {
    case 'line':
      return `M${x0} ${y0}L${x1} ${y1}`;
    case 'arrow': {
      const [a, b] = arrowWings(s);
      return `M${x0} ${y0}L${x1} ${y1}M${a[0]} ${a[1]}L${x1} ${y1}L${b[0]} ${b[1]}`;
    }
    case 'rect':
      return `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
    case 'ellipse': {
      const cx = r1((x0 + x1) / 2), cy = r1((y0 + y1) / 2);
      const rx = r1(Math.abs(x1 - x0) / 2) || 0.1, ry = r1(Math.abs(y1 - y0) / 2) || 0.1;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
  }
  return '';
}

// Punten langs de getekende lijn, voor raaktest, omkadering en lasso.
const outlines = new WeakMap();
export function strokeOutline(s) {
  if (!s.shape) return s.points;
  let o = outlines.get(s);
  if (o) return o;
  const [[x0, y0], [x1, y1]] = s.points;
  const seg = (a, b, n = 12) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  if (s.shape === 'line') o = seg([x0, y0], [x1, y1]);
  else if (s.shape === 'arrow') {
    const [a, b] = arrowWings(s);
    o = [...seg([x0, y0], [x1, y1]), ...seg([x1, y1], a, 3), [x1, y1], ...seg([x1, y1], b, 3)];
  } else if (s.shape === 'rect') {
    o = [...seg([x0, y0], [x1, y0]), ...seg([x1, y0], [x1, y1]), ...seg([x1, y1], [x0, y1]), ...seg([x0, y1], [x0, y0])];
  } else {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
    o = Array.from({ length: 49 }, (_, i) => [cx + rx * Math.cos(i / 48 * Math.PI * 2), cy + ry * Math.sin(i / 48 * Math.PI * 2)]);
  }
  outlines.set(s, o);
  return o;
}

const boxes = new WeakMap();
export function strokeBBox(s) {
  let b = boxes.get(s);
  if (b) return b;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of strokeOutline(s)) {
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
  const p = strokeOutline(s);
  const rr = radius + s.width / 2;
  if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= rr;
  for (let i = 0; i < p.length - 1; i++) if (segDist(x, y, p[i], p[i + 1]) <= rr) return true;
  return false;
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Is een streek grotendeels binnen de lasso?
export function strokeInPolygon(s, poly) {
  const pts = strokeOutline(s);
  const step = Math.max(1, Math.floor(pts.length / 30));
  let n = 0, inside = 0;
  for (let i = 0; i < pts.length; i += step) {
    n++;
    if (pointInPolygon(pts[i][0], pts[i][1], poly)) inside++;
  }
  return inside / n >= 0.6;
}

// Herkent een rechte lijn, rechthoek of ellips in een handgetekende streek.
export function recognizeShape(pts, lineOnly = false) {
  if (pts.length < 4) return null;
  const first = pts[0], last = pts[pts.length - 1];
  let len = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (i) len += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const ends = Math.hypot(last[0] - first[0], last[1] - first[1]);
  const maxDev = Math.max(...pts.map(([x, y]) => segDist(x, y, first, last)));
  if (ends > 20 && maxDev < Math.max(6, len * 0.06)) return { shape: 'line', points: [first, last] };
  if (lineOnly) return null;

  const w = x1 - x0, h = y1 - y0, diag = Math.hypot(w, h);
  if (diag < 30 || ends > diag * 0.25 || Math.min(w, h) < 12) return null;
  const tol = Math.min(w, h) * 0.12 + 3;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let rect = 0, ell = 0;
  for (const [x, y] of pts) {
    if (Math.min(Math.abs(x - x0), Math.abs(x - x1), Math.abs(y - y0), Math.abs(y - y1)) < tol) rect++;
    if (Math.abs(Math.hypot((x - cx) / (w / 2), (y - cy) / (h / 2)) - 1) < 0.16) ell++;
  }
  rect /= pts.length;
  ell /= pts.length;
  const box = [[r1(x0), r1(y0)], [r1(x1), r1(y1)]];
  if (rect >= 0.75 && rect >= ell) return { shape: 'rect', points: box };
  if (ell >= 0.7) return { shape: 'ellipse', points: box };
  return null;
}
