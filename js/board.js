// Het canvas: oneindig whiteboard of notebook met pagina's.
// Wereldcoördinaten worden met translate + scale op het scherm gezet.
import { strokePath, hitStroke, strokeBBox, strokeInPolygon, pointInPolygon, recognizeShape } from './ink.js';
import { PAGE_W, PAGE_H, STICKY_COLORS, INK_COLORS, coverSVG, weekPageSVG, pageTop, uid, lineDate } from './model.js';
import { confetti } from './fx.js';
import { stickerParts, stickerFromStrokes } from './stickers.js';
import { esc, icon } from './ui.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const MIN_Z = 0.1;
const MAX_Z = 4;
const OPTS_KEY = 'notitiemaker.tools.v1';
const VIEW_KEY = 'notitiemaker.view.';
const MAX_UNDO = 60;
const HOLD_MS = 550;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
// Tussenliggende punten van snelle pennenbewegingen (niet elke browser levert ze).
const coalesced = e => {
  const list = e.getCoalescedEvents?.();
  return list?.length ? list : [e];
};

const DEFAULT_OPTS = {
  tool: 'pen',
  penColor: '#1d1d1f', penWidth: 3,
  hlColor: '#ffe066', hlWidth: 20,
  textColor: '#1d1d1f', textSize: 28,
  stickyColor: 'geel',
  shapeKind: 'arrow',
  stickerKey: 'klaar', stickerCat: 'status',
};

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* geen opslag beschikbaar */ }
}

function linesToText(lines) {
  return (lines || []).map(l => '  '.repeat(l.indent || 0) + l.text).join('\n');
}

// Elke niet-lege regel wordt een bolletje; spaties vooraan bepalen het inspringen.
// Markeringen blijven bewaard voor regels waarvan de tekst niet veranderde.
function textToLines(text, old) {
  const marked = new Map((old || []).map(l => [l.text, l.hl]));
  return text.split('\n').filter(s => s.trim()).map(s => {
    const m = s.match(/^(\s*)(?:[-•*]\s+)?(.*)$/);
    const indent = Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
    const t = m[2].trim();
    return { text: t, indent, hl: !!marked.get(t) };
  });
}

const DUE_TITLES = { today: 'Vandaag', soon: 'Binnenkort', past: 'Datum voorbij', later: '' };

// Tekst van een regel; een datum vooraan krijgt een label.
function lineHTML(l) {
  const d = lineDate(l.text);
  if (!d) return esc(l.text);
  const state = l.hl ? 'done' : d.state;
  return `<b class="due due-${state}" title="${DUE_TITLES[d.state]}">${esc(d.label)}</b> ${esc(d.rest)}`;
}

// ---------- weergave als HTML (ook gebruikt om af te drukken) ----------

function pagesHTML(doc, only = null) {
  if (doc.type !== 'notebook') return '';
  let html = '';
  for (let i = 0; i < (doc.content.pages || 1); i++) {
    if (only != null && i !== only) continue;
    const paper = doc.paper || 'lijnen';
    const cls = i === 0 ? 'cover' : `paper-${paper}`;
    const inner = i === 0 ? coverSVG(doc) : paper === 'week' ? weekPageSVG() : '';
    html += `<div class="page ${cls}" style="top:${pageTop(i)}px;width:${PAGE_W}px;height:${PAGE_H}px">${inner}</div>`;
  }
  return html;
}

function itemHTML(it, selected) {
  const sel = it.id === selected ? ' selected' : '';
  if (it.kind === 'sticky') {
    const col = STICKY_COLORS[it.color] || STICKY_COLORS.geel;
    const lines = (it.lines || []).map((l, i) =>
      `<li data-i="${i}" class="lvl-${l.indent || 0}${l.hl ? ' hl' : ''}"><span>${lineHTML(l)}</span></li>`).join('');
    return `<div class="item sticky${sel}" data-id="${it.id}" style="left:${it.x}px;top:${it.y}px;width:${it.w}px;min-height:${it.h}px;--bg:${col.bg};--hl:${col.hl}">
      <div class="sticky-title">${esc(it.title)}</div><ul class="sticky-lines">${lines}</ul><div class="handle"></div></div>`;
  }
  if (it.kind === 'sticker') {
    const p = stickerParts(it);
    return `<div class="item sticker${sel}" data-id="${it.id}" style="left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;transform:rotate(${it.rot || 0}deg)">
      <svg viewBox="${p.vb}" preserveAspectRatio="xMidYMid meet"><g${p.cut ? ' filter="url(#sticker-cut)"' : ''}>${p.body}</g></svg>
      <div class="handle"></div><div class="rot-handle" title="Draaien"></div></div>`;
  }
  return `<div class="item text${sel}" data-id="${it.id}" style="left:${it.x}px;top:${it.y}px;font-size:${it.size}px;color:${esc(it.color)}">${esc(it.text)}</div>`;
}

const pathCache = new WeakMap();
function strokeHTML(s) {
  let d = pathCache.get(s);
  if (!d) { d = strokePath(s); pathCache.set(s, d); }
  return `<path d="${d}" stroke="${esc(s.color)}" stroke-width="${s.width}"/>`;
}

function inkHTML(strokes) {
  let hl = '', pen = '';
  for (const s of strokes) {
    if (s.tool === 'highlighter') hl += strokeHTML(s);
    else pen += strokeHTML(s);
  }
  return { hl, pen };
}

