// Opslag: de documenten van de ingelogde gebruiker staan lokaal (localStorage)
// en worden gesynchroniseerd met de Google Sheet via de Apps Script web-app.
// Conflicten: het meest recent gewijzigde document wint.
import { API_URL } from './config.js';

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
    this.docs[id] = { id, deleted: true, updatedAt: Date.now() };
    this.persist();
    this.emit('change', { ids: [id], source: 'local' });
    this.schedule();
  }

  importDocs(list) {
    const ids = [];
    for (const d of list) {
      if (!d?.id || !d.content || !d.type || d.deleted) continue;
      d.updatedAt = Date.now();
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
        if (d.deleted || this.docs[d.id]) continue;
        d.updatedAt = Date.now();
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

  async run() {
    clearTimeout(this.timer);
    this.setStatus('syncing');
    try {
      const { docs: remote, api } = await this.request('list');
      this.api = api || 1;
      const remoteById = Object.fromEntries(remote.map(r => [r.id, r]));

      const toFetch = remote
        .filter(r => r.updatedAt > (this.docs[r.id]?.updatedAt || 0))
        .map(r => r.id);
      const toPush = Object.values(this.docs)
        .filter(l => l.updatedAt > (remoteById[l.id]?.updatedAt || 0));

      if (toFetch.length) {
        const { docs } = await this.request('get', { ids: toFetch });
        const changed = [];
        for (const d of docs) {
          // Niet overschrijven als er intussen lokaal iets nieuwers is.
          if (d.updatedAt > (this.docs[d.id]?.updatedAt || 0)) {
            this.docs[d.id] = d;
            changed.push(d.id);
          }
        }
        if (changed.length) {
          this.persist();
          this.emit('change', { ids: changed, source: 'remote' });
        }
      }

      if (toPush.length) await this.request('save', { docs: toPush });
      this.setStatus('ok');
    } catch (e) {
      this.setStatus('error', e.message);
    }
  }
}

export const store = new Store();
