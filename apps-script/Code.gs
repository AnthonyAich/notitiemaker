/**
 * Notitiemaker: opslag in Google Sheets, met gebruikers.
 *
 * Plak dit bestand in Extensies → Apps Script van je Google Sheet en deploy het
 * als web-app (zie README.md).
 *
 * Tabbladen (worden vanzelf aangemaakt):
 * - "Gebruikers": één rij per gebruiker. Een nieuw wachtwoord mag je hier gewoon
 *   intypen; het script vervangt het meteen door een versleutelde versie.
 * - "Documenten": één rij per document, met de eigenaar in de eerste kolom.
 *   Het document staat als JSON vanaf de kolom "data" (een cel mag max. 50.000 tekens).
 * - "Versies": hoogstens één kopie per uur per document, de laatste 30.
 * - "Overzicht": leesbare lijst van alle notitieblaadjes en hun regels.
 *
 * Voor zoeken in handschrift: zet in de Apps Script-editor links bij "Services"
 * de dienst "Drive API" aan.
 */

const API_VERSION = 3;
const USERS_NAME = 'Gebruikers';
const SHEET_NAME = 'Documenten';
const VERSIONS_NAME = 'Versies';
const OVERVIEW_NAME = 'Overzicht';
const CHUNK = 40000;
const SESSION_DAYS = 90;
const VERSION_EVERY_MS = 60 * 60 * 1000;
const VERSIONS_KEEP = 30;
const HASH_ROUNDS = 200;

const USER_HEADER = ['gebruikersnaam', 'naam', 'wachtwoord', 'rol', 'actief', 'aangemaakt'];
const DOC_HEADER = ['eigenaar', 'id', 'type', 'titel', 'favoriet', 'gewijzigd (ms)', 'verwijderd', 'gewijzigd op', 'data'];
const DOC_DATA = 8; // index (vanaf 0) van de eerste datakolom
const VERSION_HEADER = ['eigenaar', 'id', 'bewaard (ms)', 'bewaard op', 'titel', 'data'];
const VERSION_DATA = 5;

// Eenmalig uit te voeren vanuit de editor (optioneel): maakt de tabbladen aan.
function setup() {
  ensureSheets_();
  secret_();
}

function doGet() {
  ensureSheets_();
  return out({ ok: true, app: 'notitiemaker', api: API_VERSION, message: 'De API werkt.' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    ensureSheets_();
    if (req.action === 'ping') return out({ ok: true, api: API_VERSION });
    if (req.action === 'login') return out(login_(req.username, req.password));

    const user = auth_(req.token);
    const me = user.username;
    switch (req.action) {
      case 'me': return out({ ok: true, api: API_VERSION, user: publicUser_(user) });
      case 'list': return out({ ok: true, api: API_VERSION, docs: listDocs_(me) });
      case 'get': return out({ ok: true, docs: getDocs_(me, req.ids || []) });
      case 'save': return out({ ok: true, saved: saveDocs_(me, req.docs || []) });
      case 'versions': return out({ ok: true, versions: listVersions_(me, req.id) });
      case 'version': return out({ ok: true, doc: getVersion_(me, req.id, req.at) });
      case 'ocr': return out({ ok: true, texts: ocr_(req.images || []) });
      case 'changePassword': return out(changePassword_(user, req.oldPassword, req.newPassword));
      case 'users': requireAdmin_(user); return out({ ok: true, users: users_().map(publicUser_) });
      case 'saveUser': requireAdmin_(user); return out({ ok: true, user: saveUser_(user, req) });
      default: throw new Error('Onbekende actie: ' + req.action);
    }
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err), auth: !!(err && err.auth) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function authError_(msg) {
  const e = new Error(msg);
  e.auth = true;
  return e;
}

// ---------- tabbladen ----------

function sheetWith_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function ensureSheets_() {
  sheetWith_(USERS_NAME, USER_HEADER);
  // Tabbladen uit de versie zonder gebruikers krijgen vooraan een kolom "eigenaar".
  [[SHEET_NAME, DOC_HEADER], [VERSIONS_NAME, VERSION_HEADER]].forEach(([name, header]) => {
    const sh = sheetWith_(name, header);
    if (sh.getRange(1, 1).getDisplayValue() === 'id') {
      sh.insertColumnBefore(1);
      sh.getRange(1, 1).setValue('eigenaar').setFontWeight('bold');
    }
  });
}

function allRows_(sh, width) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, width || sh.getLastColumn()).getDisplayValues();
}

function writeRow_(sh, row, values) {
  if (sh.getMaxColumns() < values.length) sh.insertColumnsAfter(sh.getMaxColumns(), values.length - sh.getMaxColumns());
  // Platte tekst, zodat Sheets niets als formule of getal interpreteert.
  sh.getRange(row, 1, 1, values.length)
    .setNumberFormat('@')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
    .setValues([values]);
}

