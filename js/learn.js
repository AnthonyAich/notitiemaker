// Flashcards: de leerlogica, zonder scherm.
//
// Een document van het type 'cards' bevat in content.items:
//   { id, kind: 'card', a, b }                              a = voorkant, b = achterkant
//   { id: '<kaart>:ab', kind: 'progress', s, iv, due }      de voortgang, per richting apart
//   { id: 'sides', kind: 'setting', a, b } en { id: 'mode', kind: 'setting', v }
// Alles staat in dezelfde lijst als de blaadjes van een whiteboard. Zo voegt de opslag
// wijzigingen van twee toestellen per onderdeel samen, ook met een oudere versie van de app.
//
// Stap `s` is de stap die een kaart nog moet doen: 1 bekijken, 2 kiezen, 3 omdraaien, 4 typen,
// 5 = gekend. Een kaart zonder voortgang staat op stap 1. Een gekende kaart komt terug op dag `due`.

export const STEPS = ['Bekijken', 'Kiezen', 'Omdraaien', 'Typen'];
export const KNOWN = 5;
export const ROUND = 7;                      // kaarten per ronde
export const BACK_AFTER = 3;                 // een foute kaart komt na zoveel kaarten terug
export const REVIEW_MAX = 20;                // kaarten per keer herhalen
export const INTERVALS = [1, 3, 7, 14, 30];  // dagen tot een gekende kaart terugkomt
export const LONG = 40;                      // langere antwoorden typ je niet, die leg je uit

const DAY = 86400000;

// De dag (plaatselijke tijd) als geheel getal.
export function dayNumber(date = new Date()) {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
}

// ---------- instellingen ----------

const ofKind = kind => content => (content?.items || []).filter(i => i.kind === kind);
export const cardsOf = ofKind('card');
const progressOf = ofKind('progress');

const setting = (content, id) => (content.items || []).find(s => s.kind === 'setting' && s.id === id);

export function setSetting(content, id, values) {
  content.items ||= [];
  const s = setting(content, id);
  if (s) Object.assign(s, values);
  else content.items.push({ id, kind: 'setting', ...values });
}

export function sides(content) {
  const s = setting(content, 'sides');
  return { a: s?.a || 'Voorkant', b: s?.b || 'Achterkant' };
}

export function mode(content) {
  const v = setting(content, 'mode')?.v;
  return v === 'ba' || v === 'mix' ? v : 'ab';
}

export function dirLabel(content, dir) {
  const s = sides(content);
  return dir === 'ab' ? `${s.a} → ${s.b}` : `${s.b} → ${s.a}`;
}

// ---------- kaarten en voortgang ----------

export const isComplete = c => !!(c.a?.trim() && c.b?.trim());
export const isEmpty = c => !c.a?.trim() && !c.b?.trim();

export const dirsOf = m => (m === 'mix' ? ['ab', 'ba'] : [m]);

const cardId = id => id.slice(0, id.lastIndexOf(':'));

export function addCard(content, card) {
  content.items ||= [];
  content.items.push({ id: card.id, kind: 'card', a: card.a, b: card.b });
}

export function cardOf(content, id) {
  return (content.items || []).find(c => c.kind === 'card' && c.id === id);
}

// Een taak is één kaart in één richting.
export function taskOf(content, id) {
  const dir = id.slice(id.lastIndexOf(':') + 1);
  const card = cardOf(content, cardId(id));
  if (!card || !isComplete(card)) return null;
  return { id, card, dir, q: (dir === 'ab' ? card.a : card.b).trim(), a: (dir === 'ab' ? card.b : card.a).trim() };
}

export function tasks(content, m = mode(content)) {
  const dirs = dirsOf(m);
  return cardsOf(content).filter(isComplete).flatMap(c => dirs.map(d => `${c.id}:${d}`));
}

export const progressMap = content => new Map(progressOf(content).map(p => [p.id, p]));

