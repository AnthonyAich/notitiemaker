// Opslag: alles staat lokaal (localStorage) en wordt, als er een koppeling is,
// gesynchroniseerd met een Google Sheet via een Apps Script web-app.
// Conflicten: het meest recent gewijzigde document wint.

const DOCS_KEY = 'notitiemaker.docs.v1';
const CFG_KEY = 'notitiemaker.sync.v1';

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

class Store extends EventTarget {
  constructor() {
    super();
    this.docs = read(DOCS_KEY, {});
    this.config = { url: '', token: '', ...read(CFG_KEY, {}) };
    this.status = { state: this.config.url ? 'idle' : 'off', message: '', at: 0 };
    this.timer = null;
    this.running = null;
    this.again = false;
    // Versie van het Apps Script (1 = zonder versies en handschriftherkenning).
    this.api = 0;
    // Een ander tabblad met de app schreef naar localStorage: neem nieuwere documenten over.
    addEventListener('storage', e => {
      if (e.key !== DOCS_KEY || !e.newValue) return;
      let other;
      try { other = JSON.parse(e.newValue); } catch { return; }
      const ids = Object.keys(other).filter(id => other[id].updatedAt > (this.docs[id]?.updatedAt || 0));
      ids.forEach(id => { this.docs[id] = other[id]; });
      if (ids.length) this.emit('change', { ids, source: 'remote' });
    });
  }

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
      if (!d?.id || !d.content || !d.type) continue;
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
    if (!write(DOCS_KEY, this.docs)) this.setStatus('error', 'De lokale opslag van je browser is vol.');
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setStatus(state, message = '') {
    this.status = { state, message, at: Date.now() };
    this.emit('status', this.status);
  }

  setConfig({ url, token }) {
    this.config = { url, token };
    this.api = 0;
    write(CFG_KEY, this.config);
    if (!url) return this.setStatus('off');
    this.sync();
  }

  schedule(delay = 1500) {
    if (!this.config.url) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), delay);
  }

  async request(action, payload = {}, cfg = this.config) {
    let res;
    try {
      // text/plain voorkomt een CORS-preflight, die Apps Script niet ondersteunt.
      res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: cfg.token, ...payload }),
      });
    } catch {
      throw new Error(navigator.onLine === false
        ? 'Je bent offline. Wijzigingen worden later gesynchroniseerd.'
        : 'Kan de web-app niet bereiken. Klopt de URL en staat de toegang op "Iedereen"?');
    }
    if (!res.ok) throw new Error(`De server antwoordde met fout ${res.status}.`);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Onverwacht antwoord. Gebruik de URL die eindigt op /exec.');
    }
    if (!data.ok) throw new Error(data.error || 'Onbekende fout');
    return data;
  }

  test(url, token) {
    return this.request('ping', {}, { url, token });
  }

  sync() {
    if (!this.config.url) return Promise.resolve();
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