function chunks_(json) {
  const out = [];
  for (let i = 0; i < json.length; i += CHUNK) out.push(json.slice(i, i + CHUNK));
  return out;
}

// ---------- gebruikers en wachtwoorden ----------

function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SECRET', s);
  }
  return s;
}

function hex_(bytes) {
  return bytes.map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

function hash_(password, salt) {
  let h = salt + ':' + password;
  for (let i = 0; i < HASH_ROUNDS; i++) h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + password));
  return 'h$' + salt + '$' + h;
}

function checkPassword_(password, stored) {
  const parts = String(stored).split('$');
  return parts.length === 3 && hash_(String(password), parts[1]) === stored;
}

function newHash_(password) {
  return hash_(String(password), Utilities.getUuid().replace(/-/g, '').slice(0, 16));
}

// Alle gebruikers. Wachtwoorden die nog leesbaar in de Sheet staan, worden meteen versleuteld.
function users_() {
  const sh = sheetWith_(USERS_NAME, USER_HEADER);
  return allRows_(sh, USER_HEADER.length).map((r, i) => {
    const u = {
      row: i + 2,
      username: String(r[0]).trim().toLowerCase(),
      name: String(r[1]).trim(),
      hash: r[2],
      role: String(r[3]).trim().toLowerCase() === 'admin' ? 'admin' : 'user',
      active: !/^(nee|no|0|false|uit)$/i.test(String(r[4]).trim()),
    };
    if (u.username && u.hash && u.hash.indexOf('h$') !== 0) {
      u.hash = newHash_(u.hash);
      sh.getRange(u.row, 3).setNumberFormat('@').setValue(u.hash);
      if (!r[5]) sh.getRange(u.row, 6).setValue(new Date());
    }
    return u;
  }).filter(u => u.username);
}

function findUser_(username) {
  const name = String(username || '').trim().toLowerCase();
  return users_().filter(u => u.username === name)[0] || null;
}

// De eerste beheerder krijgt de documenten uit de tijd zonder gebruikers.
function firstAdmin_() {
  const a = users_().filter(u => u.role === 'admin' && u.active)[0];
  return a ? a.username : '';
}

function publicUser_(u) {
  return { username: u.username, name: u.name || u.username, role: u.role, active: u.active };
}

function requireAdmin_(user) {
  if (user.role !== 'admin') throw new Error('Alleen een beheerder kan dit doen.');
}

function makeToken_(user) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({
    u: user.username,
    e: Date.now() + SESSION_DAYS * 86400000,
    v: user.hash.slice(-10), // een nieuw wachtwoord maakt oude sessies ongeldig
  }));
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret_()));
  return payload + '.' + sig;
}

function auth_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw authError_('Log eerst in.');
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], secret_()));
  if (sig !== parts[1]) throw authError_('Je sessie is ongeldig. Log opnieuw in.');
  const p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  if (p.e < Date.now()) throw authError_('Je sessie is verlopen. Log opnieuw in.');
  const user = findUser_(p.u);
  if (!user || !user.active || user.hash.slice(-10) !== p.v) throw authError_('Je sessie is niet meer geldig. Log opnieuw in.');
  return user;
}