export function entry(content, id) {
  return (content.items || []).find(p => p.kind === 'progress' && p.id === id) || null;
}

export function stepOf(content, id) {
  return entry(content, id)?.s || 1;
}

function put(content, id, values) {
  content.items ||= [];
  let e = entry(content, id);
  if (!e) content.items.push(e = { id, kind: 'progress' });
  delete e.iv;
  delete e.due;
  Object.assign(e, values);
}

// Verwijdert een kaart, met haar voortgang.
export function removeCard(content, id) {
  content.items = (content.items || []).filter(i =>
    !(i.kind === 'card' && i.id === id) && !(i.kind === 'progress' && cardId(i.id) === id));
}

export const hasProgress = content => progressOf(content).length > 0;

export function clearProgress(content) {
  content.items = (content.items || []).filter(i => i.kind !== 'progress');
}

// Bij het terugzetten van een oudere versie blijft wat je intussen leerde staan.
export function keepProgress(oldContent, current) {
  const ids = new Set(cardsOf(oldContent).map(c => c.id));
  const map = progressMap(oldContent);
  for (const p of progressOf(current)) if (ids.has(cardId(p.id))) map.set(p.id, p);
  clearProgress(oldContent);
  oldContent.items.push(...map.values());
}

export function stats(content, m = mode(content), day = dayNumber()) {
  const map = progressMap(content);
  const out = { total: 0, known: 0, busy: 0, fresh: 0, due: 0 };
  for (const id of tasks(content, m)) {
    const p = map.get(id);
    out.total++;
    if (!p) out.fresh++;
    else if (!(p.s >= KNOWN)) out.busy++;
    else {
      out.known++;
      if (p.due <= day) out.due++;
    }
  }
  return out;
}

// Over hoeveel dagen komt de eerste gekende kaart terug? null = er zijn er geen.
export function nextDue(content, m = mode(content), day = dayNumber()) {
  const map = progressMap(content);
  const dues = tasks(content, m).map(id => map.get(id)).filter(p => p?.s === KNOWN).map(p => p.due - day);
  return dues.length ? Math.max(0, Math.min(...dues)) : null;
}

// ---------- antwoorden ----------

// Antwoord in de leerronde. result: 'learn' | 'known' (stap 1), 'good' | 'doubt' | 'bad' (stap 2-4).
export function applyAnswer(content, id, step, result, { choosable = true, day = dayNumber() } = {}) {
  let to = step;
  if (step === 1) to = result === 'known' || !choosable ? 3 : 2;
  else if (result === 'good') to = step + 1;
  else if (result === 'bad') to = step === 3 && !choosable ? 1 : step - 1;
  put(content, id, to >= KNOWN ? { s: KNOWN, iv: 0, due: day + INTERVALS[0] } : { s: to });
  return to;
}

// Antwoord bij het herhalen van een gekende kaart.
export function applyReview(content, id, result, { day = dayNumber() } = {}) {
  const e = entry(content, id);
  const iv = e?.iv || 0;
  if (result === 'bad') put(content, id, { s: 3 });
  else if (result === 'doubt') put(content, id, { s: KNOWN, iv: Math.max(0, iv - 1), due: day + 1 });
  else if (!e || e.due <= day) {
    const next = Math.min(iv + 1, INTERVALS.length - 1);
    put(content, id, { s: KNOWN, iv: next, due: day + INTERVALS[next] });
  }
  // Juist, maar nog niet aan de beurt ("toch overlopen"): de datum blijft staan.
  return stepOf(content, id);
}

// ---------- tekst vergelijken ----------

