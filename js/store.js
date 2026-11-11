// Opslag: de documenten van de ingelogde gebruiker staan lokaal (localStorage)
// en worden gesynchroniseerd met de Google Sheet via de Apps Script web-app.
//
// Samenvoegen in plaats van overschrijven: elk onderdeel van een document (blaadje,
// tekstvak, streep, sticker) krijgt bij elke wijziging een tijdstempel `t`, en wat je
// verwijdert wordt bijgehouden in `content.deleted`. Werd een document op twee plaatsen
// aangepast, dan worden beide versies per onderdeel samengevoegd: niets gaat verloren.
// `syncBase` is de serverversie (updatedAt) waarop dit toestel verder werkt.
import { API_URL } from './config.js';

const SESSION_KEY = 'notitiemaker.session.v1';
// Per gebruiker, op de vaste id (oudere sessies hebben enkel een gebruikersnaam).
const docsKey = session => `notitiemaker.docs.v2.${session.id || session.username}`;
// Uit de versie zonder gebruikers: worden bij de eerste login overgenomen.
const LEGACY_DOCS_KEY = 'notitiemaker.docs.v1';
const LEGACY_CFG_KEY = 'notitiemaker.sync.v1';
// Lijsten in een document waarvan de onderdelen een eigen id hebben.
const LISTS = ['items', 'strokes', 'stickers'];
const KEEP_DELETED_MS = 120 * 86400000;

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Opslaan in localStorage mislukt', e);
    return false;
  }
}

function forget(key) {
  try { localStorage.removeItem(key); } catch { /* niet erg */ }
}

// Heeft dit toestel wijzigingen die nog niet op de server staan?
function isDirty(local) {
  return local.syncBase != null && local.updatedAt !== local.syncBase;
}

// ---------- samenvoegen ----------

const withoutStamp = o => JSON.stringify(o, (k, v) => (k === 't' ? undefined : v));

// Vingerafdruk van elk onderdeel van een document, om wijzigingen te herkennen.
function fingerprints(doc) {
  const map = new Map();
  if (!doc?.content || doc.deleted) return map;
  for (const list of LISTS) {
    for (const o of doc.content[list] || []) if (o?.id) map.set(`${list}:${o.id}`, withoutStamp(o));
  }
  return map;
}

// Lijst samenvoegen: per id wint de meest recente versie; verwijderingen tellen mee.
function mergeList(localArr = [], serverArr = [], deleted = {}) {
  const pick = new Map();
  for (const o of serverArr) pick.set(o.id, o);
  for (const o of localArr) {
    const s = pick.get(o.id);
    if (!s || (o.t || 0) >= (s.t || 0)) pick.set(o.id, o);
  }
  const order = [], seen = new Set();
  for (const o of [...localArr, ...serverArr]) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    order.push(o.id);
  }
  return order.map(id => pick.get(id)).filter(o => !((deleted[o.id] || 0) > (o.t || 0)));
}

export function mergeDocs(local, server) {
  const deleted = { ...(server.content?.deleted || {}) };
  for (const [id, t] of Object.entries(local.content?.deleted || {})) if (!(deleted[id] >= t)) deleted[id] = t;
  const content = { ...server.content, ...local.content, deleted };
  for (const list of LISTS) {
    if (local.content?.[list] || server.content?.[list]) content[list] = mergeList(local.content?.[list], server.content?.[list], deleted);
  }
  if (local.content?.pages || server.content?.pages) content.pages = Math.max(local.content?.pages || 1, server.content?.pages || 1);
  // Titel, kaft, favoriet, prullenbak: de laatst gewijzigde versie wint.
  const newer = local.updatedAt >= server.updatedAt ? local : server;
  const older = newer === local ? server : local;
  return { ...older, ...newer, content };
}

class Store extends EventTarget {
  constructor() {
    super();
    this.url = API_URL;
    this.session = read(SESSION_KEY, null);
    this.status = { state: this.session ? 'idle' : 'off', message: '', at: 0 };
    this.timer = null;
    this.running = null;
    this.again = false;
    // Versie van het Apps Script op de server.
    this.api = 0;
    this.tidied = false;
    // Vingerafdrukken per document, en verouderde objecten die nog open kunnen staan.
    this.prints = new Map();
    this.stale = new Map();
    this.setDocs(this.session ? read(docsKey(this.session), {}) : {});
    // Een ander tabblad met de app schreef naar localStorage: neem zijn kennis over.
    addEventListener('storage', e => {
      if (!this.session || e.key !== docsKey(this.session) || !e.newValue) return;
      try { this.mergeFrom(JSON.parse(e.newValue)); } catch { /* onleesbaar: negeren */ }
    });
  }

