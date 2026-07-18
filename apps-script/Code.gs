/**
 * 농산물 판매장부 — 구글시트 연동 스크립트
 *
 * 사용법: 구글시트에서 [확장 프로그램 > Apps Script]를 열고
 * 이 파일 내용을 통째로 붙여넣은 뒤 '웹 앱'으로 배포하세요.
 * (자세한 순서는 프로젝트 README.md 참고)
 */
const SPREADSHEET_ID = '1XjLPMHd9E1rNTOo_daVuQ2fTJ0uoJvOtUgb7Y2DxM5U';
const RECORD_SHEET = '판매기록';
const CONFIG_SHEET = '설정';
const HEADER_ROWS = 1;
const LOCK_WAIT_MS = 10000;
const STORE_COL = 0; // 설정 시트 A열 = 판매처
const ITEM_COL = 1;  // 설정 시트 B열 = 품목

function doGet() {
  return jsonOut(loadAll());
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    (body.ops || []).forEach(applyOp);
    return jsonOut(loadAll());
  } finally {
    lock.releaseLock();
  }
}

function jsonOut(obj) {
  obj.ok = true;
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
}

function loadAll() {
  const rows = sheet(RECORD_SHEET).getDataRange().getValues().slice(HEADER_ROWS);
  const entries = rows.filter((r) => r[0]).map(rowToEntry);
  const cfg = sheet(CONFIG_SHEET).getDataRange().getValues().slice(HEADER_ROWS);
  const stores = cfg.map((r) => String(r[STORE_COL] || '').trim()).filter(Boolean);
  const items = cfg.map((r) => String(r[ITEM_COL] || '').trim()).filter(Boolean);
  return { entries: entries, stores: stores, items: items };
}

function rowToEntry(r) {
  return {
    id: String(r[0]),
    date: toDateStr(r[1]),
    store: String(r[2]),
    item: String(r[3]),
    left: cellNum(r[4]),
    added: cellNum(r[5]),
    sold: cellNum(r[6]),
    taken: cellNum(r[7]),
    ts: r[8] instanceof Date ? r[8].getTime() : 0,
  };
}

function cellNum(v) {
  return v === '' || v === null || v === undefined ? null : Number(v);
}

function toDateStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  return String(v);
}

function applyOp(op) {
  const p = op.payload || {};
  if (op.op === 'upsertEntry') upsertEntry(p);
  else if (op.op === 'deleteEntry') deleteEntry(p.id);
  else if (op.op === 'addStore') addToList(STORE_COL, p.name);
  else if (op.op === 'removeStore') removeFromList(STORE_COL, p.name);
  else if (op.op === 'addItem') addToList(ITEM_COL, p.name);
  else if (op.op === 'removeItem') removeFromList(ITEM_COL, p.name);
}

function upsertEntry(p) {
  const s = sheet(RECORD_SHEET);
  const values = [p.id, p.date, p.store, p.item,
    blankOrNum(p.left), blankOrNum(p.added), blankOrNum(p.sold), blankOrNum(p.taken), new Date()];
  const row = findRowById(s, p.id);
  if (row > 0) s.getRange(row, 1, 1, values.length).setValues([values]);
  else s.appendRow(values);
}

function deleteEntry(id) {
  const s = sheet(RECORD_SHEET);
  const row = findRowById(s, id);
  if (row > 0) s.deleteRow(row);
}

function blankOrNum(v) {
  return v === null || v === undefined || v === '' ? '' : Number(v);
}

function findRowById(s, id) {
  const ids = s.getRange(1, 1, s.getLastRow(), 1).getValues();
  for (let i = HEADER_ROWS; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function addToList(col, name) {
  if (!name) return;
  const list = readList(col);
  if (list.indexOf(name) >= 0) return;
  list.push(name);
  writeList(col, list);
}

function removeFromList(col, name) {
  writeList(col, readList(col).filter((n) => n !== name));
}

function readList(col) {
  const s = sheet(CONFIG_SHEET);
  const rows = Math.max(s.getLastRow() - HEADER_ROWS, 0);
  if (rows === 0) return [];
  return s.getRange(HEADER_ROWS + 1, col + 1, rows, 1).getValues()
    .map((r) => String(r[0] || '').trim())
    .filter(Boolean);
}

function writeList(col, list) {
  const s = sheet(CONFIG_SHEET);
  const rows = Math.max(s.getLastRow() - HEADER_ROWS, 0);
  if (rows > 0) s.getRange(HEADER_ROWS + 1, col + 1, rows, 1).clearContent();
  if (list.length) {
    s.getRange(HEADER_ROWS + 1, col + 1, list.length, 1)
      .setValues(list.map((n) => [n]));
  }
}
