// Afdrukken en opslaan als PDF via het afdrukvenster van de browser.
// Notebook: één A4-pagina per notebookpagina. Whiteboard: alles op één liggende A4.
import { worldHTML } from './board.js';
import { PAGE_W, pageTop } from './model.js';
import { strokeBBox } from './ink.js';

const MM = 96 / 25.4; // pixels per millimeter

function root() {
  let r = document.getElementById('print-root');
  if (!r) {
    r = document.createElement('div');
    r.id = 'print-root';
    document.body.append(r);
  }
  return r;
}

function pageStyle(landscape) {
  let st = document.getElementById('print-page-style');
  if (!st) {
    st = document.createElement('style');
    st.id = 'print-page-style';
    document.head.append(st);
  }
  st.textContent = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 0; }`;
}

function fitBoard(world, doc) {
  // Na het invoegen meten, zodat ook de hoogte van blaadjes klopt.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of world.querySelectorAll('.items-layer > .item')) {
    x0 = Math.min(x0, el.offsetLeft); y0 = Math.min(y0, el.offsetTop);
    x1 = Math.max(x1, el.offsetLeft + el.offsetWidth); y1 = Math.max(y1, el.offsetTop + el.offsetHeight);
  }
  for (const s of doc.content.strokes || []) {
    const b = strokeBBox(s);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  if (x0 === Infinity) return;
  const pw = 297 * MM, ph = 210 * MM, margin = 36;
  const s = Math.min((pw - margin * 2) / (x1 - x0), (ph - margin * 2) / (y1 - y0), 1.5);
  const tx = (pw - (x1 - x0) * s) / 2 - x0 * s;
  const ty = (ph - (y1 - y0) * s) / 2 - y0 * s;
  world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
}

export async function printDoc(doc) {
  const r = root();
  const notebook = doc.type === 'notebook';
  pageStyle(!notebook);
  r.className = notebook ? '' : 'landscape';
  document.title = doc.title;

  if (notebook) {
    const scale = (210 * MM) / PAGE_W - 0.0005;
    let html = '';
    for (let i = 0; i < (doc.content.pages || 1); i++) {
      html += `<div class="print-page"><div class="print-world" style="transform: scale(${scale}) translateY(${-pageTop(i)}px)">${worldHTML(doc, i)}</div></div>`;
    }
    r.innerHTML = html;
  } else {
    r.innerHTML = `<div class="print-page"><div class="print-world">${worldHTML(doc)}</div></div>`;
    fitBoard(r.querySelector('.print-world'), doc);
  }

  await document.fonts?.ready;
  const cleanup = () => {
    r.innerHTML = '';
    document.title = `${doc.title} · Notitiemaker`;
    removeEventListener('afterprint', cleanup);
  };
  addEventListener('afterprint', cleanup);
  window.print();
}