  setDocs(docs) {
    this.docs = docs;
    this.prints = new Map(Object.values(docs).map(d => [d.id, fingerprints(d)]));
    this.stale = new Map();
  }

  // Vervangt een document door een andere versie. Het oude object kan nog open staan in de
  // editor; bewaart iemand dat later, dan wordt het samengevoegd in plaats van overschreven.
  replace(doc) {
    const old = this.docs[doc.id];
    if (old && old !== doc && !old.deleted) this.stale.set(doc.id, { obj: old, prints: this.prints.get(doc.id) || new Map() });
    this.docs[doc.id] = doc;
    this.prints.set(doc.id, fingerprints(doc));
  }

  // Geeft gewijzigde onderdelen een tijdstempel en noteert wat verdween.
  // Geeft true terug als er iets veranderd was.
  stamp(doc, before = this.prints.get(doc.id)) {
    if (!doc?.content || doc.deleted) return false;
    const now = Date.now();
    const after = fingerprints(doc);
    let changed = false;
    if (before) {
      const deleted = doc.content.deleted || {};
      for (const list of LISTS) {
        for (const o of doc.content[list] || []) {
          const k = `${list}:${o.id}`;
          if (before.get(k) !== after.get(k)) { o.t = now; changed = true; }
          delete deleted[o.id];
        }
      }
      for (const k of before.keys()) {
        if (!after.has(k)) { deleted[k.slice(k.indexOf(':') + 1)] = now; changed = true; }
      }
      for (const [id, t] of Object.entries(deleted)) if (now - t > KEEP_DELETED_MS) delete deleted[id];
      if (Object.keys(deleted).length) doc.content.deleted = deleted;
    }
    this.prints.set(doc.id, after);
    return changed;
  }

  // Neemt nieuwere documenten en nieuwere serverkennis (syncBase) over van een ander tabblad.
  mergeFrom(other) {
    const ids = [];
    for (const [id, o] of Object.entries(other || {})) {
      const l = this.docs[id];
      if (!l || o.updatedAt > l.updatedAt) {
        if (l && !l.deleted && !o.deleted) {
          // Had dit tabblad nog iets dat het andere niet had, dan blijft het "te synchroniseren".
          const m = mergeDocs(l, o);
          this.replace(withoutStamp(m.content) === withoutStamp(o.content) ? o : { ...m, syncBase: o.syncBase, updatedAt: Date.now() });
        } else {
          this.replace(o);
        }
        ids.push(id);
      } else if (o.updatedAt === l.updatedAt && (o.syncBase ?? -1) > (l.syncBase ?? -1)) {
        l.syncBase = o.syncBase;
      }
    }
    if (ids.length) this.emit('change', { ids, source: 'remote' });
  }

  // ---------- documenten ----------

  list() {
    return Object.values(this.docs).filter(d => !d.deleted);
  }

  get(id) {
    const d = this.docs[id];
    return d && !d.deleted ? d : null;
  }

  save(doc) {
    const cur = this.docs[doc.id];
    const stale = this.stale.get(doc.id);
    if (cur && cur !== doc && stale?.obj === doc && !cur.deleted) {
      // Een verouderde versie (intussen vervangen) wordt samengevoegd met de huidige.
      this.stamp(doc, stale.prints);
      stale.prints = fingerprints(doc);
      const merged = { ...mergeDocs(doc, cur), syncBase: cur.syncBase, updatedAt: Date.now() };
      this.docs[doc.id] = merged;
      this.prints.set(doc.id, fingerprints(merged));
      this.persist();
      this.emit('merged', { ids: [doc.id] });
      this.emit('change', { ids: [doc.id], source: 'remote' });
      this.schedule();
      return;
    }
    this.stamp(doc);
    doc.updatedAt = Date.now();
    this.docs[doc.id] = doc;
    this.persist();
    this.emit('change', { ids: [doc.id], source: 'local' });
    this.schedule();
  }

  remove(id) {
    // Een "grafsteen" zodat andere toestellen het document ook verwijderen.
    this.replace({ id, deleted: true, updatedAt: Date.now(), syncBase: this.docs[id]?.syncBase });
    this.stale.delete(id);
    this.persist();
    this.emit('change', { ids: [id], source: 'local' });
    this.schedule();
  }

