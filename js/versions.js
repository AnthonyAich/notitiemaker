// Versiegeschiedenis op dit toestel (IndexedDB).
// Er wordt hoogstens om de zoveel minuten een kopie bewaard, maximaal 30 per document.

const DB_NAME = 'notitiemaker';
const STORE = 'versions';
const KEEP = 30;

let dbPromise = null;
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const st = req.result.createObjectStore(STORE, { keyPath: 'key' });
      st.createIndex('doc', 'docId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeFor(mode) {
  return (await db()).transaction(STORE, mode).objectStore(STORE);
}

// Alle versies van een document, nieuwste eerst (zonder de inhoud).
export async function listVersions(docId) {
  try {
    const all = await done((await storeFor('readonly')).index('doc').getAll(docId));
    return all.map(v => ({ key: v.key, at: v.at, title: v.title, size: v.size })).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export async function getVersion(key) {
  const v = await done((await storeFor('readonly')).get(key));
  return v && JSON.parse(v.data);
}

// Bewaart een kopie als de laatste ouder is dan `minAgeMin` minuten.
export async function snapshot(doc, minAgeMin = 20) {
  try {
    const list = await listVersions(doc.id);
    const data = JSON.stringify(doc);
    if (list[0] && Date.now() - list[0].at < minAgeMin * 60000) return;
    const st = await storeFor('readwrite');
    const at = Date.now();
    const items = (doc.content.items || []).length + (doc.content.strokes || []).length;
    st.put({ key: `${doc.id}:${at}`, docId: doc.id, at, title: doc.title, size: items, data });
    list.slice(KEEP - 1).forEach(v => st.delete(v.key));
  } catch (e) {
    console.warn('Versie bewaren mislukt', e);
  }
}
