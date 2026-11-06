/**
 * Notitiemaker: opslag in Google Sheets.
 *
 * Plak dit bestand in Extensies → Apps Script van je Google Sheet,
 * verander TOKEN en deploy als web-app (zie README.md).
 *
 * Tabblad "Documenten": één rij per document. Het volledige document staat als
 * JSON in de kolommen vanaf "data" (opgesplitst, want een cel mag max. 50.000 tekens).
 * Tabblad "Overzicht": leesbare lijst van alle notitieblaadjes en hun regels.
 */

// Kies een lang, geheim wachtwoord en vul hetzelfde in de app in.
const TOKEN = 'VERANDER-MIJ';

const SHEET_NAME = 'Documenten';
const OVERVIEW_NAME = 'Overzicht';
const CHUNK = 40000;
const HEADER = ['id', 'type', 'titel', 'favoriet', 'gewijzigd (ms)', 'verwijderd', 'gewijzigd op', 'data'];
const DATA_COL = 8;

function doGet() {
  return out({ ok: true, app: 'notitiemaker', message: 'De API werkt. Plak deze URL in de app.' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (!TOKEN || TOKEN === 'VERANDER-MIJ') throw new Error('Kies eerst een eigen TOKEN bovenaan Code.gs en deploy opnieuw.');
    if (req.token !== TOKEN) throw new Error('Ongeldige token.');
    switch (req.action) {
      case 'ping': return out({ ok: true });
      case 'list': return out({ ok: true, docs: listDocs_() });
      case 'get': return out({ ok: true, docs: getDocs_(req.ids || []) });
      case 'save': return out({ ok: true, saved: saveDocs_(req.docs || []) });
      default: throw new Error('Onbekende actie: ' + req.action);
    }
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function allRows_(sh, width) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, width || sh.getLastColumn()).getDisplayValues();
}

function listDocs_() {
  return allRows_(sheet_(), 6).filter(r => r[0]).map(r => ({
    id: r[0],
    type: r[1],
    title: r[2],
    updatedAt: Number(r[4]) || 0,
    deleted: r[5] === '1',
  }));
}

function rowToDoc_(r) {
  if (r[5] === '1') return { id: r[0], deleted: true, updatedAt: Number(r[4]) || 0 };
  return JSON.parse(r.slice(DATA_COL - 1).join(''));
}

function getDocs_(ids) {
  const want = {};
  ids.forEach(id => { want[id] = true; });
  return allRows_(sheet_()).filter(r => want[r[0]]).map(rowToDoc_);
}

function saveDocs_(docs) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const index = {};
    allRows_(sh, 5).forEach((r, i) => { if (r[0]) index[r[0]] = { row: i + 2, updatedAt: Number(r[4]) || 0 }; });
    let nextRow = Math.max(sh.getLastRow(), 1) + 1;
    const tz = Session.getScriptTimeZone();
    const saved = [];

    docs.forEach(doc => {
      if (!doc || !doc.id) return;
      const existing = index[doc.id];
      // Het meest recent gewijzigde document wint.
      if (existing && existing.updatedAt > doc.updatedAt) return;

      const json = doc.deleted ? '' : JSON.stringify(doc);
      const chunks = [];
      for (let i = 0; i < json.length; i += CHUNK) chunks.push(json.slice(i, i + CHUNK));
      const values = [
        doc.id,
        doc.type || '',
        doc.title || '',
        doc.favorite ? '1' : '',
        String(doc.updatedAt || Date.now()),
        doc.deleted ? '1' : '',
        Utilities.formatDate(new Date(doc.updatedAt || Date.now()), tz, 'yyyy-MM-dd HH:mm'),
      ].concat(chunks);

      if (sh.getMaxColumns() < values.length) sh.insertColumnsAfter(sh.getMaxColumns(), values.length - sh.getMaxColumns());
      const row = existing ? existing.row : nextRow++;
      if (existing) sh.getRange(row, 1, 1, sh.getLastColumn()).clearContent();
      // Platte tekst, zodat Sheets niets als formule of getal interpreteert.
      sh.getRange(row, 1, 1, values.length)
        .setNumberFormat('@')
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
        .setValues([values]);
      index[doc.id] = { row: row, updatedAt: doc.updatedAt };
      saved.push(doc.id);
    });

    if (saved.length) {
      try { rebuildOverview_(); } catch (e) { console.warn('Overzicht bijwerken mislukt: ' + e); }
    }
    return saved;
  } finally {
    lock.releaseLock();
  }
}

// Leesbare lijst van alle notitieblaadjes en tekstvakken.
function rebuildOverview_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(OVERVIEW_NAME);
  if (!sh) sh = ss.insertSheet(OVERVIEW_NAME);
  const rows = [['Document', 'Soort', 'Blaadje', 'Regel', 'Gemarkeerd']];

  allRows_(sheet_()).forEach(r => {
    if (!r[0] || r[5] === '1') return;
    let doc;
    try { doc = rowToDoc_(r); } catch (e) { return; }
    const kind = doc.type === 'notebook' ? 'Notebook' : 'Whiteboard';
    ((doc.content && doc.content.items) || []).forEach(it => {
      if (it.kind === 'sticky') {
        if (!(it.lines || []).length) rows.push([doc.title, kind, it.title || '', '', '']);
        (it.lines || []).forEach(l => {
          rows.push([doc.title, kind, it.title || '', '  '.repeat(l.indent || 0) + l.text, l.hl ? 'ja' : '']);
        });
      } else if (it.text) {
        rows.push([doc.title, kind, '(tekst)', it.text, '']);
      }
    });
  });

  sh.clearContents();
  sh.getRange(1, 1, rows.length, 5).setNumberFormat('@').setValues(rows);
  sh.getRange(1, 1, 1, 5).setFontWeight('bold');
  sh.setFrozenRows(1);
}