  importDocs(list) {
    const ids = [];
    for (const d of list) {
      if (!d?.id || !d.content || !d.type || d.deleted) continue;
      d.updatedAt = Date.now();
      // Een back-up terugzetten mag de huidige versie overschrijven.
      d.syncBase = this.docs[d.id]?.syncBase;
      this.replace(d);
      ids.push(d.id);
    }
    this.persist();
    this.emit('change', { ids, source: 'local' });
    this.schedule();
    return ids.length;
  }

  persist() {
    if (!this.session) return;
    if (!write(docsKey(this.session), this.docs)) this.setStatus('error', 'De lokale opslag van je browser is vol.');
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setStatus(state, message = '') {
    this.status = { state, message, at: Date.now() };
    this.emit('status', this.status);
  }

  // ---------- account ----------

  async login(username, password) {
    const res = await this.request('login', { username, password });
    this.api = res.api || 0;
    this.session = { ...res.user, token: res.token };
    write(SESSION_KEY, this.session);
    const docs = read(docsKey(this.session), {});
    // Kopie van vóór de vaste id's (opgeslagen onder de gebruikersnaam) overnemen.
    const byName = `notitiemaker.docs.v2.${this.session.username}`;
    const old = this.session.id ? read(byName, null) : null;
    if (old) {
      for (const d of Object.values(old)) if (!docs[d.id] || d.updatedAt > docs[d.id].updatedAt) docs[d.id] = d;
      forget(byName);
    }
    // Notities van vóór de accounts op dit toestel horen bij wie hier als eerste inlogt.
    const legacy = read(LEGACY_DOCS_KEY, null);
    if (legacy) {
      // De echte wijzigingsdatum blijft staan: een nieuwere versie op de server wint.
      for (const d of Object.values(legacy)) if (!d.deleted && !docs[d.id]) docs[d.id] = d;
      forget(LEGACY_DOCS_KEY);
      forget(LEGACY_CFG_KEY);
    }
    this.setDocs(docs);
    this.persist();
    this.tidied = false;
    this.setStatus('idle');
    this.emit('session');
    await this.sync();
  }

  // Afmelden. De lokale kopie wordt gewist, behalve als niet alles gesynchroniseerd is.
  logout({ keepLocal = false } = {}) {
    if (this.session && !keepLocal) forget(docsKey(this.session));
    this.session = null;
    this.setDocs({});
    this.api = 0;
    clearTimeout(this.timer);
    forget(SESSION_KEY);
    this.setStatus('off');
    this.emit('session');
  }

  // De beheerder wijzigde de eigen naam of gebruikersnaam.
  renamed(user) {
    this.session = { ...this.session, name: user.name, username: user.username };
    write(SESSION_KEY, this.session);
    this.emit('status', this.status);
  }

  async changePassword(oldPassword, newPassword) {
    const res = await this.request('changePassword', { oldPassword, newPassword });
    // Het wachtwoord wijzigen maakt oude sessies ongeldig; deze krijgt een nieuwe.
    this.session = { ...this.session, token: res.token };
    write(SESSION_KEY, this.session);
  }

  // ---------- server ----------

  schedule(delay = 1500) {
    if (!this.session) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), delay);
  }

  async request(action, payload = {}) {
    let res;
    try {
      // text/plain voorkomt een CORS-preflight, die Apps Script niet ondersteunt.
      res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: this.session?.token, ...payload }),
      });
    } catch {
      throw new Error(navigator.onLine === false
        ? 'Je bent offline. Wijzigingen worden later gesynchroniseerd.'
        : 'Kan de server niet bereiken. Probeer het straks opnieuw.');
    }
    if (!res.ok) throw new Error(`De server antwoordde met fout ${res.status}.`);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Onverwacht antwoord van de server.');
    }
    if (!data.ok) {
      if (data.auth && this.session) this.emit('auth', { message: data.error });
      if (/Onbekende actie|Ongeldige token|TOKEN/.test(data.error || '')) {
        throw new Error('De server gebruikt nog een oude versie van het Apps Script. Werk het bij (zie README).');
      }
      throw new Error(data.error || 'Onbekende fout');
    }
    return data;
  }

  sync() {
    if (!this.session) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.sync();
      }
    });
    return this.running;
  }

  // Haalt serverversies op. Heeft dit toestel ook wijzigingen, dan worden beide samengevoegd.
  async pull(ids) {
    if (!ids.length) return;
    const { docs } = await this.request('get', { ids });
    const changed = [], merged = [];
    for (const d of docs) {
      const local = this.docs[d.id];
      d.syncBase = d.updatedAt;
      // Ook wijzigingen die nog niet bewaard waren (bv. een markering van net) tellen mee.
      const pending = local && !local.deleted && this.stamp(local);
      if (local && !local.deleted && !d.deleted && (isDirty(local) || pending || local.syncBase == null && local.updatedAt > d.updatedAt)) {
        const m = { ...mergeDocs(local, d), syncBase: d.updatedAt, updatedAt: Date.now() };
        this.replace(m);
        merged.push(d.id);
      } else {
        this.replace(d);
      }
      changed.push(d.id);
    }
    this.persist();
    this.emit('change', { ids: changed, source: 'remote' });
    if (merged.length) {
      this.emit('merged', { ids: merged });
      this.schedule(300);
    }
  }

  // Oude conflictkopieën die niets nieuws bevatten (gelijk aan het origineel of aan een andere
  // kopie) gaan naar de prullenbak. Dat gebeurt één keer per sessie.
  tidyConflicts() {
    const re = /^(.*) \(conflict, [^)]*\)$/;
    const docs = this.list().filter(d => !d.trashedAt && (d.type === 'board' || d.type === 'notebook'));
    const byTitle = new Map();
    for (const d of docs) if (!re.test(d.title)) byTitle.set(d.title, [...(byTitle.get(d.title) || []), d]);
    const seen = new Set();
    let count = 0;
    for (const c of docs.sort((a, b) => b.updatedAt - a.updatedAt)) {
      const m = c.title.match(re);
      if (!m) continue;
      const body = withoutStamp(c.content.items) + withoutStamp(c.content.strokes);
      const same = o => !o.trashedAt && withoutStamp(o.content.items) + withoutStamp(o.content.strokes) === body;
      const originals = c.conflictOf && this.get(c.conflictOf) ? [this.get(c.conflictOf)] : byTitle.get(m[1]) || [];
      const key = `${c.conflictOf || m[1]}|${body}`;
      if (originals.some(same) || seen.has(key)) {
        c.trashedAt = Date.now();
        this.save(c);
        count++;
      } else {
        seen.add(key);
      }
    }
    if (count) this.emit('tidied', { count });
  }

  // Maar één tabblad tegelijk synchroniseert; daarna weet elk tabblad wat de andere deed.
  run() {
    return navigator.locks ? navigator.locks.request('notitiemaker-sync', () => this.runLocked()) : this.runLocked();
  }

  async runLocked() {
    clearTimeout(this.timer);
    this.setStatus('syncing');
    try {
      this.mergeFrom(read(docsKey(this.session), {}));
      const { docs: remote, api } = await this.request('list');
      this.api = api || 1;
      const remoteById = Object.fromEntries(remote.map(r => [r.id, r]));

      // Staat precies deze versie al op de server (bv. een antwoord dat onderweg verloren ging),
      // dan is het document gewoon gesynchroniseerd.
      for (const r of remote) {
        const l = this.docs[r.id];
        if (l && l.updatedAt === r.updatedAt) l.syncBase = r.updatedAt;
      }

      // Beschadigde rijen in de Sheet: herstellen met de kopie van dit toestel, of melden.
      const repair = new Set(), lost = [];
      for (const r of remote.filter(x => x.broken)) {
        const l = this.docs[r.id];
        if (l && !l.deleted) repair.add(r.id);
        else lost.push(r.title || r.id);
      }
      if (lost.length) this.emit('broken', { titles: lost });

      const toFetch = remote.filter(r => {
        if (r.broken) return false;
        const l = this.docs[r.id];
        return !l || (l.syncBase != null ? r.updatedAt !== l.syncBase : r.updatedAt !== l.updatedAt);
      }).map(r => r.id);
      await this.pull(toFetch);

      const toPush = Object.values(this.docs).filter(l => {
        const r = remoteById[l.id];
        if (repair.has(l.id)) return true;
        if (!r) return !l.deleted || l.syncBase != null;
        return isDirty(l) || (l.syncBase == null && l.updatedAt > r.updatedAt);
      });
      if (toPush.length) {
        const sent = Object.fromEntries(toPush.map(d => [d.id, d.updatedAt]));
        const res = await this.request('save', { docs: toPush });
        for (const id of res.saved || []) if (this.docs[id]) this.docs[id].syncBase = sent[id];
        this.persist();
        // De server had intussen een nieuwere versie: ophalen en samenvoegen.
        await this.pull(res.conflicts || []);
      }
      if (!this.tidied) { this.tidied = true; this.tidyConflicts(); }
      this.setStatus('ok');
    } catch (e) {
      this.setStatus('error', e.message);
    }
  }
}

export const store = new Store();