// De hele wereld als HTML. Met `page` alleen wat op die notebookpagina staat.
export function worldHTML(doc, page = null) {
  let { items = [], strokes = [] } = doc.content;
  if (page != null) {
    const top = pageTop(page), bottom = top + PAGE_H;
    items = items.filter(it => it.y < bottom && it.y + (it.h || 200) > top - 400);
    strokes = strokes.filter(s => { const b = strokeBBox(s); return b.y < bottom && b.y + b.h > top; });
  }
  const ink = inkHTML(strokes);
  return `<div class="pages-layer">${pagesHTML(doc, page)}</div>
    <div class="items-layer">${items.map(it => itemHTML(it, null)).join('')}</div>
    <svg class="ink-layer" width="1" height="1"><g class="ink-hl">${ink.hl}</g><g class="ink-pen">${ink.pen}</g></svg>`;
}

export class Board {
  constructor(host, doc, cb = {}) {
    this.cb = cb;
    this.opts = { ...DEFAULT_OPTS, ...readJSON(OPTS_KEY) };
    this.tool = this.opts.tool;
    this.view = { x: 0, y: 0, z: 1 };
    this.pointers = new Map();
    this.action = null;
    this.editing = null;
    this.selected = null;
    this.lasso = null;
    this.lastTap = null;
    this.penSeen = false;
    this.spaceDown = false;
    this.undoStack = [];
    this.redoStack = [];

    this.el = document.createElement('div');
    this.el.className = 'board';
    this.el.innerHTML = `
      <div class="world">
        <div class="pages-layer"></div>
        <div class="items-layer"></div>
        <svg class="ink-layer" width="1" height="1"><g class="ink-hl"></g><g class="ink-pen"></g><g class="ink-live"></g></svg>
        <div class="lasso-box" hidden><div class="lasso-handle"></div></div>
      </div>
      <div class="item-bar" hidden></div>`;
    host.replaceChildren(this.el);
    this.world = this.el.querySelector('.world');
    this.pagesLayer = this.el.querySelector('.pages-layer');
    this.itemsLayer = this.el.querySelector('.items-layer');
    this.gHl = this.el.querySelector('.ink-hl');
    this.gPen = this.el.querySelector('.ink-pen');
    this.gLive = this.el.querySelector('.ink-live');
    this.lassoBox = this.el.querySelector('.lasso-box');
    this.bar = this.el.querySelector('.item-bar');

    this.bind();
    this.setTool(this.tool);
    this.load(doc, true);
  }

  // ---------- document ----------

  load(doc, initial = false) {
    this.doc = doc;
    this.c = doc.content;
    this.c.items ||= [];
    this.c.strokes ||= [];
    this.isNotebook = doc.type === 'notebook';
    this.el.classList.toggle('notebook', this.isNotebook);
    if (!this.c.items.some(i => i.id === this.selected)) this.selected = null;
    this.lasso = null;
    this.renderAll();
    if (initial) {
      const v = readJSON(VIEW_KEY + doc.id);
      if (v) { this.view = v; this.applyView(); }
      else requestAnimationFrame(() => this.fit());
      this.emitHistory();
    }
  }

  busy() {
    return !!(this.editing || this.action);
  }

  changed() {
    this.cb.onChange?.(this.doc);
  }

  item(id) {
    return this.c.items.find(i => i.id === id);
  }

  itemEl(id) {
    return this.itemsLayer.querySelector(`[data-id="${CSS.escape(id)}"]`);
  }

  // ---------- geschiedenis ----------

  snapshot() {
    return JSON.stringify({ items: this.c.items, strokes: this.c.strokes, pages: this.c.pages });
  }

  restore(s) {
    const o = JSON.parse(s);
    this.c.items = o.items;
    this.c.strokes = o.strokes;
    if (o.pages != null) this.c.pages = o.pages;
    this.selected = null;
    this.lasso = null;
    this.renderAll();
  }

  pushUndo(snap) {
    this.undoStack.push(snap);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.emitHistory();
  }

