// Flashcards: het scherm. Een lijst om kaarten in te geven en een leerscherm met de stappen.
// De leerlogica staat in learn.js. De klasse heeft dezelfde methodes als Board, zodat
// main.js beide soorten documenten op dezelfde manier kan openen.
import { uid } from './model.js';
import { esc, icon, dialog, toast } from './ui.js';
import { confetti } from './fx.js';
import * as L from './learn.js';

const HISTORY_MAX = 60;
const PREVIEW_MAX = 60;
// Zo lang (ms) reageert een nieuwe kaart niet op tikken: een dubbele tik slaat dan geen kaart over.
const TAP_GUARD = 180;
const CONFETTI = ['#ffd43b', '#74c0fc', '#f783ac', '#69db7c'];

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const inDays = n => (n <= 0 ? 'vandaag' : n === 1 ? 'morgen' : `over ${n} dagen`);

// Korte tekst groot en in handschrift, lange tekst kleiner en goed leesbaar.
const sizeClass = t => (t.length <= 14 ? 'xl' : t.length <= 40 ? 'l' : t.length <= 160 ? 'm' : 's');
const brHTML = t => esc(t).replace(/\n/g, '<br>');
const textHTML = t => `<div class="fc-text ${sizeClass(t)}${t.includes('\n') && t.length > 40 ? ' lines' : ''}" dir="auto">${brHTML(t)}</div>`;

const WHY = {
  accent: 'Bijna! Let op de accenten.',
  lidwoord: 'Bijna! Let op het lidwoord of een klein woordje.',
  spatie: 'Bijna! Let op de spaties.',
  deel: 'Bijna! Het antwoord is nog niet volledig.',
  spelling: 'Bijna! Let op de spelling.',
};

// Velden zonder autocorrectie: die zou woorden in een andere taal "verbeteren".
const PLAIN = 'autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false" dir="auto"';

export class CardsView {
  constructor(host, doc, cb = {}) {
    this.cb = cb;
    this.undoStack = [];
    this.redoStack = [];
    this.round = null;   // de ronde die bezig is
    this.q = null;       // de kaart die nu gevraagd wordt
    this.unsent = false; // antwoorden die nog niet naar de Sheet vertrokken zijn

    this.el = document.createElement('div');
    this.el.className = 'fc';
    this.el.innerHTML = `
      <div class="fc-edit"><div class="fc-wrap">
        <div class="fc-head"></div>
        <div class="fc-list-head"><h2>Kaarten</h2><button class="btn soft" data-act="paste">${icon('clipboard')}<span>Lijst plakken</span></button></div>
        <div class="fc-cols">
          <input class="fc-side" data-side="a" maxlength="40" aria-label="Naam van de voorkant" title="Naam van de voorkant (aan te passen)" ${PLAIN}>
          <input class="fc-side" data-side="b" maxlength="40" aria-label="Naam van de achterkant" title="Naam van de achterkant (aan te passen)" ${PLAIN}>
        </div>
        <ol class="fc-rows"></ol>
        <p class="fc-tip">Enter gaat naar het volgende vak, Shift + Enter maakt een nieuwe regel. Zijn er meerdere juiste antwoorden, zet er dan <b>/</b> tussen: <i>auto / wagen</i>.</p>
      </div></div>
      <div class="fc-session" tabindex="-1" hidden>
        <header class="fc-top">
          <button class="fc-x" data-act="stop" title="Stoppen (Esc)" aria-label="Stoppen">${icon('x')}</button>
          <div class="fc-bar" role="progressbar" aria-label="Voortgang van deze ronde" aria-valuemin="0" aria-valuemax="100"><i></i></div>
          <span class="fc-left"></span>
        </header>
        <div class="fc-stage"></div>
      </div>`;
    host.replaceChildren(this.el);
    const $ = s => this.el.querySelector(s);
    this.editEl = $('.fc-edit');
    this.headEl = $('.fc-head');
    this.rowsEl = $('.fc-rows');
    this.sessionEl = $('.fc-session');
    this.stage = $('.fc-stage');
    this.bind();
    this.load(doc, true);
  }

  // ---------- document ----------

  load(doc, initial = false) {
    this.doc = doc;
    this.c = doc.content;
    this.c.items ||= [];
    if (this.round) {
      this.round.content = this.c;
      // De kaart die net gevraagd werd, is op een ander toestel verwijderd.
      if (this.q && !this.round.alive()) { this.q = null; this.nextCard(); }
      return;
    }
    this.renderEdit();
    if (initial) {
      this.emitHistory();
      if (!L.cardsOf(this.c).length && matchMedia('(pointer: fine)').matches) this.rowsEl.querySelector('.fc-field')?.focus();
    }
  }

  // Tijdens het typen in de lijst mag het scherm niet vervangen worden.
  busy() {
    const a = document.activeElement;
    return !this.round && this.editEl.contains(a) && a.matches('.fc-field, .fc-side');
  }

  changed() {
    this.cb.onChange?.(this.doc);
  }

  card(id) {
    return L.cardOf(this.c, id);
  }

  finishEdit() {
    if (this.busy()) document.activeElement.blur();
  }

  renderPages() { /* enkel voor notebooks */ }
  keyup() {}

