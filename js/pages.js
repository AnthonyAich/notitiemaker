// Pagina-overzicht van een notebook: alle pagina's als miniatuur. Sleep een pagina aan het
// greepje naar een andere plek, of dupliceer, voeg een lege pagina in of verwijder er een.
import { worldHTML } from './board.js';
import { PAGE_W, PAGE_H, pageTop } from './model.js';
import { esc, icon, confirmDialog, toast } from './ui.js';

const THUMB_W = 150;

export function openPageOverview(host, board) {
  host.querySelector('.pages-overlay')?.remove();
  const el = document.createElement('div');
  el.className = 'pages-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', "Pagina's");
  host.append(el);

  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);

  const pages = () => board.c.pages || 1;
  const order = () => Array.from({ length: pages() }, (_, i) => i);
  const scale = THUMB_W / PAGE_W;

  function render() {
    const doc = board.doc;
    const card = i => `
      <div class="pcard${i === 0 ? ' cover' : ''}" data-page="${i}">
        <button class="pthumb" data-goto="${i}" aria-label="${i === 0 ? 'Naar de kaft' : `Naar pagina ${i}`}" style="width:${THUMB_W}px;height:${Math.round(PAGE_H * scale)}px">
          <div class="pworld" style="transform:scale(${scale}) translateY(${-pageTop(i)}px)">${worldHTML(doc, i)}</div>
        </button>
        <div class="pbar">
          ${i === 0 ? '<span class="pnum">Kaft</span>' : `<span class="pgrip" title="Sleep om te verplaatsen" aria-label="Pagina ${i} verplaatsen">⠿</span><span class="pnum">${i}</span>`}
          <span class="pacts">
            ${i === 0 ? '' : `<button data-act="dup" title="Dupliceren">${icon('copy')}</button>`}
            <button data-act="add" title="Lege pagina erna invoegen">${icon('filePlus')}</button>
            ${i === 0 ? '' : `<button data-act="del" title="Verwijderen">${icon('trash')}</button>`}
          </span>
        </div>
      </div>`;
    el.innerHTML = `
      <header class="po-head">
        <h2>Pagina's van ${esc(doc.title)}</h2>
        <span class="po-hint">Sleep een pagina aan ⠿ naar een andere plek. Tik op een pagina om ernaartoe te gaan.</span>
        <button class="btn primary" data-close>Klaar</button>
      </header>
      <div class="po-grid">${order().map(card).join('')}</div>`;
  }
  render();

  const apply = newOrder => {
    board.reorderPages(newOrder);
    render();
  };

  el.addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) return close();
    const go = e.target.closest('[data-goto]');
    if (go) {
      close();
      board.goToPage(+go.dataset.goto);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const i = +btn.closest('.pcard').dataset.page;
    const o = order();
    if (btn.dataset.act === 'dup') {
      o.splice(i + 1, 0, i);
      apply(o);
      toast(`Pagina ${i} gedupliceerd`);
    } else if (btn.dataset.act === 'add') {
      o.splice(i + 1, 0, -1);
      apply(o);
    } else if (btn.dataset.act === 'del') {
      if (pages() <= 2) return toast('Een notebook heeft minstens één pagina.');
      if (board.pageHasContent(i) && !await confirmDialog(`Pagina ${i} verwijderen?`,
        'Alles op deze pagina verdwijnt. Je kunt het daarna nog ongedaan maken met de pijl linksboven.', 'Verwijderen')) return;
      o.splice(i, 1);
      apply(o);
    }
  });

  // ---------- slepen ----------
  el.addEventListener('pointerdown', e => {
    const grip = e.target.closest('.pgrip');
    if (!grip) return;
    e.preventDefault();
    const card = grip.closest('.pcard');
    const grid = el.querySelector('.po-grid');
    const start = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('ghost');
    Object.assign(ghost.style, { left: `${start.left}px`, top: `${start.top}px`, width: `${start.width}px` });
    el.append(ghost);
    card.classList.add('placeholder');
    const sx = e.clientX, sy = e.clientY;
    let scroll = 0;
    const tick = setInterval(() => { if (scroll) grid.scrollTop += scroll; }, 16);

    const moveTo = (x, y) => {
      ghost.style.transform = `translate(${x - sx}px, ${y - sy}px) rotate(2deg)`;
      const g = grid.getBoundingClientRect();
      scroll = y < g.top + 60 ? -10 : y > g.bottom - 60 ? 10 : 0;
      const over = document.elementFromPoint(x, y)?.closest('.pcard');
      if (!over || over === card) return;
      if (over.classList.contains('cover')) { grid.insertBefore(card, over.nextSibling); return; }
      const r = over.getBoundingClientRect();
      grid.insertBefore(card, x < r.left + r.width / 2 ? over : over.nextSibling);
    };
    const end = () => {
      clearInterval(tick);
      ghost.remove();
      card.classList.remove('placeholder');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      const newOrder = [0, ...[...grid.querySelectorAll('.pcard:not(.cover)')].map(c => +c.dataset.page)];
      if (newOrder.some((p, k) => p !== k)) apply(newOrder);
    };
    const onMove = ev => moveTo(ev.clientX, ev.clientY);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  });

  return close;
}