function login_(username, password) {
  const name = String(username || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const key = 'fail:' + name;
  const fails = Number(cache.get(key)) || 0;
  if (fails >= 5) throw new Error('Te veel mislukte pogingen. Probeer het over 10 minuten opnieuw.');
  const user = findUser_(name);
  if (!user || !user.active || !checkPassword_(password, user.hash)) {
    cache.put(key, String(fails + 1), 600);
    throw new Error('Gebruikersnaam of wachtwoord klopt niet.');
  }
  cache.remove(key);
  return { ok: true, api: API_VERSION, token: makeToken_(user), user: publicUser_(user) };
}

function validPassword_(pw) {
  if (String(pw || '').length < 6) throw new Error('Een wachtwoord moet minstens 6 tekens hebben.');
}

function changePassword_(user, oldPassword, newPassword) {
  if (!checkPassword_(oldPassword, user.hash)) throw new Error('Je huidige wachtwoord klopt niet.');
  validPassword_(newPassword);
  user.hash = newHash_(newPassword);
  sheetWith_(USERS_NAME, USER_HEADER).getRange(user.row, 3).setNumberFormat('@').setValue(user.hash);
  return { ok: true, token: makeToken_(user) };
}

// Nieuwe gebruiker (req.isNew) of een bestaande aanpassen: naam, wachtwoord, rol, actief.
function saveUser_(admin, req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheetWith_(USERS_NAME, USER_HEADER);
    const username = String(req.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,30}$/.test(username)) throw new Error('Een gebruikersnaam heeft 2 tot 30 tekens: kleine letters, cijfers, punt, - of _.');
    let user = findUser_(username);
    if (req.isNew) {
      if (user) throw new Error('Die gebruikersnaam bestaat al.');
      validPassword_(req.password);
      user = { row: Math.max(sh.getLastRow(), 1) + 1, username: username, name: '', role: 'user', active: true, hash: '' };
      sh.getRange(user.row, 6).setValue(new Date());
    }
    if (!user) throw new Error('Gebruiker niet gevonden.');
    if (req.name != null) user.name = String(req.name).trim();
    if (req.password) { validPassword_(req.password); user.hash = newHash_(req.password); }
    if (req.role != null) user.role = req.role === 'admin' ? 'admin' : 'user';
    if (req.active != null) user.active = !!req.active;

    // Er moet altijd minstens één actieve beheerder overblijven.
    const admins = users_().filter(u => u.username !== user.username && u.role === 'admin' && u.active);
    if (!admins.length && !(user.role === 'admin' && user.active)) throw new Error('Er moet minstens één actieve beheerder blijven.');

    sh.getRange(user.row, 1, 1, 5).setNumberFormat('@')
      .setValues([[user.username, user.name, user.hash, user.role, user.active ? 'ja' : 'nee']]);
    return publicUser_(user);
  } finally {
    lock.releaseLock();
  }
}

// ---------- documenten ----------

function ownerOf_(r, legacyOwner) {
  return r[0] || legacyOwner;
}

function listDocs_(me) {
  const legacy = firstAdmin_();
  return allRows_(sheetWith_(SHEET_NAME, DOC_HEADER), 7)
    .filter(r => r[1] && ownerOf_(r, legacy) === me)
    .map(r => ({ id: r[1], type: r[2], title: r[3], updatedAt: Number(r[5]) || 0, deleted: r[6] === '1' }));
}

function rowToDoc_(r) {
  if (r[6] === '1') return { id: r[1], deleted: true, updatedAt: Number(r[5]) || 0 };
  return JSON.parse(r.slice(DOC_DATA).join(''));
}

function getDocs_(me, ids) {
  const want = {};
  ids.forEach(id => { want[id] = true; });
  const legacy = firstAdmin_();
  return allRows_(sheetWith_(SHEET_NAME, DOC_HEADER))
    .filter(r => want[r[1]] && ownerOf_(r, legacy) === me)
    .map(rowToDoc_);
}

function saveDocs_(me, docs) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheetWith_(SHEET_NAME, DOC_HEADER);
    const legacy = firstAdmin_();
    const index = {};
    allRows_(sh, 6).forEach((r, i) => {
      if (r[1] && ownerOf_(r, legacy) === me) index[r[1]] = { row: i + 2, updatedAt: Number(r[5]) || 0 };
    });
    let nextRow = Math.max(sh.getLastRow(), 1) + 1;
    const tz = Session.getScriptTimeZone();
    const saved = [];

    docs.forEach(doc => {
      if (!doc || !doc.id) return;
      const existing = index[doc.id];
      // Het meest recent gewijzigde document wint.
      if (existing && existing.updatedAt > doc.updatedAt) return;
      const values = [
        me,
        doc.id,
        doc.type || '',
        doc.title || '',
        doc.favorite ? '1' : '',
        String(doc.updatedAt || Date.now()),
        doc.deleted ? '1' : '',
        Utilities.formatDate(new Date(doc.updatedAt || Date.now()), tz, 'yyyy-MM-dd HH:mm'),
      ].concat(chunks_(doc.deleted ? '' : JSON.stringify(doc)));
      const row = existing ? existing.row : nextRow++;
      if (existing) sh.getRange(row, 1, 1, sh.getLastColumn()).clearContent();
      writeRow_(sh, row, values);
      index[doc.id] = { row: row, updatedAt: doc.updatedAt };
      saved.push(doc.id);
    });

    if (saved.length) {
      try { saveVersions_(me, docs.filter(d => d && !d.deleted && saved.indexOf(d.id) >= 0)); } catch (e) { console.warn('Versie bewaren mislukt: ' + e); }
      try { rebuildOverview_(); } catch (e) { console.warn('Overzicht bijwerken mislukt: ' + e); }
    }
    return saved;
  } finally {
    lock.releaseLock();
  }
}