  destroy() {
    clearTimeout(this.timer);
    clearTimeout(this.headTimer);
    if (this.q?.pending && this.round.alive()) this.commit(this.q.pending);
    this.finishEdit();
    this.tidy();
    this.round = null;
    this.send();
  }

  // Lege kaarten en overtollige spaties weg.
  tidy() {
    let changed = false;
    for (const c of L.cardsOf(this.c)) {
      if (L.isEmpty(c)) { L.removeCard(this.c, c.id); changed = true; continue; }
      for (const f of ['a', 'b']) {
        const v = (c[f] || '').trim();
        if (v !== c[f]) { c[f] = v; changed = true; }
      }
    }
    if (changed) this.changed();
  }

  // ---------- geschiedenis ----------

  snapshot() {
    return JSON.stringify(this.c.items);
  }

  restore(snap) {
    this.c.items = JSON.parse(snap);
    this.renderEdit();
    this.changed();
    this.emitHistory();
  }

  pushUndo(snap) {
    this.undoStack.push(snap);
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.emitHistory();
  }

  resetHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.focusSnap = null;
    this.emitHistory();
  }

  emitHistory() {
    this.cb.onHistory?.(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  undo() {
    if (this.round || !this.undoStack.length) return;
    this.finishEdit();
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
  }

  redo() {
    if (this.round || !this.redoStack.length) return;
    this.finishEdit();
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
  }

  // ---------- lijst ----------

  renderEdit() {
    const top = this.editEl.scrollTop;
    const s = L.sides(this.c);
    for (const i of this.el.querySelectorAll('.fc-side')) i.value = s[i.dataset.side];
    const map = L.progressMap(this.c);
    this.rowsEl.innerHTML = L.cardsOf(this.c).map(c => this.rowHTML(c, map)).join('') + this.rowHTML(null);
    this.renderHead();
    this.editEl.scrollTop = top;
  }

  rowHTML(card, map) {
    const s = L.sides(this.c);
    const field = f => {
      const v = esc(card?.[f] || '');
      return `<div class="fc-grow" data-v="${v}"><textarea class="fc-field" data-f="${f}" rows="1" enterkeyhint="next" ${PLAIN} aria-label="${esc(s[f])}"${card ? '' : ` placeholder="${esc(s[f])}"`}>${v}</textarea></div>`;
    };
    return `<li class="fc-row${card ? '' : ' new'}" data-id="${card ? esc(card.id) : ''}">
      ${field('a')}${field('b')}
      <span class="fc-state">${card ? this.dotsHTML(card, map) : ''}</span>
      <button class="fc-del" data-act="del" tabindex="-1" title="Kaart verwijderen" aria-label="Kaart verwijderen">${icon('x')}</button>
    </li>`;
  }

  // Per richting: vier bolletjes voor de stappen, of een vinkje als de kaart gekend is.
  dotsHTML(card, map) {
    if (!L.isComplete(card)) return '';
    const day = L.dayNumber();
    return L.dirsOf(L.mode(this.c)).map(d => {
      const e = map.get(`${card.id}:${d}`), s = e?.s || 1;
      const what = s >= L.KNOWN ? (e.due <= day ? 'gekend, nu te herhalen' : `gekend, komt ${inDays(e.due - day)} terug`) : `stap ${s} van 4: ${L.STEPS[s - 1].toLowerCase()}`;
      const title = esc(`${L.dirLabel(this.c, d)}: ${what}`);
      if (s >= L.KNOWN) return `<span class="fc-dots known${e.due <= day ? ' again' : ''}" title="${title}">${icon('check')}</span>`;
      return `<span class="fc-dots" title="${title}">${[1, 2, 3, 4].map(i => `<i${i < s ? ' class="on"' : ''}></i>`).join('')}</span>`;
    }).join('');
  }

  renderHead() {
    const m = L.mode(this.c), st = L.stats(this.c, m), open = st.total - st.known;
    const cards = L.cardsOf(this.c), half = cards.filter(c => !L.isComplete(c) && !L.isEmpty(c)).length;
    const btn = (act, ic, label, n, cls) => `<button class="btn ${cls}" data-act="${act}">${icon(ic)}<span>${label}</span>${n ? `<b class="fc-n">${n}</b>` : ''}</button>`;
    let btns = '';
    if (open || !st.total) btns += btn('learn', 'play', 'Leren', open, 'primary').replace('<button', st.total ? '<button' : '<button disabled');
    if (st.due) btns += btn('review', 'history', 'Herhalen', st.due, open ? 'soft' : 'primary');
    if (!open && !st.due && st.total) btns += btn('cram', 'history', 'Toch overlopen', 0, 'soft');

    const modes = [['ab', L.dirLabel(this.c, 'ab')], ['ba', L.dirLabel(this.c, 'ba')], ['mix', 'Door elkaar']];
    const seg = modes.map(([k, l]) => `<button data-mode="${k}" role="radio" aria-checked="${k === m}" class="${k === m ? 'on' : ''}">${esc(l)}</button>`).join('');

    const bars = st.total ? L.dirsOf(m).map(d => {
      const x = L.stats(this.c, d), pct = n => (100 * n / x.total).toFixed(2);
      return `<div class="fc-stat">
        ${m === 'mix' ? `<span class="fc-stat-dir">${esc(L.dirLabel(this.c, d))}</span>` : ''}
        <span class="fc-track"><i class="known" style="width:${pct(x.known)}%"></i><i class="busy" style="width:${pct(x.busy)}%"></i></span>
        <span class="fc-stat-txt"><b class="known">${x.known} gekend</b> · <b class="busy">${x.busy} bezig</b> · ${x.fresh} nieuw</span>
      </div>`;
    }).join('') : '';

    const notes = [];
    if (!cards.length) notes.push('Typ hieronder je eerste kaart, of plak een lijst uit Excel, Word of Quizlet.');
    if (st.total && !open && !st.due) notes.push(`Alles gekend 🎉 De eerste kaarten komen ${inDays(L.nextDue(this.c, m))} terug om te herhalen.`);
    if (half) notes.push(`${count(half, 'kaart heeft', 'kaarten hebben')} nog maar één kant en ${half === 1 ? 'doet' : 'doen'} nog niet mee.`);

    this.headEl.innerHTML = `
      <div class="fc-head-row"><div class="fc-go">${btns}</div><div class="fc-seg" role="radiogroup" aria-label="Richting">${seg}</div></div>
      ${bars ? `<div class="fc-stats">${bars}</div>` : ''}
      ${notes.map(t => `<p class="fc-note">${esc(t)}</p>`).join('')}`;
  }

  // Na het typen: bolletjes en tellers bijwerken zonder de velden te vervangen.
  refreshSoon(row) {
    (this.dirtyRows ||= new Set()).add(row);
    clearTimeout(this.headTimer);
    this.headTimer = setTimeout(() => {
      const rows = [...this.dirtyRows].filter(r => r?.isConnected);
      this.dirtyRows.clear();
      if (this.round) return;
      this.renderHead();
      this.refreshDots(rows);
    }, 250);
  }

  refreshDots(rows = this.rowsEl.children) {
    const map = L.progressMap(this.c), cards = new Map(L.cardsOf(this.c).map(c => [c.id, c]));
    for (const row of rows) {
      const card = cards.get(row.dataset.id);
      row.querySelector('.fc-state').innerHTML = card ? this.dotsHTML(card, map) : '';
    }
  }

  bind() {
    this.el.addEventListener('click', e => this.onClick(e));
    this.el.addEventListener('input', e => this.onInput(e));
    this.el.addEventListener('keydown', e => this.onKeydown(e));
    this.el.addEventListener('submit', e => { e.preventDefault(); this.submit(); });
    // Knoppen tijdens het typen: het veld (en het toetsenbord van de iPad) blijft actief.
    this.sessionEl.addEventListener('mousedown', e => { if (this.q?.kind === 'type' && e.target.closest('button')) e.preventDefault(); });
    this.editEl.addEventListener('paste', e => this.onPaste(e));
    this.editEl.addEventListener('focusin', e => {
      if (e.target.matches('.fc-field, .fc-side')) this.focusSnap = this.snapshot();
    });
    this.editEl.addEventListener('focusout', e => this.onFocusout(e));
  }

  // Eén keer ongedaan maken per vak dat je bewerkt.
  markUndo() {
    if (!this.focusSnap) return;
    this.pushUndo(this.focusSnap);
    this.focusSnap = null;
  }

  onInput(e) {
    const side = e.target.closest('.fc-side');
    if (side) {
      this.markUndo();
      L.setSetting(this.c, 'sides', { ...L.sides(this.c), [side.dataset.side]: side.value.trim() });
      this.rowsEl.querySelector(`.fc-row.new .fc-field[data-f="${side.dataset.side}"]`).placeholder = L.sides(this.c)[side.dataset.side];
      this.changed();
      this.refreshSoon();
      return;
    }
    if (e.target.matches('.fc-input')) {
      // Na de controle staat het antwoord vast.
      if (this.q?.checked != null) e.target.value = this.q.given;
      return;
    }
    const f = e.target.closest('.fc-field');
    if (!f) return;
    this.markUndo();
    f.parentElement.dataset.v = f.value;
    const row = f.closest('.fc-row');
    let card = this.card(row.dataset.id);
    if (!card) {
      row.dataset.id = uid();
      L.addCard(this.c, { id: row.dataset.id, a: '', b: '' });
      card = this.card(row.dataset.id);
      row.classList.remove('new');
      row.querySelectorAll('.fc-field').forEach(x => x.removeAttribute('placeholder'));
      this.rowsEl.insertAdjacentHTML('beforeend', this.rowHTML(null));
    }
    card[f.dataset.f] = f.value;
    this.changed();
    this.refreshSoon(row);
  }

  onFocusout(e) {
    const t = e.target;
    const row = t.closest?.('.fc-row');
    setTimeout(() => {
      if (t.matches('.fc-side') && !t.value.trim()) t.value = L.sides(this.c)[t.dataset.side];
      const card = row?.isConnected && this.card(row.dataset.id);
      if (card && !row.contains(document.activeElement)) {
        if (L.isEmpty(card)) this.dropRow(row, card);
        else this.trim(row, card);
      }
      if (!this.round && !this.busy()) this.cb.onIdle?.();
    });
  }

  // Spaties en lege regels rond de tekst weg.
  trim(row, card) {
    for (const f of row.querySelectorAll('.fc-field')) {
      const v = f.value.trim();
      if (v === f.value) continue;
      f.value = f.parentElement.dataset.v = card[f.dataset.f] = v;
      this.changed();
    }
  }

  dropRow(row, card) {
    L.removeCard(this.c, card.id);
    row.remove();
    this.changed();
    this.refreshSoon();
  }

  onPaste(e) {
    if (!e.target.closest('.fc-field')) return;
    const text = e.clipboardData?.getData('text/plain') || '';
    // Twee kolommen uit Excel of Word: als lijst toevoegen in plaats van in één vak.
    if (/\S\t\s*\S/.test(text)) {
      e.preventDefault();
      this.pasteDialog(text);
    }
  }

  focusField(row, f) {
    const field = row?.querySelector(`.fc-field[data-f="${f}"]`);
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }

  onKeydown(e) {
    if (e.isComposing) return;
    if (e.target.matches('.fc-input')) {
      if (e.key === 'Escape') { e.preventDefault(); this.stop(); }
      // Enter ingedrukt houden mag de feedback niet overslaan.
      else if (e.key === 'Enter' && e.repeat) e.preventDefault();
      return;
    }
    if (e.target.matches('.fc-side')) {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.target.blur(); }
      return;
    }
    const f = e.target.closest('.fc-field');
    if (!f) return;
    const row = f.closest('.fc-row');
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (f.dataset.f === 'a') this.focusField(row, 'b');
      else this.focusField(row.nextElementSibling || row, 'a');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      f.blur();
    } else if (e.key === 'Backspace' && !f.value && row.previousElementSibling) {
      const card = this.card(row.dataset.id);
      if (f.dataset.f === 'b') { e.preventDefault(); this.focusField(row, 'a'); }
      else if (!card || L.isEmpty(card)) {
        e.preventDefault();
        this.focusField(row.previousElementSibling, 'b');
      }
    }
  }

  // ---------- lijst plakken ----------

  async pasteDialog(initial = '') {
    this.finishEdit();
    const s = L.sides(this.c);
    const fresh = data => {
      const p = L.parseList(data.text, data.sep, { swap: !!data.swap });
      return { ...p, add: L.withoutDuplicates(p.cards, L.cardsOf(this.c)) };
    };
    const res = await dialog({
      title: 'Lijst plakken',
      submit: 'Toevoegen',
      body: `
        <p class="muted">Eén kaart per regel, met een tab of een teken tussen de voor- en achterkant. Kopieer twee kolommen uit Excel of Word, of kies in Quizlet <i>Exporteren</i>.</p>
        <textarea class="fc-paste" name="text" rows="7" ${PLAIN} placeholder="le chien = de hond&#10;le chat = de kat" autofocus>${esc(initial)}</textarea>
        <div class="fc-paste-opts">
          <label class="field"><span>Tussen voor- en achterkant</span><select name="sep">${L.SEPARATORS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" name="swap"> Kolommen omwisselen</label>
        </div>
        <div class="fc-preview" aria-live="polite"></div>`,
      onOpen(d) {
        d.classList.add('wide');
        const form = d.querySelector('form'), ok = d.querySelector('button[value=ok]');
        const update = () => {
          const p = fresh(Object.fromEntries(new FormData(form)));
          const notes = [];
          const dup = p.cards.length - p.add.length;
          if (dup) notes.push(`${count(dup, 'kaart staat', 'kaarten staan')} er al in`);
          if (p.skipped.length) notes.push(`${count(p.skipped.length, 'regel', 'regels')} overgeslagen, zonder twee kanten: ${p.skipped.slice(0, 3).map(x => `“${x.length > 40 ? `${x.slice(0, 40)}…` : x}”`).join(', ')}${p.skipped.length > 3 ? ', …' : ''}`);
          if (p.extra) notes.push(`${count(p.extra, 'regel had', 'regels hadden')} meer dan twee kolommen: enkel de eerste twee tellen`);
          d.querySelector('.fc-preview').innerHTML = p.add.length || notes.length ? `
            ${notes.map(t => `<p class="warn-text">${esc(t)}.</p>`).join('')}
            ${p.add.length ? `<table><thead><tr><th>${esc(s.a)}</th><th>${esc(s.b)}</th></tr></thead><tbody>
              ${p.add.slice(0, PREVIEW_MAX).map(c => `<tr><td dir="auto">${esc(c.a)}</td><td dir="auto">${esc(c.b)}</td></tr>`).join('')}
            </tbody></table>` : ''}
            ${p.add.length > PREVIEW_MAX ? `<p class="muted">… en nog ${p.add.length - PREVIEW_MAX}</p>` : ''}` : '';
          ok.disabled = !p.add.length;
          ok.textContent = p.add.length ? `${count(p.add.length, 'kaart', 'kaarten')} toevoegen` : 'Toevoegen';
        };
        form.addEventListener('input', update);
        form.addEventListener('change', update);
        update();
      },
    });
    if (!res) return;
    const { add } = fresh(res);
    if (!add.length) return;
    this.pushUndo(this.snapshot());
    const cards = add.map(c => ({ ...c, id: uid() }));
    cards.forEach(c => L.addCard(this.c, c));
    this.changed();
    this.renderEdit();
    this.rowsEl.querySelector(`[data-id="${cards[0].id}"]`)?.scrollIntoView({ block: 'center' });
    toast(`${count(cards.length, 'kaart', 'kaarten')} toegevoegd`);
  }

  // ---------- klikken ----------

  onClick(e) {
    const seg = e.target.closest('[data-mode]');
    if (seg) {
      L.setSetting(this.c, 'mode', { v: seg.dataset.mode });
      this.changed();
      this.renderHead();
      this.refreshDots();
      return;
    }
    if (this.q && performance.now() - this.shownAt < TAP_GUARD && !e.target.closest('[data-act=stop]')) return;
    const grade = e.target.closest('[data-grade]');
    if (grade) return this.grade(grade.dataset.grade);
    const opt = e.target.closest('[data-opt]');
    if (opt) return this.choose(+opt.dataset.opt);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) return this.act(act, e);
    // Tik op de kaart om te draaien.
    if (e.target.closest('.fc-flip') && this.q?.kind === 'flip' && !this.q.shown) this.show();
  }

  act(act, e) {
    switch (act) {
      case 'learn': return this.start('learn', c => L.pickRound(c));
      case 'review': return this.start('review', c => L.pickReview(c));
      case 'cram': return this.start('cram', c => L.pickReview(c, L.mode(c), { early: true }));
      case 'other':
        L.setSetting(this.c, 'mode', { v: L.mode(this.c) === 'ab' ? 'ba' : 'ab' });
        this.changed();
        return this.start('learn', c => L.pickRound(c));
      case 'paste': return this.pasteDialog();
      case 'del': return this.removeRow(e.target.closest('.fc-row'));
      case 'stop': return this.stop();
      case 'know': return this.answerAndNext('known');
      case 'seen': return this.answerAndNext('learn');
      case 'show': return this.show();
      case 'next': return this.advance();
      case 'dunno': return this.dunno();
      case 'right': return this.answerAndNext('good');
    }
  }

  removeRow(row) {
    const card = this.card(row.dataset.id);
    if (!card) return;
    this.pushUndo(this.snapshot());
    this.dropRow(row, card);
    toast('Kaart verwijderd. Met de pijl linksboven zet je ze terug.');
  }

  // ---------- leren ----------

  start(kind, pick) {
    this.finishEdit();
    this.cb.onIdle?.(); // eerst meenemen wat er intussen van een ander toestel binnenkwam
    const ids = pick(this.c);
    if (!ids.length) return this.round ? this.stop() : undefined;
    this.resetHistory(); // ongedaan maken zou anders ook de voortgang terugdraaien
    this.round = new L.Round(this.c, ids, { kind });
    this.editEl.hidden = true;
    this.sessionEl.hidden = false;
    this.stage.dataset.kind = '';
    this.sessionEl.focus({ preventScroll: true });
    this.nextCard();
  }

  // Antwoorden staan al op dit toestel; nu mogen ze ook naar de Sheet.
  send() {
    if (!this.unsent) return;
    this.unsent = false;
    this.cb.onRound?.();
  }

  stop() {
    clearTimeout(this.timer);
    if (this.q?.pending && this.round.alive()) this.commit(this.q.pending);
    this.round = null;
    this.q = null;
    this.sessionEl.hidden = true;
    this.editEl.hidden = false;
    this.stage.innerHTML = '';
    this.renderEdit();
    this.send();
    this.cb.onIdle?.();
  }

  nextCard() {
    clearTimeout(this.timer);
    const t = this.round.next();
    this.paintBar();
    if (!t) return this.summary();
    const step = this.round.step();
    const kind = step === 1 ? 'view' : step === 2 ? 'choose' : step === 4 ? (L.isLong(t.a) ? 'explain' : 'type') : 'flip';
    this.q = { t, step, kind, shown: false, answered: false, pending: null, chosen: null, checked: null, given: '', options: this.round.options };
    this.shownAt = performance.now();
    this.renderTask();
  }

  // Legt het antwoord vast en bewaart het meteen op dit toestel.
  commit(result) {
    this.q.pending = null;
    this.q.answered = true;
    this.round.answer(result);
    this.unsent = true;
    this.cb.onAnswer?.();
    this.paintBar();
  }

  answerAndNext(result) {
    const q = this.q;
    if (!q || q.answered) return;
    this.commit(result);
    // Bewaren kan wijzigingen van een ander toestel binnenhalen, en dan staat er al een andere kaart.
    if (this.q === q) this.nextCard();
  }

  // Verder na de feedback.
  advance() {
    const q = this.q;
    if (!q) return;
    if (q.pending) this.commit(q.pending);
    if (this.q === q && q.answered) this.nextCard();
  }

  // Na een juist antwoord gaat het na een tel vanzelf verder.
  autoNext(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.advance(), ms);
  }

  paintBar() {
    const r = this.round, pct = Math.round(r.fraction() * 100);
    const bar = this.sessionEl.querySelector('.fc-bar');
    bar.firstElementChild.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', pct);
    this.sessionEl.querySelector('.fc-left').textContent = `${r.done.size}/${r.total}`;
  }

  metaHTML() {
    const { t, step } = this.q;
    const chip = step
      ? `<span class="fc-dots">${[1, 2, 3, 4].map(i => `<i class="${i < step ? 'on' : i === step ? 'now' : ''}"></i>`).join('')}</span>Stap ${step} · ${this.q.kind === 'explain' ? 'Uitleggen' : L.STEPS[step - 1]}`
      : this.round.kind === 'cram' ? 'Overlopen' : 'Herhalen';
    return `<span class="fc-chip">${chip}</span><span class="fc-dirname">${esc(L.dirLabel(this.c, t.dir))}</span>`;
  }

  sideNames() {
    const s = L.sides(this.c);
    return this.q.t.dir === 'ab' ? { q: s.a, a: s.b } : { q: s.b, a: s.a };
  }

  faceHTML(label, text, cls = '') {
    return `<div class="fc-card ${cls}"><div class="fc-label">${esc(label)}</div><div class="fc-face">${textHTML(text)}</div></div>`;
  }

  renderTask() {
    const { t, kind, shown } = this.q;
    const n = this.sideNames();
    // Van typen naar typen: hetzelfde invoerveld houden, anders klapt het toetsenbord dicht.
    if (kind === 'type' && this.stage.dataset.kind === 'type') return this.patchType();
    const swap = this.stage.dataset.id !== t.id || this.stage.dataset.kind !== kind || !shown;
    this.stage.dataset.kind = kind;
    this.stage.dataset.id = t.id;
    let body;
    if (kind === 'view') {
      body = `<div class="fc-card both"><div class="fc-label">${esc(n.q)}</div><div class="fc-face">${textHTML(t.q)}</div>
          <div class="fc-label second">${esc(n.a)}</div><div class="fc-face">${textHTML(t.a)}</div></div>
        <div class="fc-controls"><button class="btn soft" data-act="know">Ken ik al</button><button class="btn primary" data-act="seen">Verder</button></div>`;
    } else if (kind === 'choose') {
      body = `${this.faceHTML(n.q, t.q)}<div class="fc-opts${this.q.options.every(o => o.text.length <= 28) ? ' two' : ''}">${this.optionsHTML()}</div>
        <div class="fc-feedback" role="status"></div><div class="fc-controls"></div>`;
    } else if (kind === 'flip') {
      body = `<div class="fc-flip${shown ? ' on' : ''}"><div class="fc-flip-in">
          ${this.faceHTML(n.q, t.q, 'front')}
          <div class="fc-card back"><div class="fc-label">${esc(n.a)}</div><div class="fc-face"><div class="fc-small" dir="auto">${esc(t.q)}</div>${textHTML(t.a)}</div></div>
        </div></div>
        <div class="fc-controls">${this.gradesHTML()}</div>`;
    } else if (kind === 'explain') {
      body = `${this.faceHTML(n.q, t.q)}
        ${shown ? this.faceHTML(n.a, t.a, 'answer') : `<p class="fc-ask">Leg het uit in je eigen woorden, hardop of op papier. Vergelijk daarna.</p>`}
        <div class="fc-controls">${this.gradesHTML()}</div>`;
    } else {
      body = `<div class="fc-q">${this.faceHTML(n.q, t.q)}</div>
        <form class="fc-type"><input class="fc-input" type="text" enterkeyhint="go" aria-label="Jouw antwoord" placeholder="Typ het antwoord" ${PLAIN}>
          <div class="fc-feedback" role="status"></div><div class="fc-controls"></div></form>`;
    }
    this.stage.innerHTML = `<div class="fc-meta">${this.metaHTML()}</div>${body}`;
    this.stage.classList.toggle('in', swap);
    this.stage.classList.toggle('tall', kind === 'choose' && this.q.options.some(o => o.text.length > 60));
    this.sessionEl.scrollTop = 0;
    if (kind === 'type') {
      this.typeControls();
      this.stage.querySelector('.fc-input').focus({ preventScroll: true });
    }
  }

  // ---------- kiezen ----------

  optionsHTML() {
    return this.q.options.map((o, i) => {
      const c = this.q.chosen;
      const cls = c == null ? '' : o.right ? ' right' : i === c ? ' wrong' : ' dim';
      return `<button class="fc-opt${cls}" data-opt="${i}"${c == null ? '' : ' disabled'} dir="auto"><kbd>${i + 1}</kbd><span>${brHTML(o.text)}</span></button>`;
    }).join('');
  }

  choose(i) {
    const q = this.q;
    if (q?.kind !== 'choose' || q.chosen != null || !q.options[i]) return;
    q.chosen = i;
    const right = q.options[i].right;
    this.commit(right ? 'good' : 'bad');
    if (this.q !== q) return;
    this.stage.querySelector('.fc-opts').innerHTML = this.optionsHTML();
    this.feedback(right ? 'good' : 'bad', right ? 'Juist!' : 'Niet juist. Het goede antwoord staat in het groen.');
    if (right) this.autoNext(700);
    else this.stage.querySelector('.fc-controls').innerHTML = `<button class="btn primary" data-act="next">Verder</button>`;
    this.stage.querySelector('.fc-controls').scrollIntoView({ block: 'nearest' });
  }

  // ---------- omdraaien en uitleggen ----------

  gradesHTML() {
    const { kind, shown } = this.q;
    if (!shown) return `<button class="btn primary" data-act="show">${icon('flip')}<span>${kind === 'flip' ? 'Omdraaien' : 'Toon het antwoord'}</span></button>`;
    const labels = kind === 'flip' ? ['Wist ik niet', 'Twijfel', 'Wist ik'] : ['Fout', 'Bijna', 'Juist'];
    return ['bad', 'doubt', 'good'].map((g, i) => `<button class="btn fc-grade ${g}" data-grade="${g}"><kbd>${i + 1}</kbd><span>${labels[i]}</span></button>`).join('');
  }

  show() {
    const q = this.q;
    if (!q || q.shown || (q.kind !== 'flip' && q.kind !== 'explain')) return;
    q.shown = true;
    if (q.kind === 'flip') {
      this.stage.querySelector('.fc-flip').classList.add('on');
      this.stage.querySelector('.fc-controls').innerHTML = this.gradesHTML();
    } else {
      this.renderTask();
    }
    this.stage.querySelector('.fc-controls').scrollIntoView({ block: 'nearest' });
  }

  grade(result) {
    if (this.q?.shown) this.answerAndNext(result);
  }

  // ---------- typen ----------

  get input() {
    return this.stage.querySelector('.fc-input');
  }

  patchType() {
    const { t } = this.q;
    this.stage.dataset.id = t.id;
    this.stage.querySelector('.fc-meta').innerHTML = this.metaHTML();
    this.stage.querySelector('.fc-q').innerHTML = this.faceHTML(this.sideNames().q, t.q);
    this.input.value = '';
    this.input.className = 'fc-input';
    this.feedback('', '');
    this.typeControls();
    this.input.focus({ preventScroll: true });
  }

  typeControls() {
    this.stage.querySelector('.fc-controls').innerHTML = this.q.checked == null
      ? `<button type="button" class="btn soft" data-act="dunno">Weet ik niet</button><button type="submit" class="btn primary">Controleer</button>`
      : `${this.q.pending && this.q.given ? `<button type="button" class="btn soft" data-act="right">Toch juist rekenen</button>` : ''}<button type="submit" class="btn primary">Verder</button>`;
  }

  // Enter of de knop: eerst controleren, daarna verder.
  submit() {
    const q = this.q;
    if (q?.kind !== 'type') return;
    if (q.checked != null) return this.advance();
    const given = this.input.value.trim();
    if (!given) {
      this.feedback('', 'Typ een antwoord, of kies “Weet ik niet”.');
      this.input.focus({ preventScroll: true });
      return;
    }
    this.judge(given, L.check(given, L.acceptedAnswers(this.c, q.t)));
  }

  dunno() {
    if (this.q?.kind === 'type' && this.q.checked == null) this.judge('', { verdict: 'bad', answer: this.q.t.a });
  }

  judge(given, r) {
    const q = this.q;
    q.checked = r.verdict;
    q.given = given;
    this.input.classList.add(r.verdict);
    if (given) this.input.value = given;
    const right = `<div class="fc-right"><span>Juist is</span> <b dir="auto">${brHTML(r.answer)}</b></div>`;
    if (r.verdict === 'good') {
      this.commit('good');
      if (this.q !== q) return;
      const full = r.answer.trim() !== given ? ` <b dir="auto">${esc(r.answer)}</b>` : '';
      this.feedback('good', `Juist!${full}`, true);
      this.autoNext(full ? 1500 : 900);
    } else {
      // Bijna telt niet als fout: de kaart blijft op deze stap en komt straks terug.
      q.pending = r.verdict === 'near' ? 'doubt' : 'bad';
      this.feedback(r.verdict, `${given ? (r.verdict === 'near' ? WHY[r.why] : 'Niet juist.') : 'Geen probleem, ze komt straks terug.'}${right}`, true);
    }
    this.typeControls();
  }

  feedback(kind, text, html = false) {
    const el = this.stage.querySelector('.fc-feedback');
    el.className = `fc-feedback ${kind}`;
    if (html) el.innerHTML = text;
    else el.textContent = text;
  }

  // ---------- einde van een ronde ----------

  summary() {
    this.q = null;
    this.send();
    const r = this.round, m = L.mode(this.c), st = L.stats(this.c, m), open = st.total - st.known;
    const learn = r.kind === 'learn';
    const all = learn && !open;
    const missed = r.ids.filter(id => r.missed.has(id)).length;
    const other = m === 'mix' ? null : m === 'ab' ? 'ba' : 'ab';
    const otherOpen = other && (x => x.total - x.known)(L.stats(this.c, other));

    let title, text;
    if (all) {
      title = 'Alles gekend! 🎉';
      const next = L.nextDue(this.c, m);
      text = `Je kent nu ${st.total === 1 ? 'je kaart' : `alle ${st.total} ${m === 'mix' ? 'vragen' : 'kaarten'}`}. ${st.due ? `${count(st.due, 'kaart mag', 'kaarten mogen')} herhaald worden.` : `De eerste komen ${inDays(next)} terug om te herhalen.`}`;
    } else if (learn) {
      title = 'Ronde klaar!';
      text = `${missed ? `${count(missed, 'kaart ging', 'kaarten gingen')} even mis en ${missed === 1 ? 'kwam' : 'kwamen'} terug. ` : 'Alles in één keer juist! '}Nog ${open} te leren.`;
    } else {
      title = r.kind === 'cram' ? 'Overlopen!' : 'Herhaald!';
      const good = r.total - missed;
      const back = r.ids.filter(id => L.stepOf(this.c, id) < L.KNOWN).length;
      text = `${good} van de ${r.total} wist je nog.${back ? ` ${count(back, 'kaart gaat', 'kaarten gaan')} terug naar Leren.` : ''}`;
    }

    const btns = [];
    if (learn && open) btns.push(['learn', 'Volgende ronde']);
    if (!learn && open) btns.push(['learn', 'Leren']);
    if (st.due) btns.push(['review', learn ? `Herhalen (${st.due})` : `Verder herhalen (${st.due})`]);
    if (all && otherOpen) btns.push(['other', `Nu ${L.dirLabel(this.c, other)}`]);
    const main = btns[0];
    const rest = btns.slice(1);

    const rows = r.ids.map(id => {
      const t = L.taskOf(this.c, id);
      if (!t) return '';
      const s = L.stepOf(this.c, id);
      const state = s >= L.KNOWN
        ? `<span class="fc-dots known">${icon('check')}</span><em>gekend</em>`
        : `<span class="fc-dots">${[1, 2, 3, 4].map(i => `<i class="${i < s ? 'on' : ''}"></i>`).join('')}</span><em>stap ${s}</em>`;
      return `<li class="${r.missed.has(id) ? 'missed' : ''}"><span class="fc-sum-q" dir="auto">${esc(t.q)}</span><span class="fc-sum-a" dir="auto">${esc(t.a)}</span><span class="fc-sum-s">${state}</span></li>`;
    }).join('');

    this.stage.dataset.kind = 'summary';
    this.stage.dataset.id = '';
    this.stage.classList.add('in');
    this.stage.innerHTML = `
      <div class="fc-sum">
        <h2>${title}</h2>
        <p>${esc(text)}</p>
        <div class="fc-sum-bar"><span class="fc-track"><i class="known" style="width:${st.total ? 100 * st.known / st.total : 0}%"></i><i class="busy" style="width:${st.total ? 100 * st.busy / st.total : 0}%"></i></span><span>${st.known}/${st.total} gekend</span></div>
        <ul>${rows}</ul>
        <div class="fc-controls">
          <button class="btn ${main ? 'soft' : 'primary'}" data-act="stop">${main ? 'Stoppen' : 'Klaar'}</button>
          ${rest.map(([a, l]) => `<button class="btn soft" data-act="${a}">${esc(l)}</button>`).join('')}
          ${main ? `<button class="btn primary" data-act="${main[0]}">${esc(main[1])}</button>` : ''}
        </div>
      </div>`;
    this.sessionEl.querySelector('.fc-bar').firstElementChild.style.width = '100%';
    if (all) confetti(this.sessionEl, this.stage.querySelector('h2'), CONFETTI);
  }

  // ---------- toetsen ----------

  // Sneltoetsen buiten een tekstvak. Geeft true terug als de toets verwerkt is.
  key(e) {
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (!this.round) {
      if (mod && k === 'z') { if (e.shiftKey) this.redo(); else this.undo(); return true; }
      if (mod && k === 'y') { this.redo(); return true; }
      return false;
    }
    if (mod || e.altKey) return false;
    if (e.key === 'Escape') { this.stop(); return true; }
    const go = e.key === 'Enter' || e.key === ' ';
    // Een knop die met Tab gekozen is, werkt gewoon zelf.
    if (go && e.target.closest?.('button')) return false;
    if (e.repeat) return go;
    if (!this.q) {
      if (go) this.stage.querySelector('.btn.primary')?.click();
      return go;
    }
    const q = this.q;
    const num = '1234'.indexOf(e.key);
    if (q.kind === 'view') {
      if (go || e.key === 'ArrowRight') { this.answerAndNext('learn'); return true; }
      if (k === 'k') { this.answerAndNext('known'); return true; }
    } else if (q.kind === 'choose') {
      if (q.chosen == null && num >= 0) { this.choose(num); return true; }
      if (q.chosen != null && go) { this.advance(); return true; }
    } else if (q.kind === 'flip' || q.kind === 'explain') {
      if (!q.shown && go) { this.show(); return true; }
      const g = { 1: 'bad', 2: 'doubt', 3: 'good', ArrowLeft: 'bad', ArrowDown: 'doubt', ArrowRight: 'good' }[e.key];
      if (q.shown && g) { this.grade(g); return true; }
    } else if (go) {
      this.submit();
      return true;
    } else if (e.key.length === 1) {
      // Typen zonder dat het veld actief is: het veld krijgt de toets alsnog.
      this.input?.focus({ preventScroll: true });
      return false;
    }
    return go;
  }
}