// Hoofdletters, leestekens en spaties tellen niet mee; accenten wel.
export function normalize(text) {
  const raw = String(text ?? '').normalize('NFC').toLowerCase().trim();
  const t = raw
    .replace(/[’‘`´ʼ]/g, "'")
    .replace(/(\d)[.,](?=\d)/g, '$1\u0001')           // 3,14 = 3.14
    .replace(/(^|[\s(=])[-−–](?=\d)/g, '$1\u0002')    // -5 is niet 5
    .replace(/\./g, '')
    .replace(/[,;:!?¿¡"“”„«»‹›…()[\]{}]/g, ' ')
    .replace(/[-−–—‐‑'/]/g, ' ')
    .replace(/\u0001/g, '.')
    .replace(/\u0002/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return t || raw;
}

const SPECIAL = { œ: 'oe', æ: 'ae', ß: 'ss', ø: 'o', ł: 'l', đ: 'd', ı: 'i' };

// Zonder accenten.
export function fold(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[œæßøłđı]/g, c => SPECIAL[c]);
}

// De juiste antwoorden in één vak: gescheiden met "/", en wat tussen haakjes staat mag je weglaten.
// Zonder spaties rond de streep gelden korte stukjes als één geheel (km/u, 1/2, de/het).
export function alternatives(text) {
  const full = String(text ?? '').trim();
  const list = [full];
  const masked = full.replace(/(\d)\s*\/\s*(?=\d)/g, '$1\u0001');
  const parts = masked.split('/').map(p => p.replace(/\u0001/g, '/').trim()).filter(Boolean);
  if (parts.length > 1 && (/\s\/|\/\s/.test(masked) || parts.every(p => p.length >= 3))) list.push(...parts);
  for (const v of [...list]) if (/\([^()]*\)/.test(v)) list.push(v.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim());
  return [...new Set(list)].filter(Boolean);
}

// Lange antwoorden (definities) leg je uit in plaats van ze te typen.
export function isLong(text) {
  return /\n/.test(String(text).trim()) || Math.min(...alternatives(text).map(a => a.length)) > LONG;
}

// Aantal typfouten tussen twee woorden (ook omgewisselde letters tellen als één).
export function distance(a, b) {
  const x = [...a], y = [...b];
  let prev2 = [], prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) row[j] = Math.min(row[j], prev2[j - 2] + 1);
    }
    prev2 = prev;
    prev = row;
  }
  return prev[y.length];
}

const typosAllowed = len => (len <= 3 ? 0 : len <= 7 ? 1 : len <= 15 ? 2 : 3);
const digits = s => (s.match(/-?\d+(?:\.\d+)?/g) || []).join(' ');
const listParts = s => String(s).split(/;|,(?!\d)/).map(normalize).filter(Boolean);

// Ontbreken er in `short` enkel korte woordjes (lidwoorden) tegenover `long`?
function onlySmallWordsMissing(short, long) {
  let i = 0;
  for (const w of long) {
    if (i < short.length && short[i] === w) i++;
    else if (w.length > 3) return false;
  }
  return i === short.length && short.length > 0 && short.length < long.length;
}

// Vergelijkt een getypt antwoord met één juist antwoord.
function compare(given, answer) {
  const g = normalize(given), a = normalize(answer);
  if (g === a) return { verdict: 'good' };
  const gl = listParts(given), al = listParts(answer);
  // Een opsomming mag in een andere volgorde.
  if (al.length > 1 && gl.length === al.length && [...gl].sort().join('|') === [...al].sort().join('|')) return { verdict: 'good' };
  const fg = fold(g), fa = fold(a);
  if (fg === fa) return { verdict: 'near', why: 'accent' };
  if (digits(g) !== digits(a)) return { verdict: 'bad' };
  if (fg.replace(/ /g, '') === fa.replace(/ /g, '')) return { verdict: 'near', why: 'spatie' };
  if (al.length > 1 && gl.length && gl.length < al.length && gl.every(p => al.includes(p))) return { verdict: 'near', why: 'deel' };

  const wg = fg.split(' '), wa = fa.split(' ');
  if (onlySmallWordsMissing(wg, wa) || onlySmallWordsMissing(wa, wg)) return { verdict: 'near', why: 'lidwoord' };
  if (distance(fg, fa) > typosAllowed(Math.max(fg.length, fa.length))) return { verdict: 'bad' };
  if (wg.length === wa.length) {
    for (let i = 0; i < wa.length; i++) {
      if (wg[i] === wa[i]) continue;
      // Een ander kort woord is geen typfout: le/la, de/het, in/op.
      if (Math.min(wg[i].length, wa[i].length) <= 3) return { verdict: 'bad' };
      if (distance(wg[i], wa[i]) > typosAllowed(Math.max(wg[i].length, wa[i].length))) return { verdict: 'bad' };
    }
  }
  return { verdict: 'near', why: 'spelling' };
}

const RANK = { good: 2, near: 1, bad: 0 };

// Controleert een getypt antwoord tegen alle juiste antwoorden.
// Geeft { verdict: 'good' | 'near' | 'bad', why, answer }.
export function check(given, answers) {
  let best = { verdict: 'bad', answer: answers[0] };
  if (!normalize(given)) return best;
  for (const answer of answers) {
    for (const alt of alternatives(answer)) {
      const r = compare(given, alt);
      if (RANK[r.verdict] > RANK[best.verdict]) best = { ...r, answer };
      if (best.verdict === 'good') return best;
    }
  }
  return best;
}

// De andere kaarten in dezelfde richting, als vraag en antwoord.
function others(content, task) {
  const [q, a] = task.dir === 'ab' ? ['a', 'b'] : ['b', 'a'];
  return cardsOf(content).filter(c => c.id !== task.card.id && isComplete(c)).map(c => ({ q: c[q].trim(), a: c[a].trim() }));
}

// Alle juiste antwoorden op een vraag: ook die van andere kaarten met dezelfde vraag.
export function acceptedAnswers(content, task) {
  const q = normalize(task.q);
  const out = [task.a];
  for (const o of others(content, task)) if (normalize(o.q) === q && !out.includes(o.a)) out.push(o.a);
  return out;
}

export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Meerkeuze: het juiste antwoord en hoogstens drie andere, die er wat op lijken.
// null als er geen andere antwoorden zijn.
export function choices(content, task, rng = Math.random) {
  const list = others(content, task);
  const q = normalize(task.q);
  const seen = new Set([task.a, ...list.filter(o => normalize(o.q) === q).map(o => o.a)].flatMap(alternatives).map(normalize));
  const first = normalize(task.a).split(' ')[0];
  const pool = [];
  for (const o of list) {
    const n = normalize(o.a);
    if (seen.has(n) || alternatives(o.a).some(v => seen.has(normalize(v)))) continue;
    seen.add(n);
    const len = Math.abs(o.a.length - task.a.length) / Math.max(o.a.length, task.a.length);
    pool.push({ text: o.a, score: len - (n.includes(' ') && n.split(' ')[0] === first ? 0.3 : 0) + rng() * 0.35 });
  }
  if (!pool.length) return null;
  const wrong = shuffle(pool.sort((x, y) => x.score - y.score).slice(0, 5), rng).slice(0, 3);
  return shuffle([{ text: task.a, right: true }, ...wrong.map(w => ({ text: w.text, right: false }))], rng);
}

// ---------- rondes ----------

// De taken voor een leerronde: eerst waar je mee bezig bent, dan nieuwe kaarten.
// Liefst elke kaart maar in één richting per ronde.
export function pickRound(content, m = mode(content), rng = Math.random) {
  const map = progressMap(content);
  const open = tasks(content, m).filter(id => (map.get(id)?.s || 1) < KNOWN);
  const busy = open.filter(id => map.has(id)).sort((x, y) => (map.get(x).t || 0) - (map.get(y).t || 0));
  let fresh = open.filter(id => !map.has(id));
  if (m === 'mix') {
    // Nieuwe kaarten beginnen om beurten langs de ene en de andere kant.
    const order = new Map(cardsOf(content).filter(isComplete).map((c, i) => [c.id, i]));
    const rank = id => {
      const n = order.get(cardId(id));
      return n * 2 + (((n % 2 === 0) === id.endsWith(':ab')) ? 0 : 1);
    };
    fresh = fresh.sort((x, y) => rank(x) - rank(y));
  }
  const picked = [], used = new Set(), rest = [];
  for (const id of [...busy, ...fresh]) {
    const card = cardId(id);
    if (used.has(card)) { rest.push(id); continue; }
    used.add(card);
    picked.push(id);
    if (picked.length === ROUND) break;
  }
  // Te weinig kaarten: dan toch de andere richting erbij.
  if (picked.length < ROUND) picked.push(...rest.slice(0, ROUND - picked.length));
  return shuffle(picked, rng);
}

// De taken om te herhalen, langst geleden eerst. Met `early` ook wat nog niet aan de beurt is.
export function pickReview(content, m = mode(content), { early = false, day = dayNumber(), rng = Math.random } = {}) {
  const map = progressMap(content);
  const list = tasks(content, m)
    .filter(id => map.get(id)?.s === KNOWN && (early || map.get(id).due <= day))
    .sort((x, y) => map.get(x).due - map.get(y).due);
  return shuffle(list.slice(0, REVIEW_MAX), rng);
}

// Eén ronde leren of herhalen. Werkt met id's, zodat het document intussen mag wijzigen.
export class Round {
  constructor(content, ids, { kind = 'learn', rng = Math.random, day = dayNumber() } = {}) {
    this.content = content;
    this.kind = kind;
    this.rng = rng;
    this.day = day;
    this.queue = [...ids];
    this.ids = [...ids];
    this.start = new Map(ids.map(id => [id, stepOf(content, id)]));
    this.done = new Set();
    this.missed = new Set();
    this.cur = null;
    this.curStep = 0;
    this.options = null;
  }

  // De volgende taak, of null als de ronde klaar is. Verwijderde kaarten vallen weg.
  next() {
    if (this.cur && !this.alive()) this.drop(this.cur.id);
    this.cur = null;
    this.options = null;
    while (this.queue.length) {
      const id = this.queue.shift();
      const t = taskOf(this.content, id);
      if (!t) { this.drop(id); continue; }
      this.cur = t;
      // Keuzes en stap liggen vast zolang de kaart op het scherm staat, ook als er intussen
      // iets binnenkomt van een ander toestel.
      this.options = this.kind === 'learn' ? choices(this.content, t, this.rng) : null;
      const s = Math.min(stepOf(this.content, id), 4);
      // Zonder andere antwoorden vervalt het kiezen. Bij herhalen is er geen stap.
      this.curStep = this.kind !== 'learn' ? 0 : s === 2 && !this.options ? 3 : s;
      return t;
    }
    return null;
  }

  drop(id) {
    this.ids = this.ids.filter(x => x !== id);
    this.queue = this.queue.filter(x => x !== id);
    this.done.delete(id);
  }

  // Bestaat de huidige kaart nog (bv. na een wijziging op een ander toestel)?
  alive() {
    return !!this.cur && !!taskOf(this.content, this.cur.id);
  }

  step() {
    return this.curStep;
  }

  answer(result) {
    const id = this.cur.id;
    if (this.kind !== 'learn') {
      const to = applyReview(this.content, id, result, { day: this.day });
      this.done.add(id);
      if (result !== 'good') this.missed.add(id);
      return { to, done: true };
    }
    const step = this.curStep;
    const to = applyAnswer(this.content, id, step, result, { choosable: !!this.options, day: this.day });
    if (result === 'bad') this.missed.add(id);
    // Na één juist antwoord (stap 2, 3 of 4) is de kaart klaar voor deze ronde.
    const done = step > 1 && result === 'good';
    if (done) this.done.add(id);
    else this.queue.splice(Math.min(BACK_AFTER, this.queue.length), 0, id);
    return { to, done };
  }

  get total() {
    return this.ids.length;
  }

  // Hoe ver staat de ronde (0 tot 1)? Een kaart die enkel bekeken is, telt half.
  fraction() {
    if (!this.ids.length) return 1;
    let n = 0;
    for (const id of this.ids) {
      if (this.done.has(id)) n += 1;
      else if (this.kind === 'learn' && this.start.get(id) === 1 && stepOf(this.content, id) > 1) n += 0.5;
    }
    return n / this.ids.length;
  }
}

// ---------- lijst plakken ----------

export const SEPARATORS = [
  ['auto', 'Automatisch'],
  ['tab', 'Tab (Excel, Word, Quizlet)'],
  [';', 'Puntkomma ;'],
  ['=', 'Gelijkteken ='],
  ['-', 'Streepje -'],
  [':', 'Dubbelepunt :'],
  [',', 'Komma ,'],
];

const SPLIT = {
  tab: /\t/,
  ';': /\s*;\s*/,
  '=': /\s*=\s*/,
  '-': /\s+[-–—]\s+|\s*[–—]\s*|\s*->\s*|\s*→\s*/,
  ':': /\s*:\s+/,
  ',': /\s*,\s*/,
};

// Rijen uit Excel: velden met een enter of aanhalingsteken staan tussen aanhalingstekens.
function tsvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false, start = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && start) {
      // Alleen een veld dat Excel zelf tussen aanhalingstekens zette (met een enter, tab of ").
      const m = /^"((?:[^"]|"")*)"(?=\t|\n|$)/.exec(text.slice(i));
      if (m && /[\t\n]|""/.test(m[1])) quoted = true;
      else field += c;
      start = false;
    } else if (c === '\t') { row.push(field); field = ''; start = true; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; start = true; }
    else { field += c; start = false; }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function splitLine(line, sep) {
  const clean = line.replace(/^\s*(?:[-*•▪◦–]\s+|\d{1,3}[.)]\s+)/, '').trim();
  const m = SPLIT[sep].exec(clean);
  if (!m) return null;
  const a = clean.slice(0, m.index).trim(), b = clean.slice(m.index + m[0].length).trim();
  return a && b ? { a, b } : null;
}

// Welk scheidingsteken past bij de meeste regels?
function detect(lines) {
  const count = sep => lines.filter(l => (sep === 'tab' ? /\S\s*\t\s*\S/.test(l) : splitLine(l, sep))).length;
  let best = 'tab', bestN = count('tab');
  if (bestN * 2 >= lines.length && bestN) return 'tab';
  for (const sep of [';', '=', '-', ':']) {
    const n = count(sep);
    if (n > bestN) { best = sep; bestN = n; }
  }
  return best;
}

// Maakt kaarten van geplakte tekst, één kaart per regel.
// Geeft { cards: [{ a, b }], sep, skipped: [regels], extra } terug.
export function parseList(text, sep = 'auto', { swap = false } = {}) {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const lines = clean.split('\n').filter(l => l.trim());
  const used = sep === 'auto' ? detect(lines) : sep;
  const cards = [], skipped = [];
  let extra = 0;
  if (used === 'tab') {
    for (const row of tsvRows(clean)) {
      const cells = row.map(c => c.trim());
      if (!cells.some(Boolean)) continue;
      const [a, b] = cells;
      if (!a || !b) { skipped.push(cells.filter(Boolean).join(' ')); continue; }
      if (cells.slice(2).some(Boolean)) extra++;
      cards.push({ a, b });
    }
  } else {
    for (const l of lines) {
      const c = splitLine(l, used);
      if (c) cards.push(c);
      else skipped.push(l.trim());
    }
  }
  return { cards: swap ? cards.map(c => ({ a: c.b, b: c.a })) : cards, sep: used, skipped, extra };
}

// Laat kaarten weg die al bestaan (zelfde voor- en achterkant).
export function withoutDuplicates(list, existing = []) {
  const key = c => `${normalize(c.a)}|${normalize(c.b)}`;
  const seen = new Set(existing.map(key));
  const out = [];
  for (const c of list) {
    const k = key(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