// Leesbare lijst van alle notitieblaadjes en tekstvakken, per gebruiker.
function rebuildOverview_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(OVERVIEW_NAME) || ss.insertSheet(OVERVIEW_NAME);
  const rows = [['Gebruiker', 'Document', 'Soort', 'Blaadje', 'Regel', 'Gemarkeerd']];
  const legacy = firstAdmin_();

  allRows_(sheetWith_(SHEET_NAME, DOC_HEADER)).forEach(r => {
    if (!r[1] || r[6] === '1') return;
    let doc;
    try { doc = rowToDoc_(r); } catch (e) { return; }
    if (doc.trashedAt) return;
    const who = ownerOf_(r, legacy);
    const kind = doc.type === 'notebook' ? 'Notebook' : 'Whiteboard';
    ((doc.content && doc.content.items) || []).forEach(it => {
      if (it.kind === 'sticky') {
        if (!(it.lines || []).length) rows.push([who, doc.title, kind, it.title || '', '', '']);
        (it.lines || []).forEach(l => {
          rows.push([who, doc.title, kind, it.title || '', '  '.repeat(l.indent || 0) + l.text, l.hl ? 'ja' : '']);
        });
      } else if (it.text) {
        rows.push([who, doc.title, kind, '(tekst)', it.text, '']);
      }
    });
    if (doc.ocr && doc.ocr.text) {
      doc.ocr.text.split('\n').filter(String).forEach(t => rows.push([who, doc.title, kind, '(handschrift)', t, '']));
    }
  });

  sh.clearContents();
  sh.getRange(1, 1, rows.length, 6).setNumberFormat('@').setValues(rows);
  sh.getRange(1, 1, 1, 6).setFontWeight('bold');
  sh.setFrozenRows(1);
}

// ---------- versies ----------

function saveVersions_(me, docs) {
  if (!docs.length) return;
  const sh = sheetWith_(VERSIONS_NAME, VERSION_HEADER);
  const tz = Session.getScriptTimeZone();
  const legacy = firstAdmin_();
  const now = Date.now();
  docs.forEach(doc => {
    // Per document opnieuw lezen: verwijderde rijen verschuiven de rijnummers.
    const mine = allRows_(sh, 3)
      .map((r, i) => ({ row: i + 2, at: Number(r[2]) || 0, id: r[1], owner: ownerOf_(r, legacy) }))
      .filter(r => r.id === doc.id && r.owner === me);
    const latest = mine.reduce((m, r) => Math.max(m, r.at), 0);
    if (now - latest < VERSION_EVERY_MS) return;
    const values = [me, doc.id, String(now), Utilities.formatDate(new Date(now), tz, 'yyyy-MM-dd HH:mm'), doc.title || '']
      .concat(chunks_(JSON.stringify(doc)));
    writeRow_(sh, sh.getLastRow() + 1, values);
    // Oudste versies van dit document opruimen (van onder naar boven, zodat rijnummers kloppen).
    mine.sort((a, b) => b.at - a.at).slice(VERSIONS_KEEP - 1)
      .sort((a, b) => b.row - a.row)
      .forEach(r => sh.deleteRow(r.row));
  });
}

function listVersions_(me, id) {
  const legacy = firstAdmin_();
  return allRows_(sheetWith_(VERSIONS_NAME, VERSION_HEADER), 3)
    .filter(r => r[1] === id && ownerOf_(r, legacy) === me)
    .map(r => ({ at: Number(r[2]) || 0 }))
    .sort((a, b) => b.at - a.at);
}

function getVersion_(me, id, at) {
  const legacy = firstAdmin_();
  const r = allRows_(sheetWith_(VERSIONS_NAME, VERSION_HEADER))
    .filter(r => r[1] === id && ownerOf_(r, legacy) === me && Number(r[2]) === Number(at))[0];
  if (!r) throw new Error('Versie niet gevonden.');
  return JSON.parse(r.slice(VERSION_DATA).join(''));
}

// ---------- handschrift herkennen ----------

// Zet elke afbeelding (base64 PNG) via Google Drive om naar tekst.
function ocr_(images) {
  if (typeof Drive === 'undefined') {
    throw new Error('Zet in Apps Script de dienst "Drive API" aan (Services → + → Drive API) en deploy opnieuw.');
  }
  return images.slice(0, 20).map((b64, i) => {
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', 'notitiemaker-ocr-' + i + '.png');
    let id;
    if (Drive.Files.create) {
      id = Drive.Files.create({ name: blob.getName(), mimeType: MimeType.GOOGLE_DOCS }, blob, { ocrLanguage: 'nl' }).id;
    } else {
      id = Drive.Files.insert({ title: blob.getName() }, blob, { ocr: true, ocrLanguage: 'nl' }).id;
    }
    try {
      return DocumentApp.openById(id).getBody().getText().trim();
    } finally {
      Drive.Files.remove(id);
    }
  });
}
