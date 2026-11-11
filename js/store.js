// Opslag: de documenten van de ingelogde gebruiker staan lokaal (localStorage)
// en worden gesynchroniseerd met de Google Sheet via de Apps Script web-app.
//
// Conflicten: elk document onthoudt in `syncBase` op welke serverversie (updatedAt) het
// verder bouwt. Is de server intussen veranderd terwijl je hier ook iets aanpaste, dan
// wordt niets overschreven: jouw versie blijft als aparte kopie "(conflict …)" bestaan.
import { API_URL } from './config.js';
import { uid } from './model.js';

const SESSION_KEY = 'notitiemaker.session.v1';
// Per gebruiker, op de vaste id (oudere sessies hebben enkel een gebruikersnaam).
const docsKey = session => `notitiemaker.docs.v2.${session.id || session.username}`;
// Uit de versie zonder gebruikers: worden bij de eerste login overgenomen.
const LEGACY_DOCS_KEY = 'notitiemaker.docs.v1';
const LEGACY_CFG_KEY = 'notitiemaker.sync.v1';

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

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'ander toestel';
}

// Heeft dit toestel wijzigingen die nog niet op de server staan?
function isDirty(local) {
  return local.syncBase != null && local.updatedAt !== local.syncBase;
}

function forget(key) {
  try { localStorage.removeItem(key); } catch { /* niet erg */ }
}

class Store extends EventTarget {
  constructor() {
    super();
    this.url = API_URL;
    this.session = read(SESSION_KEY, null);
    this.docs = this.session ? read(docsKey(this.session), {}) : {};
    this.status = { state: this.session ? 'idle' : 'off', message: '', at: 0 };
    this.timer = null;
    this.running = null;
    this.again = false;
    // Versie van het Apps Script op de server.
    this.api = 0;
    // Een ander tabblad met de app schreef naar localStorage: neem nieuwere documenten over.
    addEventListener('storage', e => {
      if (!this.session || e.key !== docsKey(this.session) || !e.newValue) return;
      let other;
      try { other = JSON.parse(e.newValue); } catch { return; }
      const ids = Object.keys(other).filter(id => other[id].updatedAt > (this.docs[id]?.updatedAt || 0));
      ids.forEach(id => { this.docs[id] = other[id]; });
      if (ids.length) this.emit('change', { ids, source: 'remote' });
    });
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
    doc.updatedAt = Date.now();
    this.docs[doc.id] = doc;
    this.persist();
    this.emit('change', { ids: [doc.id], source: 'local' });
    this.schedule();
  }

  remove(id) {
    // Een "grafsteen" zodat andere toestellen het document ook verwijderen.
    this.docs[id] = { id, deleted: true, updatedAt: Date.now(), syncBase: this.docs[id]?.syncBase };
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
      this.docs[d.id] = d;
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
    this.docs = read(docsKey(this.session), {});
    // Kopie van vóór de vaste id's (opgeslagen onder de gebruikersnaam) overnemen.
    const byName = `notitiemaker.docs.v2.${this.session.username}`;
    const old = this.session.id ? read(byName, null) : null;
    if (old) {
      for (const d of Object.values(old)) if (!this.docs[d.id] || d.updatedAt > this.docs[d.id].updatedAt) this.docs[d.id] = d;
      this.persist();
      forget(byName);
    }
    // Notities van vóór de accounts op dit toestel horen bij wie hier als eerste inlogt.
    const legacy = read(LEGACY_DOCS_KEY, null);
    if (legacy) {
      for (const d of Object.values(legacy)) {
        // De echte wijzigingsdatum blijft staan: een nieuwere versie op de server wint.
        if (d.deleted || this.docs[d.id]) continue;
        this.docs[d.id] = d;
      }
      this.persist();
      forget(LEGACY_DOCS_KEY);
      forget(LEGACY_CFG_KEY);
    }
    this.setStatus('idle');
    this.emit('session');
    await this.sync();
  }

  // Afmelden. De lokale kopie wordt gewist, behalve als niet alles gesynchroniseerd is.
  logout({ keepLocal = false } = {}) {
    if (this.session && !keepLocal) forget(docsKey(this.session));
    this.session = null;
    this.docs = {};
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

  // Bewaart de lokale versie als apart document en geeft de nieuwe id terug.
  conflictCopy(local) {
    const when = new Date().toLocaleString('nl-BE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
    const copy = JSON.parse(JSON.stringify(local));
    copy.id = uid();
    copy.title = `${local.title} (conflict, ${deviceName()} ${when})`;
    copy.favorite = false;
    copy.createdAt = copy.updatedAt = Date.now();
    delete copy.syncBase;
    delete copy.ocr;
    this.docs[copy.id] = copy;
    return copy.id;
  }

  // Haalt de serverversie op; lokale wijzigingen die nog niet op de server staan, worden eerst een kopie.
  async pull(ids, conflictIds = new Set()) {
    if (!ids.length) return;
    const { docs } = await this.request('get', { ids });
    const changed = [], conflicts = [];
    for (const d of docs) {
      const local = this.docs[d.id];
      if (local && !local.deleted && conflictIds.has(d.id)) {
        const copyId = this.conflictCopy(local);
        conflicts.push({ id: d.id, copyId, title: local.title });
        changed.push(copyId);
      }
      d.syncBase = d.updatedAt;
      this.docs[d.id] = d;
      changed.push(d.id);
    }
    this.persist();
    this.emit('change', { ids: changed, source: 'remote' });
    if (conflicts.length) this.emit('conflict', { conflicts });
  }

  async run() {
    clearTimeout(this.timer);
    this.setStatus('syncing');
    try {
      const { docs: remote, api } = await this.request('list');
      this.api = api || 1;
      const remoteById = Object.fromEntries(remote.map(r => [r.id, r]));

      // Documenten die al gelijk zijn met de server krijgen hun basisversie.
      for (const r of remote) {
        const l = this.docs[r.id];
        if (l && l.syncBase == null && l.updatedAt === r.updatedAt) l.syncBase = r.updatedAt;
      }

      // Beschadigde rijen in de Sheet: herstellen met de kopie van dit toestel, of melden.
      const repair = new Set(), lost = [];
      for (const r of remote.filter(x => x.broken)) {
        const l = this.docs[r.id];
        if (l && !l.deleted) repair.add(r.id);
        else lost.push(r.title || r.id);
      }
      if (lost.length) this.emit('broken', { titles: lost });

      const toFetch = [], conflicts = new Set();
      for (const r of remote) {
        if (r.broken) continue;
        const l = this.docs[r.id];
        const serverChanged = !l || (l.syncBase != null ? r.updatedAt !== l.syncBase : r.updatedAt > l.updatedAt);
        if (!serverChanged) continue;
        toFetch.push(r.id);
        if (l && isDirty(l)) conflicts.add(r.id);
      }
      await this.pull(toFetch, conflicts);

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
        // De server weigerde een oude kopie: de serverversie ophalen, de onze apart bewaren.
        const refused = res.conflicts || [];
        await this.pull(refused, new Set(refused));
      }
      this.setStatus('ok');
    } catch (e) {
      this.setStatus('error', e.message);
    }
  }
}

export const store = new Store();
