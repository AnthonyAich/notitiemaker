// Het canvas: oneindig whiteboard of notebook met pagina's.
// Wereldcoördinaten worden met translate + scale op het scherm gezet.
import { pathFromPoints, hitStroke, strokeBBox } from './ink.js';
import { PAGE_W, PAGE_H, STICKY_COLORS, INK_COLORS, coverSVG, pageTop, uid } from './model.js';
import { esc, icon } from './ui.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const MIN_Z = 0.1;
const MAX_Z = 4;
const OPTS_KEY = 'notitiemaker.tools.v1';
const VIEW_KEY = 'notitiemaker.view.';
const MAX_UNDO = 60;

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
    this.lastTap = null;
    this.penSeen = false;
    this.spaceDown = false;
    this.undoStack = [];
    this.redoStack = [];
    this.paths = new WeakMap();

    this.el = document.createElement('div');
    this.el.className = 'board';
    this.el.innerHTML = `
      <div class="world">
        <div class="pages-layer"></div>
        <div class="items-layer"></div>
        <svg class="ink-layer" width="1" height="1"><g class="ink-hl"></g><g class="ink-pen"></g><g class="ink-live"></g></svg>
      </div>
      <div class="item-bar" hidden></div>`;
    host.replaceChildren(this.el);
    this.world = this.el.querySelector('.world');
    this.pagesLayer = this.el.querySelector('.pages-layer');
    this.itemsLayer = this.el.querySelector('.items-layer');
    this.gHl = this.el.querySelector('.ink-hl');
    this.gPen = this.el.querySelector('.ink-pen');
    this.gLive = this.el.querySelector('.ink-live');
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
    this.renderAll();
  }

  pushUndo(snap) {
    this.undoStack.push(snap);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
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

  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of this.itemsLayer.children) {
      x0 = Math.min(x0, el.offsetLeft); y0 = Math.min(y0, el.offsetTop);
      x1 = Math.max(x1, el.offsetLeft + el.offsetWidth); y1 = Math.max(y1, el.offsetTop + el.offsetHeight);
    }
    for (const s of this.c.strokes) {
      const b = strokeBBox(s);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
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
    if (!this.isNotebook) { this.pagesLayer.innerHTML = ''; return; }
    let html = '';
    for (let i = 0; i < (this.c.pages || 1); i++) {
      const cls = i === 0 ? 'cover' : `paper-${this.doc.paper || 'lijnen'}`;
      html += `<div class="page ${cls}" style="top:${pageTop(i)}px;width:${PAGE_W}px;height:${PAGE_H}px">${i === 0 ? coverSVG(this.doc) : ''}</div>`;
    }
    this.pagesLayer.innerHTML = html;
  }

  itemHTML(it) {
    const sel = it.id === this.selected ? ' selected' : '';
    if (it.kind === 'sticky') {
      const col = STICKY_COLORS[it.color] || STICKY_COLORS.geel;
      const lines = (it.lines || []).map((l, i) =>
        `<li data-i="${i}" class="lvl-${l.indent || 0}${l.hl ? ' hl' : ''}"><span>${esc(l.text)}</span></li>`).join('');
      return `<div class="item sticky${sel}" data-id="${it.id}" style="left:${it.x}px;top:${it.y}px;width:${it.w}px;min-height:${it.h}px;--bg:${col.bg};--hl:${col.hl}">
        <div class="sticky-title">${esc(it.title)}</div><ul class="sticky-lines">${lines}</ul><div class="handle"></div></div>`;
    }
    return `<div class="item text${sel}" data-id="${it.id}" style="left:${it.x}px;top:${it.y}px;font-size:${it.size}px;color:${esc(it.color)}">${esc(it.text)}</div>`;
  }

  renderItems() {
    this.itemsLayer.innerHTML = this.c.items.map(it => this.itemHTML(it)).join('');
    this.updateBar();
  }

  strokeHTML(s) {
    let d = this.paths.get(s);
    if (!d) { d = pathFromPoints(s.points); this.paths.set(s, d); }
    return `<path d="${d}" stroke="${esc(s.color)}" stroke-width="${s.width}"/>`;
  }

  renderInk() {
    let hl = '', pen = '';
    for (const s of this.c.strokes) {
      if (s.tool === 'highlighter') hl += this.strokeHTML(s);
      else pen += this.strokeHTML(s);
    }
    this.gHl.innerHTML = hl;
    this.gPen.innerHTML = pen;
  }

  // ---------- selectie en balk ----------

  select(id) {
    this.selected = id;
    for (const n of this.itemsLayer.children) n.classList.toggle('selected', n.dataset.id === id);
    this.updateBar();
  }

  updateBar() {
    const it = this.selected && !this.editing && this.tool === 'select' ? this.item(this.selected) : null;
    if (!it) { this.bar.hidden = true; this.barKey = null; return; }
    const key = `${it.id}|${it.color}`;
    if (key !== this.barKey) {
      this.barKey = key;
      let h = `<button data-act="edit">${icon('edit')}<span>Bewerk</span></button><span class="sep"></span>`;
      if (it.kind === 'sticky') {
        h += Object.entries(STICKY_COLORS).map(([k, c]) =>
          `<button class="swatch${it.color === k ? ' on' : ''}" data-act="color" data-v="${k}" style="--c:${c.bg}" title="${k}"></button>`).join('');
      } else {
        h += INK_COLORS.filter(c => c !== '#ffffff').slice(0, 6).map(c =>
          `<button class="swatch${it.color === c ? ' on' : ''}" data-act="color" data-v="${c}" style="--c:${c}"></button>`).join('');
      }
      h += `<span class="sep"></span>
        <button data-act="front" title="Naar voren">${icon('front')}</button>
        <button data-act="dup" title="Dupliceren (⌘D)">${icon('copy')}</button>
        <button data-act="del" title="Verwijderen (⌫)">${icon('trash')}</button>`;
      this.bar.innerHTML = h;
    }
    this.bar.hidden = false;
    this.positionBar();
  }

  positionBar() {
    if (this.bar.hidden) return;
    const it = this.item(this.selected);
    const el = it && this.itemEl(it.id);
    if (!el) return;
    const { x, y, z } = this.view;
    const cx = clamp(x + (it.x + el.offsetWidth / 2) * z, 120, this.el.clientWidth - 120);
    let top = y + it.y * z - 14;
    const below = top < 70;
    if (below) top = y + (it.y + el.offsetHeight) * z + 14;
    this.bar.classList.toggle('below', below);
    this.bar.style.left = `${cx}px`;
    this.bar.style.top = `${top}px`;
  }

  barAction(act, v) {
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
    if (!it || !el) return;
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
      if (this.action?.type === 'draw') this.gLive.innerHTML = '';
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
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('stroke', s.color);
        p.setAttribute('stroke-width', s.width);
        if (hl) p.setAttribute('class', 'live-hl');
        this.gLive.append(p);
        this.action = { type: 'draw', s, p };
        p.setAttribute('d', pathFromPoints(s.points));
        break;
      }
      case 'eraser':
        this.action = { type: 'erase', snap: this.snapshot(), changed: false };
        this.eraseAt(wx, wy);
        break;
      case 'text':
      case 'sticky':
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

    switch (a.type) {
      case 'pinch': {
        if (this.pointers.size < 2) return;
        const [p1, p2] = [...this.pointers.values()];
        const m = mid(p1, p2);
        const nz = clamp(a.v0.z * dist(p1, p2) / a.d0, MIN_Z, MAX_Z);
        const wx = (a.m0.x - a.v0.x) / a.v0.z;
        const wy = (a.m0.y - a.v0.y) / a.v0.z;
        this.view = { x: m.x - wx * nz, y: m.y - wy * nz, z: nz };
        this.applyView();
        break;
      }
      case 'pan':
        this.view = { ...a.v0, x: a.v0.x + px - a.sx, y: a.v0.y + py - a.sy };
        this.applyView();
        break;
      case 'draw': {
        const pts = a.s.points;
        for (const ev of coalesced(e)) {
          const [qx, qy] = this.toWorld(...this.local(ev));
          const last = pts[pts.length - 1];
          if (Math.hypot(qx - last[0], qy - last[1]) * z >= 1.2) pts.push([r1(qx), r1(qy)]);
        }
        a.p.setAttribute('d', pathFromPoints(pts));
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
        } else {
          it.w = Math.round(Math.max(140, a.ow + dx));
          it.h = Math.round(Math.max(80, a.oh + dy));
          a.el.style.width = `${it.w}px`;
          a.el.style.minHeight = `${it.h}px`;
        }
        this.positionBar();
        break;
      }
    }
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
    switch (a.type) {
      case 'draw':
        this.gLive.innerHTML = '';
        if (!commit) return;
        this.pushUndo(this.snapshot());
        this.c.strokes.push(a.s);
        (a.s.tool === 'highlighter' ? this.gHl : this.gPen).insertAdjacentHTML('beforeend', this.strokeHTML(a.s));
        this.changed();
        break;
      case 'erase':
        if (a.changed) { this.pushUndo(a.snap); this.changed(); }
        break;
      case 'move':
      case 'resize':
        if (a.moved) { this.pushUndo(a.snap); this.changed(); }
        else if (commit && a.type === 'move') this.tap(a);
        break;
      case 'create': {
        if (!commit || !e) return;
        const [px, py] = this.local(e);
        if (Math.hypot(px - a.sx, py - a.sy) > 10) return;
        if (a.target) this.startEdit(a.target);
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
      it.lines[a.line].hl = !it.lines[a.line].hl;
      this.lastTap.toggled = true;
      this.renderItems();
      this.changed();
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
    if (mod && k === 'd' && this.selected) { this.duplicate(); return true; }
    if (mod) return false;
    if ((e.key === 'Backspace' || e.key === 'Delete') && this.selected) { this.deleteSelected(); return true; }
    if (e.key === 'Escape' && this.selected) { this.select(null); return true; }
    if (e.key === 'Enter' && this.selected) { this.startEdit(this.selected); return true; }
    if (e.key === ' ') { this.spaceDown = true; return true; }
    if (e.key === '0') { this.fit(); return true; }
    if (e.key === '+' || e.key === '=') { this.zoomBy(1.25); return true; }
    if (e.key === '-') { this.zoomBy(0.8); return true; }
    const tools = { v: 'select', p: 'pen', h: 'highlighter', e: 'eraser', t: 'text', n: 'sticky' };
    if (tools[k]) { this.cb.onToolKey?.(tools[k]); return true; }
    return false;
  }

  keyup(e) {
    if (e.key === ' ') this.spaceDown = false;
  }
}