  // Na het samenvoegen met een andere versie mag ongedaan maken die niet terugdraaien.
  resetHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.emitHistory();
  }

  emitHistory() {
    this.cb.onHistory?.(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  undo() {
    this.finishEdit();
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
    this.changed();
    this.emitHistory();
  }

  redo() {
    this.finishEdit();
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
    this.changed();
    this.emitHistory();
  }

  // ---------- instellingen ----------

  setTool(t) {
    this.finishEdit();
    this.tool = t;
    this.el.dataset.tool = t;
    if (t !== 'select') this.select(null);
    if (t !== 'lasso') this.setLasso(null);
    this.setOpt('tool', t);
  }

  setOpt(k, v) {
    this.opts[k] = v;
    writeJSON(OPTS_KEY, this.opts);
  }

  // ---------- weergave ----------

  applyView() {
    const { x, y, z } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    this.world.style.setProperty('--z', z);
    if (!this.isNotebook) {
      this.el.style.backgroundSize = `${24 * z}px ${24 * z}px`;
      this.el.style.backgroundPosition = `${x}px ${y}px`;
    } else {
      this.el.style.backgroundSize = this.el.style.backgroundPosition = '';
    }
    this.positionBar();
    this.cb.onView?.(z);
    clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => writeJSON(VIEW_KEY + this.doc.id, this.view), 400);
  }

  zoomAt(px, py, z) {
    z = clamp(z, MIN_Z, MAX_Z);
    const wx = (px - this.view.x) / this.view.z;
    const wy = (py - this.view.y) / this.view.z;
    this.view = { x: px - wx * z, y: py - wy * z, z };
    this.applyView();
  }

  zoomBy(f) {
    this.zoomAt(this.el.clientWidth / 2, this.el.clientHeight / 2, this.view.z * f);
  }

  itemRect(it) {
    const el = this.itemEl(it.id);
    return { x: it.x, y: it.y, w: el ? el.offsetWidth : it.w || 0, h: el ? el.offsetHeight : it.h || 0 };
  }

  // Omkadering van items en streken (standaard alles).
  bounds(items = this.c.items, strokes = this.c.strokes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = b => {
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    };
    items.forEach(it => grow(this.itemRect(it)));
    strokes.forEach(s => grow(strokeBBox(s)));
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  fit() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    if (this.isNotebook) {
      const z = clamp((w - 48) / PAGE_W, MIN_Z, 1.2);
      this.view = { x: (w - PAGE_W * z) / 2, y: 24, z };
    } else {
      const b = this.bounds();
      if (!b) {
        this.view = { x: w / 2 - 150, y: h / 3, z: 1 };
      } else {
        const pad = 60;
        const z = clamp(Math.min((w - pad * 2) / b.w, (h - pad * 2) / b.h), MIN_Z, 1);
        this.view = { x: (w - b.w * z) / 2 - b.x * z, y: (h - b.h * z) / 2 - b.y * z, z };
      }
    }
    this.applyView();
  }

  local(e) {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  toWorld(px, py) {
    return [(px - this.view.x) / this.view.z, (py - this.view.y) / this.view.z];
  }

  // ---------- tekenen van de inhoud ----------

  renderAll() {
    this.renderPages();
    this.renderItems();
    this.renderInk();
  }

  renderPages() {
    this.pagesLayer.innerHTML = pagesHTML(this.doc);
  }

  renderItems() {
    this.itemsLayer.innerHTML = this.c.items.map(it => itemHTML(it, this.selected)).join('');
    this.renderLasso();
    this.updateBar();
  }

  renderInk() {
    const ink = inkHTML(this.c.strokes);
    this.gHl.innerHTML = ink.hl;
    this.gPen.innerHTML = ink.pen;
    this.renderLasso();
  }

  // ---------- selectie en balk ----------

  select(id) {
    this.selected = id;
    for (const n of this.itemsLayer.children) n.classList.toggle('selected', n.dataset.id === id);
    this.updateBar();
  }

  setLasso(sel) {
    this.lasso = sel && (sel.strokes.size || sel.items.size) ? sel : null;
    this.renderLasso();
    this.updateBar();
  }

  lassoParts() {
    const { strokes, items } = this.lasso;
    return {
      strokes: this.c.strokes.filter(s => strokes.has(s.id)),
      items: this.c.items.filter(i => items.has(i.id)),
    };
  }

  lassoRect() {
    if (!this.lasso) return null;
    const p = this.lassoParts();
    return this.bounds(p.items, p.strokes);
  }

  renderLasso() {
    const b = this.lassoRect();
    if (!b) { this.lassoBox.hidden = true; return; }
    const pad = 8;
    Object.assign(this.lassoBox.style, {
      left: `${b.x - pad}px`, top: `${b.y - pad}px`, width: `${b.w + pad * 2}px`, height: `${b.h + pad * 2}px`,
    });
    this.lassoBox.hidden = false;
  }

  updateBar() {
    let key = null, h = '';
    const colors = list => list.filter(c => c !== '#ffffff').slice(0, 6);
    if (this.tool === 'lasso' && this.lasso && !this.editing) {
      key = `lasso|${[...this.lasso.strokes].join()}|${[...this.lasso.items].join()}`;
      h = `${colors(INK_COLORS).map(c => `<button class="swatch" data-act="lcolor" data-v="${c}" style="--c:${c}" title="Kleur van het handschrift"></button>`).join('')}
        <span class="sep"></span>
        <button data-act="lsticker" title="Bewaar het handschrift als eigen sticker">${icon('sticker')}<span>Sticker</span></button>
        <button data-act="ldup" title="Dupliceren (⌘D)">${icon('copy')}</button>
        <button data-act="ldel" title="Verwijderen (⌫)">${icon('trash')}</button>`;
    } else if (this.tool === 'select' && this.selected && !this.editing) {
      const it = this.item(this.selected);
      if (it) {
        key = `${it.id}|${it.color}`;
        h = it.kind === 'sticker' ? '' : `<button data-act="edit">${icon('edit')}<span>Bewerk</span></button><span class="sep"></span>`;
        if (it.kind !== 'sticker') h += it.kind === 'sticky'
          ? Object.entries(STICKY_COLORS).map(([k, c]) =>
            `<button class="swatch${it.color === k ? ' on' : ''}" data-act="color" data-v="${k}" style="--c:${c.bg}" title="${k}"></button>`).join('')
          : colors(INK_COLORS).map(c =>
            `<button class="swatch${it.color === c ? ' on' : ''}" data-act="color" data-v="${c}" style="--c:${c}"></button>`).join('');
        h += `${it.kind === 'sticker' ? '' : '<span class="sep"></span>'}
          <button data-act="front" title="Naar voren">${icon('front')}</button>
          <button data-act="dup" title="Dupliceren (⌘D)">${icon('copy')}</button>
          <button data-act="del" title="Verwijderen (⌫)">${icon('trash')}</button>`;
      }
    }
    if (!key) { this.bar.hidden = true; this.barKey = null; return; }
    if (key !== this.barKey) { this.barKey = key; this.bar.innerHTML = h; }
    this.bar.hidden = false;
    this.positionBar();
  }

  positionBar() {
    if (this.bar.hidden) return;
    let r = null;
    if (this.tool === 'lasso') r = this.lassoRect();
    else {
      const it = this.item(this.selected);
      if (it) r = this.itemRect(it);
    }
    if (!r) return;
    const { x, y, z } = this.view;
    const cx = clamp(x + (r.x + r.w / 2) * z, 120, this.el.clientWidth - 120);
    let top = y + r.y * z - 18;
    const below = top < 110;
    if (below) top = y + (r.y + r.h) * z + 18;
    this.bar.classList.toggle('below', below);
    this.bar.style.left = `${cx}px`;
    this.bar.style.top = `${top}px`;
  }

  barAction(act, v) {
    if (act === 'lcolor') return this.lassoColor(v);
    if (act === 'lsticker') return this.lassoToSticker();
    if (act === 'ldup') return this.lassoDuplicate();
    if (act === 'ldel') return this.lassoDelete();
    const it = this.item(this.selected);
    if (!it) return;
    if (act === 'edit') return this.startEdit(it.id);
    this.pushUndo(this.snapshot());
    if (act === 'color') it.color = v;
    if (act === 'front') {
      this.c.items = this.c.items.filter(i => i !== it).concat(it);
    }
    if (act === 'dup') return this.duplicate(true);
    if (act === 'del') return this.deleteSelected(true);
    this.renderItems();
    this.changed();
  }

  duplicate(undoPushed = false) {
    const it = this.item(this.selected);
    if (!it) return;
    if (!undoPushed) this.pushUndo(this.snapshot());
    const copy = { ...JSON.parse(JSON.stringify(it)), id: uid(), x: it.x + 24, y: it.y + 24 };
    this.c.items.push(copy);
    this.selected = copy.id;
    this.renderItems();
    this.changed();
  }

  deleteSelected(undoPushed = false) {
    if (!this.selected) return;
    if (!undoPushed) this.pushUndo(this.snapshot());
    this.c.items = this.c.items.filter(i => i.id !== this.selected);
    this.selected = null;
    this.renderItems();
    this.changed();
  }

  // ---------- lasso-acties ----------

  lassoColor(color) {
    if (!this.lasso) return;
    this.pushUndo(this.snapshot());
    this.c.strokes = this.c.strokes.map(s => this.lasso.strokes.has(s.id) && s.tool !== 'highlighter' ? { ...s, color } : s);
    this.c.items.forEach(it => { if (this.lasso.items.has(it.id) && it.kind === 'text') it.color = color; });
    this.renderAll();
    this.changed();
  }

  lassoDuplicate() {
    if (!this.lasso) return;
    this.pushUndo(this.snapshot());
    const p = this.lassoParts();
    const shift = ([x, y]) => [r1(x + 24), r1(y + 24)];
    const strokes = p.strokes.map(s => ({ ...s, id: uid(), points: s.points.map(shift) }));
    const items = p.items.map(it => ({ ...JSON.parse(JSON.stringify(it)), id: uid(), x: it.x + 24, y: it.y + 24 }));
    this.c.strokes.push(...strokes);
    this.c.items.push(...items);
    this.lasso = { strokes: new Set(strokes.map(s => s.id)), items: new Set(items.map(i => i.id)) };
    this.renderAll();
    this.updateBar();
    this.changed();
  }

  lassoDelete() {
    if (!this.lasso) return;
    this.pushUndo(this.snapshot());
    const { strokes, items } = this.lasso;
    this.c.strokes = this.c.strokes.filter(s => !strokes.has(s.id));
    this.c.items = this.c.items.filter(i => !items.has(i.id));
    this.lasso = null;
    this.renderAll();
    this.updateBar();
    this.changed();
  }

  // Verplaatst (k = 1) of schaalt de lasso-selectie vanuit (ax, ay), vertrekkend van de originelen.
  lassoTransform(a, dx, dy, k = 1) {
    const { ax = 0, ay = 0 } = a;
    const tf = ([x, y]) => [r1(ax + (x - ax) * k + dx), r1(ay + (y - ay) * k + dy)];
    this.c.strokes = this.c.strokes.map(s => {
      const o = a.orig.strokes.get(s.id);
      return o ? { ...s, points: o.points.map(tf), width: r1(Math.max(0.5, o.width * k)) } : s;
    });
    for (const it of this.c.items) {
      const o = a.orig.items.get(it.id);
      if (!o) continue;
      [it.x, it.y] = tf([o.x, o.y]).map(Math.round);
      if (k !== 1) {
        if (it.kind === 'text') it.size = Math.max(8, Math.round(o.size * k));
        else if (it.kind === 'sticker') { const f = Math.max(k, 16 / Math.min(o.w, o.h)); it.w = Math.round(o.w * f); it.h = Math.round(o.h * f); }
        else { it.w = Math.max(140, Math.round(o.w * k)); it.h = Math.max(80, Math.round(o.h * k)); }
      }
    }
    this.renderInk();
    for (const it of this.c.items) {
      if (!a.orig.items.has(it.id)) continue;
      const el = this.itemEl(it.id);
      if (!el) continue;
      el.style.left = `${it.x}px`;
      el.style.top = `${it.y}px`;
      if (it.kind === 'text') el.style.fontSize = `${it.size}px`;
      else if (it.kind === 'sticker') { el.style.width = `${it.w}px`; el.style.height = `${it.h}px`; }
      else { el.style.width = `${it.w}px`; el.style.minHeight = `${it.h}px`; }
    }
    this.renderLasso();
    this.positionBar();
  }

  lassoOriginals() {
    const p = this.lassoParts();
    return {
      strokes: new Map(p.strokes.map(s => [s.id, { points: s.points, width: s.width }])),
      items: new Map(p.items.map(i => [i.id, { x: i.x, y: i.y, w: i.w, h: i.h, size: i.size }])),
    };
  }

  // Het geselecteerde handschrift wordt een eigen sticker (de streken blijven staan).
  lassoToSticker() {
    if (!this.lasso) return;
    const sticker = stickerFromStrokes(this.lassoParts().strokes);
    if (sticker) this.cb.onSaveSticker?.(sticker);
    else this.cb.onMessage?.('Omcirkel eerst iets dat je getekend hebt.');
  }

  addSticker(wx, wy) {
    const data = this.cb.stickerData?.(this.opts.stickerKey);
    if (!data) return;
    const size = 96;
    const ratio = (data.w || 100) / (data.h || 100);
    const w = Math.round(ratio >= 1 ? size : size * ratio), h = Math.round(ratio >= 1 ? size / ratio : size);
    this.pushUndo(this.snapshot());
    const it = {
      id: uid(), kind: 'sticker', x: Math.round(wx - w / 2), y: Math.round(wy - h / 2), w, h,
      // Een klein willekeurig hoekje, zoals een echte sticker.
      rot: Math.round((Math.random() - 0.5) * 12),
      ...(data.key ? { key: data.key } : { svg: data.svg, vb: data.vb }),
    };
    this.c.items.push(it);
    this.renderItems();
    this.changed();
  }

  addPage() {
    if (!this.isNotebook) return;
    this.finishEdit();
    this.pushUndo(this.snapshot());
    this.c.pages = (this.c.pages || 1) + 1;
    this.renderPages();
    this.changed();
    this.view.y = 24 - pageTop(this.c.pages - 1) * this.view.z;
    this.applyView();
  }

  // ---------- nieuwe items en bewerken ----------

  addText(wx, wy) {
    const snap = this.snapshot();
    const it = { id: uid(), kind: 'text', x: Math.round(wx), y: Math.round(wy - this.opts.textSize * 0.6), text: '', size: this.opts.textSize, color: this.opts.textColor };
    this.c.items.push(it);
    this.renderItems();
    this.startEdit(it.id, { isNew: true, snap });
  }

  addSticky(wx, wy) {
    const snap = this.snapshot();
    const it = { id: uid(), kind: 'sticky', x: Math.round(wx - 130), y: Math.round(wy - 24), w: 260, h: 200, color: this.opts.stickyColor, title: '', lines: [] };
    this.c.items.push(it);
    this.renderItems();
    this.startEdit(it.id, { isNew: true, snap });
  }

  startEdit(id, { isNew = false, snap = this.snapshot() } = {}) {
    this.finishEdit();
    const it = this.item(id);
    const el = this.itemEl(id);
    if (!it || !el || it.kind === 'sticker') return;
    this.editing = { id, isNew, snap };
    this.select(id);
    el.classList.add('editing');

    if (it.kind === 'sticky') {
      el.innerHTML = `<input class="edit-title" placeholder="Titel" value="${esc(it.title)}" enterkeyhint="next">
        <textarea class="edit-lines" placeholder="Eén taak per regel&#10;  Twee spaties vooraan = inspringen">${esc(linesToText(it.lines))}</textarea>
        <div class="edit-hint">Tik ernaast of druk Esc om op te slaan</div>`;
      const input = el.querySelector('input');
      const ta = el.querySelector('textarea');
      const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
      ta.addEventListener('input', grow);
      grow();
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ta.focus(); } });
      el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); this.finishEdit(); } });
      (it.title || !isNew ? ta : input).focus();
    } else {
      el.contentEditable = 'true';
      el.textContent = it.text;
      el.addEventListener('keydown', e => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); this.finishEdit(); }
      });
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  finishEdit() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const it = this.item(ed.id);
    const el = this.itemEl(ed.id);
    if (!it || !el) return;
    const before = JSON.stringify(it);
    let remove = false;

    if (it.kind === 'sticky') {
      it.title = el.querySelector('.edit-title').value.trim();
      it.lines = textToLines(el.querySelector('.edit-lines').value, it.lines);
      remove = ed.isNew && !it.title && !it.lines.length;
    } else {
      it.text = el.innerText.replace(/\n+$/, '');
      remove = !it.text.trim();
    }

    if (remove) {
      this.c.items = this.c.items.filter(i => i !== it);
      if (this.selected === it.id) this.selected = null;
      if (!ed.isNew) { this.pushUndo(ed.snap); this.changed(); }
    } else if (ed.isNew || JSON.stringify(it) !== before) {
      this.pushUndo(ed.snap);
      this.changed();
    }
    document.activeElement?.blur?.();
    this.renderItems();
  }

  // ---------- invoer ----------

  bind() {
    this.el.addEventListener('pointerdown', e => this.down(e));
    this.el.addEventListener('pointermove', e => this.move(e));
    this.el.addEventListener('pointerup', e => this.up(e, false));
    this.el.addEventListener('pointercancel', e => this.up(e, true));
    this.el.addEventListener('wheel', e => this.wheel(e), { passive: false });
    this.el.addEventListener('gesturestart', e => e.preventDefault());
    this.el.addEventListener('contextmenu', e => { if (!e.target.closest('.editing')) e.preventDefault(); });
    this.bar.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b) this.barAction(b.dataset.act, b.dataset.v);
    });
    this.resizeObs = new ResizeObserver(() => this.positionBar());
    this.resizeObs.observe(this.el);
  }

  destroy() {
    this.finishEdit();
    this.resizeObs.disconnect();
    clearTimeout(this.viewTimer);
    writeJSON(VIEW_KEY + this.doc.id, this.view);
  }

  wheel(e) {
    e.preventDefault();
    const [px, py] = this.local(e);
    const k = e.deltaMode === 1 ? 16 : 1;
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(px, py, this.view.z * Math.exp(-e.deltaY * k * 0.01));
    } else {
      this.view.x -= e.deltaX * k;
      this.view.y -= e.deltaY * k;
      this.applyView();
    }
  }

  livePath(stroke, cls = '') {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('stroke', stroke.color);
    p.setAttribute('stroke-width', stroke.width);
    if (cls) p.setAttribute('class', cls);
    p.setAttribute('d', strokePath(stroke));
    this.gLive.append(p);
    return p;
  }

  down(e) {
    if (e.target.closest('.editing, .item-bar')) return;
    if (e.button === 2) return;
    if (this.editing) this.finishEdit();
    if (e.pointerType === 'pen') this.penSeen = true;
    const [px, py] = this.local(e);
    this.pointers.set(e.pointerId, { x: px, y: py });
    try { this.el.setPointerCapture(e.pointerId); } catch { /* niet erg */ }
    e.preventDefault();

    if (this.pointers.size === 2) {
      // Tweede vinger: knijpen om te zoomen. Een half getekende lijn vervalt.
      this.finishAction(false);
      const [a, b] = [...this.pointers.values()];
      this.action = { type: 'pinch', d0: dist(a, b) || 1, m0: mid(a, b), v0: { ...this.view } };
      return;
    }
    if (this.pointers.size > 2) return;

    let tool = this.tool;
    // Met een Apple Pencil schuift een vinger het canvas; zonder pencil tekent de vinger.
    if (e.button === 1 || this.spaceDown || (e.pointerType === 'touch' && this.penSeen && tool !== 'select')) tool = 'pan';
    const [wx, wy] = this.toWorld(px, py);

    switch (tool) {
      case 'pan':
        this.action = { type: 'pan', sx: px, sy: py, v0: { ...this.view } };
        break;
      case 'pen':
      case 'highlighter': {
        const hl = tool === 'highlighter';
        const s = { id: uid(), tool, color: hl ? this.opts.hlColor : this.opts.penColor, width: hl ? this.opts.hlWidth : this.opts.penWidth, points: [[r1(wx), r1(wy)]] };
        this.action = { type: 'draw', s, p: this.livePath(s, hl ? 'live-hl' : '') };
        break;
      }
      case 'shape': {
        const s = { id: uid(), tool: 'pen', shape: this.opts.shapeKind, color: this.opts.penColor, width: this.opts.penWidth, points: [[r1(wx), r1(wy)], [r1(wx), r1(wy)]] };
        this.action = { type: 'shape', s, p: this.livePath(s), sx: px, sy: py };
        break;
      }
      case 'eraser':
        this.action = { type: 'erase', snap: this.snapshot(), changed: false };
        this.eraseAt(wx, wy);
        break;
      case 'lasso': {
        const b = this.lassoRect();
        const pad = 8, grab = 22 / this.view.z;
        if (b && Math.hypot(wx - (b.x + b.w + pad), wy - (b.y + b.h + pad)) < grab) {
          this.action = { type: 'lscale', sx: px, sy: py, ax: b.x, ay: b.y, bw: Math.max(b.w, 1), bh: Math.max(b.h, 1), orig: this.lassoOriginals(), snap: this.snapshot(), moved: false };
        } else if (b && wx >= b.x - pad && wx <= b.x + b.w + pad && wy >= b.y - pad && wy <= b.y + b.h + pad) {
          this.action = { type: 'lmove', sx: px, sy: py, orig: this.lassoOriginals(), snap: this.snapshot(), moved: false };
        } else {
          this.setLasso(null);
          const p = document.createElementNS(SVGNS, 'path');
          p.setAttribute('class', 'lasso-path');
          this.gLive.append(p);
          this.action = { type: 'lasso', pts: [[wx, wy]], p };
        }
        break;
      }
      case 'text':
      case 'sticky':
      case 'sticker':
        this.action = { type: 'create', tool, wx, wy, sx: px, sy: py, target: e.target.closest('.item')?.dataset.id };
        break;
      case 'select': {
        const itEl = e.target.closest('.item');
        if (!itEl) {
          this.select(null);
          this.action = { type: 'pan', sx: px, sy: py, v0: { ...this.view } };
          break;
        }
        const id = itEl.dataset.id;
        const it = this.item(id);
        const li = e.target.closest('li[data-i]');
        this.select(id);
        if (e.target.closest('.rot-handle')) {
          const r = itEl.getBoundingClientRect(), br = this.el.getBoundingClientRect();
          this.action = { type: 'rotate', id, el: itEl, cx: r.left + r.width / 2 - br.left, cy: r.top + r.height / 2 - br.top, snap: this.snapshot(), moved: false };
          break;
        }
        this.action = {
          type: e.target.closest('.handle') ? 'resize' : 'move',
          id, el: itEl, sx: px, sy: py, ox: it.x, oy: it.y, ow: it.w, oh: it.h,
          moved: false, line: li ? +li.dataset.i : null, snap: this.snapshot(),
        };
      }
    }
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const [px, py] = this.local(e);
    p.x = px; p.y = py;
    const a = this.action;
    if (!a) return;
    const z = this.view.z;
    const [wx, wy] = this.toWorld(px, py);

    switch (a.type) {
      case 'pinch': {
        if (this.pointers.size < 2) return;
        const [p1, p2] = [...this.pointers.values()];
        const m = mid(p1, p2);
        const nz = clamp(a.v0.z * dist(p1, p2) / a.d0, MIN_Z, MAX_Z);
        const ox = (a.m0.x - a.v0.x) / a.v0.z;
        const oy = (a.m0.y - a.v0.y) / a.v0.z;
        this.view = { x: m.x - ox * nz, y: m.y - oy * nz, z: nz };
        this.applyView();
        break;
      }
      case 'pan':
        this.view = { ...a.v0, x: a.v0.x + px - a.sx, y: a.v0.y + py - a.sy };
        this.applyView();
        break;
      case 'draw': {
        if (a.snapped) {
          // Na het herkennen van een rechte lijn volgt het eindpunt de pen.
          if (a.s.shape === 'line') {
            a.s = { ...a.s, points: [a.s.points[0], [r1(wx), r1(wy)]] };
            a.p.setAttribute('d', strokePath(a.s));
          }
          break;
        }
        const pts = a.s.points;
        let added = false;
        for (const ev of coalesced(e)) {
          const [qx, qy] = this.toWorld(...this.local(ev));
          const last = pts[pts.length - 1];
          if (Math.hypot(qx - last[0], qy - last[1]) * z >= 1.2) { pts.push([r1(qx), r1(qy)]); added = true; }
        }
        if (added) {
          a.p.setAttribute('d', strokePath(a.s));
          // Pen even stilhouden aan het einde = rechte lijn of nette vorm.
          clearTimeout(a.hold);
          a.hold = setTimeout(() => this.snapShape(a), HOLD_MS);
        }
        break;
      }
      case 'shape':
        a.s.points[1] = [r1(wx), r1(wy)];
        if (a.s.shape === 'rect' || a.s.shape === 'ellipse') {
          if (e.shiftKey) {
            // Shift = vierkant of cirkel.
            const [x0, y0] = a.s.points[0];
            const d = Math.max(Math.abs(wx - x0), Math.abs(wy - y0));
            a.s.points[1] = [r1(x0 + Math.sign(wx - x0 || 1) * d), r1(y0 + Math.sign(wy - y0 || 1) * d)];
          }
        }
        a.p.setAttribute('d', strokePath(a.s));
        break;
      case 'lasso': {
        for (const ev of coalesced(e)) a.pts.push(this.toWorld(...this.local(ev)));
        a.p.setAttribute('d', `M${a.pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}`);
        break;
      }
      case 'lmove':
      case 'lscale': {
        if (!a.moved && Math.hypot(px - a.sx, py - a.sy) < 4) return;
        a.moved = true;
        if (a.type === 'lmove') this.lassoTransform(a, (px - a.sx) / z, (py - a.sy) / z);
        else {
          const [sx, sy] = this.toWorld(a.sx, a.sy);
          const k = clamp(((wx - a.ax) / (sx - a.ax) + (wy - a.ay) / (sy - a.ay)) / 2, 0.1, 10);
          this.lassoTransform(a, 0, 0, k);
        }
        break;
      }
      case 'erase':
        for (const ev of coalesced(e)) this.eraseAt(...this.toWorld(...this.local(ev)));
        break;
      case 'move':
      case 'resize': {
        if (!a.moved && Math.hypot(px - a.sx, py - a.sy) < 6) return;
        a.moved = true;
        const it = this.item(a.id);
        const dx = (px - a.sx) / z, dy = (py - a.sy) / z;
        if (a.type === 'move') {
          it.x = Math.round(a.ox + dx);
          it.y = Math.round(a.oy + dy);
          a.el.style.left = `${it.x}px`;
          a.el.style.top = `${it.y}px`;
        } else if (it.kind === 'sticker') {
          // In verhouding vergroten of verkleinen.
          const f = Math.max(16 / Math.min(a.ow, a.oh), (a.ow + dx + a.oh + dy) / (a.ow + a.oh));
          it.w = Math.round(a.ow * f);
          it.h = Math.round(a.oh * f);
          a.el.style.width = `${it.w}px`;
          a.el.style.height = `${it.h}px`;
        } else {
          it.w = Math.round(Math.max(140, a.ow + dx));
          it.h = Math.round(Math.max(80, a.oh + dy));
          a.el.style.width = `${it.w}px`;
          a.el.style.minHeight = `${it.h}px`;
        }
        this.positionBar();
        break;
      }
      case 'rotate': {
        a.moved = true;
        const it = this.item(a.id);
        let deg = Math.atan2(py - a.cy, px - a.cx) * 180 / Math.PI + 90;
        deg = ((Math.round(deg) + 540) % 360) - 180;
        if (Math.abs(deg) < 4) deg = 0; // recht zetten is makkelijk
        it.rot = deg;
        a.el.style.transform = `rotate(${deg}deg)`;
        break;
      }
    }
  }

  snapShape(a) {
    if (this.action !== a || a.snapped) return;
    const r = recognizeShape(a.s.points, a.s.tool === 'highlighter');
    if (!r) return;
    a.s = { ...a.s, shape: r.shape, points: r.points };
    a.snapped = true;
    a.p.setAttribute('d', strokePath(a.s));
    a.p.classList.add('snapped');
  }

  up(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.action?.type === 'pinch') {
      if (!this.pointers.size) this.action = null;
      return;
    }
    if (this.pointers.size) return;
    this.finishAction(!cancelled, e);
  }

  // Rondt de lopende actie af. commit=false gooit een halve lijn weg.
  finishAction(commit, e) {
    const a = this.action;
    this.action = null;
    if (!a) return;
    clearTimeout(a.hold);
    switch (a.type) {
      case 'draw':
      case 'shape': {
        this.gLive.innerHTML = '';
        if (!commit) return;
        if (a.type === 'shape') {
          const [[x0, y0], [x1, y1]] = a.s.points;
          if (Math.hypot(x1 - x0, y1 - y0) * this.view.z < 6) return;
        }
        this.pushUndo(this.snapshot());
        this.c.strokes.push(a.s);
        (a.s.tool === 'highlighter' ? this.gHl : this.gPen).insertAdjacentHTML('beforeend', strokeHTML(a.s));
        this.changed();
        break;
      }
      case 'lasso': {
        this.gLive.innerHTML = '';
        if (!commit || a.pts.length < 3) return;
        const poly = a.pts;
        const strokes = new Set(this.c.strokes.filter(s => strokeInPolygon(s, poly)).map(s => s.id));
        const items = new Set(this.c.items.filter(it => {
          const r = this.itemRect(it);
          return pointInPolygon(r.x + r.w / 2, r.y + Math.min(r.h / 2, 40), poly);
        }).map(it => it.id));
        this.setLasso({ strokes, items });
        break;
      }
      case 'lmove':
      case 'lscale':
        if (a.moved) { this.pushUndo(a.snap); this.changed(); this.updateBar(); }
        break;
      case 'erase':
        if (a.changed) { this.pushUndo(a.snap); this.changed(); }
        break;
      case 'move':
      case 'resize':
      case 'rotate':
        if (a.moved) { this.pushUndo(a.snap); this.changed(); }
        else if (commit && a.type === 'move') this.tap(a);
        break;
      case 'create': {
        if (!commit || !e) return;
        const [px, py] = this.local(e);
        if (Math.hypot(px - a.sx, py - a.sy) > 10) return;
        if (a.tool === 'sticker') this.addSticker(a.wx, a.wy);
        else if (a.target) this.startEdit(a.target);
        else if (a.tool === 'text') this.addText(a.wx, a.wy);
        else this.addSticky(a.wx, a.wy);
        break;
      }
    }
  }

  // Tik op een regel = markeren; dubbeltik = bewerken.
  tap(a) {
    const now = performance.now();
    const prev = this.lastTap;
    if (prev && prev.id === a.id && now - prev.t < 380) {
      this.lastTap = null;
      if (prev.toggled) {
        // De eerste tik van de dubbeltik zette een markering; draai die terug.
        this.restore(this.undoStack.pop());
        this.emitHistory();
        this.changed();
      }
      this.startEdit(a.id);
      return;
    }
    this.lastTap = { id: a.id, t: now, toggled: false };
    const it = this.item(a.id);
    if (a.line != null && it?.lines?.[a.line]) {
      this.pushUndo(a.snap);
      const on = (it.lines[a.line].hl = !it.lines[a.line].hl);
      this.lastTap.toggled = true;
      this.renderItems();
      this.changed();
      if (on) this.celebrate(it, a.line);
    }
  }

  // Markeerstift-veeg over de nieuwe markering, en confetti als alles af is.
  celebrate(it, line) {
    const el = this.itemEl(it.id);
    el?.querySelector(`li[data-i="${line}"]`)?.classList.add('hl-new');
    if (el && it.lines.length > 1 && it.lines.every(l => l.hl)) {
      const col = STICKY_COLORS[it.color] || STICKY_COLORS.geel;
      // Wachten tot een eventuele dubbeltik voorbij is; die draait de markering terug.
      setTimeout(() => {
        const now = this.item(it.id);
        const target = this.itemEl(it.id);
        if (now?.lines.every(l => l.hl) && target && !this.editing) confetti(this.el, target, [col.bg, col.hl]);
      }, 400);
    }
  }

  eraseAt(wx, wy) {
    const before = this.c.strokes.length;
    const radius = 10 / this.view.z;
    this.c.strokes = this.c.strokes.filter(s => !hitStroke(s, wx, wy, radius));
    if (this.c.strokes.length !== before) {
      this.action.changed = true;
      this.renderInk();
    }
  }

  // Sneltoetsen. Geeft true terug als de toets verwerkt is.
  key(e) {
    if (this.editing) return false;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.shiftKey ? this.redo() : this.undo(); return true; }
    if (mod && k === 'y') { this.redo(); return true; }
    if (mod && k === 'd' && this.lasso) { this.lassoDuplicate(); return true; }
    if (mod && k === 'd' && this.selected) { this.duplicate(); return true; }
    if (mod) return false;
    if ((e.key === 'Backspace' || e.key === 'Delete') && this.lasso) { this.lassoDelete(); return true; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && this.selected) { this.deleteSelected(); return true; }
    if (e.key === 'Escape' && this.lasso) { this.setLasso(null); return true; }
    if (e.key === 'Escape' && this.selected) { this.select(null); return true; }
    if (e.key === 'Enter' && this.selected) { this.startEdit(this.selected); return true; }
    if (e.key === ' ') { this.spaceDown = true; return true; }
    if (e.key === '0') { this.fit(); return true; }
    if (e.key === '+' || e.key === '=') { this.zoomBy(1.25); return true; }
    if (e.key === '-') { this.zoomBy(0.8); return true; }
    const tools = { v: 'select', l: 'lasso', p: 'pen', h: 'highlighter', s: 'shape', e: 'eraser', t: 'text', n: 'sticky', k: 'sticker' };
    if (tools[k]) { this.cb.onToolKey?.(tools[k]); return true; }
    return false;
  }

  keyup(e) {
    if (e.key === ' ') this.spaceDown = false;
  }
}
