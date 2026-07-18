'use strict';

/* ===== 상수 ===== */
const STORAGE_KEY = 'agri-ledger-v2';
const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzGHa9Qgar_DxeiUPcTvqwxOMBvEx0wD20FmakVzLh82CQ4rgEsa2Om0_A1Ljb6dsTGBg/exec';
const SYNC_DEBOUNCE_MS = 1500;
const CONFIRM_RESET_MS = 3000;
const TOAST_MS = 2000;
const HOME_STORE = '집';   // 집(창고) 잔량은 이 이름의 판매처로 저장
const SEP = '|';           // 기록 키 구분자: 날짜|판매처|품목

/* ===== 상태 ===== */
let state = loadState();
let viewDate = today();
let currentTab = 'ledger';
let editing = null;      // { store, item } — 열려 있는 칸 편집기
let addingKind = null;   // 'store' | 'item' — 추가 입력창이 열려 있는 목록
let confirmKey = null;
let confirmTimer = null;
let syncTimer = null;
let syncing = false;
let toastTimer = null;
let statsMonth = today().slice(0, 7); // 통계 탭에서 보는 달 (YYYY-MM)

function loadState() {
  const base = { stores: [], items: [], entries: {}, pending: [], scriptUrl: DEFAULT_SCRIPT_URL, viewMode: 'grid' };
  try {
    const merged = Object.assign(base, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {});
    if (!merged.scriptUrl) merged.scriptUrl = DEFAULT_SCRIPT_URL;
    return merged;
  } catch (e) {
    return base;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ===== 도우미 ===== */
function today() {
  return dateStr(new Date());
}

function dateStr(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function esc(s) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s).replace(/[&<>"']/g, (c) => map[c]);
}

function num(v) {
  return Number(v) || 0;
}

function fmtQty(n) {
  return Number(n).toLocaleString('ko-KR');
}

function fmtDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${m}월 ${day}일 (${dayNames[new Date(y, m - 1, day).getDay()]})`;
}

function fmtDateHtml(d) {
  const [y, m, day] = d.split('-').map(Number);
  const idx = new Date(y, m - 1, day).getDay();
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  const cls = idx === 0 ? ' class="wd-sun"' : idx === 6 ? ' class="wd-sat"' : '';
  return `${m}월 ${day}일 (<span${cls}>${names[idx]}</span>)`;
}

function entryKey(date, store, item) {
  return date + SEP + store + SEP + item;
}

function getEntry(date, store, item) {
  return state.entries[entryKey(date, store, item)] || null;
}

/* ===== 화면 전환 ===== */
const TABS = { ledger: renderLedger, history: renderHistory, stats: renderStats, manage: renderManage };

function switchTab(tab) {
  currentTab = tab;
  editing = null;
  addingKind = null;
  confirmKey = null;
  render();
}

function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === currentTab);
  });
  document.getElementById('screen').innerHTML = TABS[currentTab]();
  updateSyncBadge();
}

/* ===== 장부 화면 ===== */
function renderLedger() {
  const ready = state.stores.length && state.items.length;
  const gridMode = state.viewMode !== 'cards';
  const body = !ready ? setupHint() : gridMode ? gridView() : storeCards();
  return `<section>
    ${dateNav()}
    ${ready ? viewToggle(gridMode) : ''}
    ${body}
    ${ready ? homeSection() : ''}
    ${ready ? totalsSection() : ''}
  </section>`;
}

function viewToggle(gridMode) {
  return `<div class="view-toggle">
    <button class="${gridMode ? 'on' : ''}" data-action="view-mode" data-mode="grid">한눈에 보기</button>
    <button class="${gridMode ? '' : 'on'}" data-action="view-mode" data-mode="cards">자세히 보기</button>
  </div>`;
}

function gridView() {
  const head = `<tr><th class="store-col">가게</th>${state.items.map((i) => `<th>${esc(i)}</th>`).join('')}</tr>`;
  const rows = state.stores.map((store) => {
    const cells = state.items.map((item) => `<td>${gridCell(store, item)}</td>`).join('');
    return `<tr><th class="store-col">${esc(store)}</th>${cells}</tr>`;
  }).join('');
  const editor = editing && editing.store !== HOME_STORE ? editorBox() : '';
  return `<p class="legend">숫자는 <b>지금 남은 개수</b>예요 · 칸을 누르면 적을 수 있어요</p>
    <div class="table-wrap"><table class="ledger"><tbody>${head}${rows}</tbody></table></div>
    <div id="grid-editor">${editor}</div>`;
}

function gridCell(store, item) {
  const e = getEntry(viewDate, store, item);
  const on = editing && editing.store === store && editing.item === item;
  if (!e) {
    return `<button class="cell empty ${on ? 'on' : ''}" data-action="edit-cell"
      data-store="${esc(store)}" data-item="${esc(item)}"><span>＋</span></button>`;
  }
  const sold = e.sold != null ? `<em>팔림 ${fmtQty(e.sold)}</em>` : '';
  return `<button class="cell ${on ? 'on' : ''}" data-action="edit-cell"
    data-store="${esc(store)}" data-item="${esc(item)}">
    <span class="cell-num">${fmtQty(remainOf(e))}</span>${sold}</button>`;
}

function setupHint() {
  return `<p class="hint big">먼저 아래 '관리'에서<br>가게와 작물을 추가해 주세요.</p>`;
}

function dateNav() {
  const isToday = viewDate === today();
  const back = isToday ? '' : `<button class="today-btn" data-action="date-today">오늘로 돌아가기</button>`;
  return `<div class="date-nav">
    <button data-action="date-prev" aria-label="전날 보기">◀</button>
    <div class="date-now">${fmtDateHtml(viewDate)}${isToday ? ' · 오늘' : ''}</div>
    <button data-action="date-next" ${isToday ? 'disabled' : ''} aria-label="다음날 보기">▶</button>
  </div>${back}`;
}

function storeCards() {
  return state.stores.map(storeCard).join('');
}

function storeCard(store) {
  const rows = state.items.map((item) => itemRow(store, item)).join('');
  return `<article class="store-card"><h2>${esc(store)}</h2>${rows}</article>`;
}

function itemRow(store, item) {
  const e = getEntry(viewDate, store, item);
  const on = editing && editing.store === store && editing.item === item;
  const body = e ? rowStats(e) : `<span class="row-empty">＋ 적기</span>`;
  return `<div class="item-block">
    <button class="item-row ${on ? 'on' : ''}" data-action="edit-cell"
      data-store="${esc(store)}" data-item="${esc(item)}">
      <span class="item-name">${esc(item)}</span>${body}
    </button>${on ? editorBox() : ''}</div>`;
}

function rowStats(e) {
  const chips = [
    statChip('있던', e.left, 'left'),
    statChip('놓음', e.added, 'added'),
    statChip('팔림', e.sold, 'sold'),
    statChip('회수', e.taken, 'taken'),
  ].filter(Boolean).join('');
  return `<span class="row-chips">${chips}</span>
    <span class="row-now">${fmtQty(remainOf(e))}<small>남음</small></span>`;
}

function statChip(label, v, cls) {
  if (v == null) return '';
  return `<span class="chip-${cls}">${label} ${fmtQty(v)}</span>`;
}

function remainOf(e) {
  return num(e.left) + num(e.added) - num(e.sold) - num(e.taken);
}

/* ===== 칸 편집기 ===== */
function editorBox() {
  const { store, item } = editing;
  const isHome = store === HOME_STORE;
  const e = getEntry(viewDate, store, item) || {};
  const fields = isHome
    ? numField('left', '집에 남은 것', e.left)
    : numField('left', '남아 있던 것', e.left) + numField('added', '새로 갖다 놓음', e.added)
      + numField('sold', '팔림', e.sold) + numField('taken', '도로 가져옴 (회수)', e.taken);
  const calc = isHome ? ''
    : `<p class="calc-line" id="calc-line">계산하면 지금 <b>${fmtQty(remainOf(e))}개</b> 남아 있어요</p>`;
  return `<div class="cell-editor">
    <h3>${isHome ? esc(item) + ' · 집에 남은 것(잔)' : esc(store) + ' · ' + esc(item)}</h3>
    ${isHome ? '' : outlookHint(store, item)}
    <div class="editor-fields">${fields}</div>
    ${calc}
    <div class="btn-row">
      <button data-action="save-cell">저장</button>
      <button class="ghost-btn" data-action="close-editor">닫기</button>
    </div>
  </div>`;
}

function numField(id, label, val) {
  return `<label class="num-field"><span>${label}</span>
    <input type="number" inputmode="numeric" id="edit-${id}" value="${val != null ? val : ''}" placeholder="·"></label>`;
}

function outlookHint(store, item) {
  const o = prevOutlook(viewDate, store, item);
  if (!o) return '';
  return `<p class="hint">지난 기록(${fmtDate(o.date)})으로 계산하면 <b>${fmtQty(o.expected)}개</b> 남아 있을 거예요.</p>`;
}

function prevOutlook(date, store, item) {
  let best = null;
  for (const key in state.entries) {
    const [d, s, it] = key.split(SEP);
    if (s !== store || it !== item || d >= date) continue;
    if (!best || d > best.date) best = { date: d, e: state.entries[key] };
  }
  if (!best) return null;
  return { date: best.date, expected: remainOf(best.e) };
}

function openEditor(store, item) {
  const same = editing && editing.store === store && editing.item === item;
  editing = same ? null : { store, item };
  render();
  const input = document.getElementById('edit-left');
  if (input) {
    input.focus();
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function saveCell() {
  const { store, item } = editing;
  const isHome = store === HOME_STORE;
  const left = readNum('edit-left');
  const added = isHome ? null : readNum('edit-added');
  const sold = isHome ? null : readNum('edit-sold');
  const taken = isHome ? null : readNum('edit-taken');
  const key = entryKey(viewDate, store, item);
  if (left == null && added == null && sold == null && taken == null) {
    if (state.entries[key]) {
      delete state.entries[key];
      queueOp('deleteEntry', { id: key });
    }
  } else {
    state.entries[key] = { left, added, sold, taken, ts: Date.now() };
    queueOp('upsertEntry', { id: key, date: viewDate, store, item, left, added, sold, taken });
  }
  editing = null;
  render();
  toast('적었어요 ✓');
}

function readNum(id) {
  const el = document.getElementById(id);
  const v = el ? el.value.trim() : '';
  return v === '' ? null : Number(v);
}

/* ===== 집 잔량 · 합계 ===== */
function homeSection() {
  const cells = state.items.map((item) => {
    const e = getEntry(viewDate, HOME_STORE, item);
    const on = editing && editing.store === HOME_STORE && editing.item === item;
    return `<button class="home-cell ${on ? 'on' : ''}" data-action="edit-cell"
      data-store="${esc(HOME_STORE)}" data-item="${esc(item)}">
      ${esc(item)} <strong>${e && e.left != null ? fmtQty(e.left) : '·'}</strong></button>`;
  }).join('');
  const editor = editing && editing.store === HOME_STORE ? editorBox() : '';
  return `<h2 class="sec-head">집에 남은 것 (잔)</h2><div class="home-row">${cells}</div>${editor}`;
}

function totalsSection() {
  const title = viewDate === today() ? '오늘 합계' : '이날 합계';
  const rows = state.items.map((item) => {
    const t = itemTotals(item);
    const home = t.home != null ? ` · 집 <strong>${fmtQty(t.home)}</strong>` : '';
    const takenPart = t.taken ? ` · 회수 <strong>${fmtQty(t.taken)}</strong>` : '';
    return `<div class="total-row"><b>${esc(item)}</b>
      갖다놓음 <strong>${fmtQty(t.added)}</strong> · 팔림 <strong class="sold">${fmtQty(t.sold)}</strong>${takenPart}
      · 밖에 <strong>${fmtQty(t.out)}</strong>${home}</div>`;
  }).join('');
  return `<h2 class="sec-head">${title}</h2>${rows}`;
}

function itemTotals(item) {
  let added = 0;
  let sold = 0;
  let taken = 0;
  let out = 0;
  for (const store of state.stores) {
    const e = getEntry(viewDate, store, item);
    if (!e) continue;
    added += num(e.added);
    sold += num(e.sold);
    taken += num(e.taken);
    out += remainOf(e);
  }
  const homeEntry = getEntry(viewDate, HOME_STORE, item);
  return { added, sold, taken, out, home: homeEntry ? homeEntry.left : null };
}

/* ===== 지난기록 화면 ===== */
function renderHistory() {
  const dates = [...new Set(Object.keys(state.entries).map((k) => k.split(SEP)[0]))].sort().reverse();
  if (!dates.length) {
    return `<section><p class="hint big">아직 기록이 없어요.<br>'오늘장부'에서 시작해 보세요.</p></section>`;
  }
  const rows = dates.map((d) => `<button class="day-row" data-action="open-date" data-date="${d}">
    <span class="day-date">${fmtDate(d)}</span>
    <span class="day-sum">${dateSummary(d)}</span></button>`).join('');
  return `<section><p class="hint">날짜를 누르면 그날 장부가 열려요.</p>${rows}</section>`;
}

function dateSummary(date) {
  const per = {};
  for (const key in state.entries) {
    const [d, store, item] = key.split(SEP);
    if (d !== date || store === HOME_STORE) continue;
    const e = state.entries[key];
    const t = per[item] = per[item] || { added: 0, sold: 0 };
    t.added += num(e.added);
    t.sold += num(e.sold);
  }
  const parts = Object.keys(per).map((i) => `${esc(i)} 갖다놓음 ${fmtQty(per[i].added)} · 팔림 ${fmtQty(per[i].sold)}`);
  return parts.join('&nbsp;&nbsp; ') || '기록 있음';
}

/* ===== 통계 화면 ===== */
function renderStats() {
  const { byStoreItem, byItem, stores } = monthStats(statsMonth);
  const items = statsItems(byItem);
  const [y, m] = statsMonth.split('-').map(Number);
  const nav = `<div class="date-nav">
    <button data-action="month-prev" aria-label="지난달 보기">◀</button>
    <div class="date-now">${y}년 ${m}월</div>
    <button data-action="month-next" ${statsMonth === thisMonth() ? 'disabled' : ''} aria-label="다음달 보기">▶</button>
  </div>`;
  if (!items.length) return `<section>${nav}<p class="hint big">이 달에는 기록이 없어요.</p></section>`;
  const summary = items.map((it) => `<div class="total-row"><b>${esc(it)}</b>
    팔림 <strong class="sold">${fmtQty(byItem[it].sold)}</strong> · 갖다놓음 <strong>${fmtQty(byItem[it].added)}</strong></div>`).join('');
  return `<section>${nav}
    <h2 class="sec-head">이 달 작물별 합계</h2>${summary}
    <h2 class="sec-head">가게별 팔림</h2>${statsTable(stores, items, byStoreItem)}
    <h2 class="sec-head">날짜별 팔림</h2>${dailyRows(statsMonth)}
    <p class="hint">원본 데이터와 더 깊은 분석은 구글시트에서 볼 수 있어요.</p>
  </section>`;
}

function dailyRows(month) {
  const byDate = {};
  for (const key in state.entries) {
    const [d, store, item] = key.split(SEP);
    if (!d.startsWith(month) || store === HOME_STORE) continue;
    const sold = num(state.entries[key].sold);
    if (!sold) continue;
    byDate[d] = byDate[d] || {};
    byDate[d][item] = (byDate[d][item] || 0) + sold;
  }
  const dates = Object.keys(byDate).sort().reverse();
  if (!dates.length) return `<p class="hint">이 달에는 아직 팔린 기록이 없어요.</p>`;
  return dates.map((d) => {
    const parts = Object.keys(byDate[d]).map((i) => `${esc(i)} <strong class="sold">${fmtQty(byDate[d][i])}</strong>`);
    return `<div class="total-row"><b>${fmtDate(d)}</b>${parts.join(' · ')}</div>`;
  }).join('');
}

function monthStats(month) {
  const byStoreItem = {};
  const byItem = {};
  const stores = new Set();
  for (const key in state.entries) {
    const [d, store, item] = key.split(SEP);
    if (!d.startsWith(month) || store === HOME_STORE) continue;
    const sold = num(state.entries[key].sold);
    const added = num(state.entries[key].added);
    if (!sold && !added) continue;
    stores.add(store);
    byItem[item] = byItem[item] || { sold: 0, added: 0 };
    byItem[item].sold += sold;
    byItem[item].added += added;
    const k = store + SEP + item;
    byStoreItem[k] = byStoreItem[k] || { sold: 0, added: 0 };
    byStoreItem[k].sold += sold;
    byStoreItem[k].added += added;
  }
  return { byStoreItem, byItem, stores: [...stores] };
}

function statsItems(byItem) {
  const known = state.items.filter((i) => byItem[i]);
  const extra = Object.keys(byItem).filter((i) => !state.items.includes(i));
  return known.concat(extra);
}

function statsTable(stores, items, byStoreItem) {
  const head = `<tr><th class="store-col">가게</th>${items.map((i) => `<th>${esc(i)}</th>`).join('')}</tr>`;
  const rows = stores.map((s) => {
    const cells = items.map((i) => {
      const v = byStoreItem[s + SEP + i];
      return `<td class="stat-cell">${v && v.sold ? fmtQty(v.sold) : '·'}</td>`;
    }).join('');
    return `<tr><th class="store-col">${esc(s)}</th>${cells}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="ledger"><tbody>${head}${rows}</tbody></table></div>`;
}

function thisMonth() {
  return today().slice(0, 7);
}

function shiftMonth(delta) {
  const [y, m] = statsMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  statsMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  render();
}

/* ===== 관리 화면 ===== */
function renderManage() {
  return `<section>
    <h2 class="sec-head">가게 (판매처)</h2>
    ${manageList('store', state.stores)}
    <h2 class="sec-head">작물 (품목)</h2>
    ${manageList('item', state.items)}
    <h2 class="sec-head">구글시트 연결</h2>
    ${connectPanel()}
  </section>`;
}

function manageList(kind, list) {
  const rows = list.map((name) => {
    const confirming = confirmKey === kind + ':' + name;
    return `<div class="manage-row"><span>${esc(name)}</span>
      <button class="del ${confirming ? 'confirm' : ''}" data-action="del-${kind}" data-name="${esc(name)}">
        ${confirming ? '한번 더' : '빼기'}</button></div>`;
  }).join('');
  const add = addingKind === kind
    ? addInline(kind)
    : `<button class="add-row" data-action="open-add" data-kind="${kind}">＋ 추가하기</button>`;
  return `${rows || '<p class="hint">아직 없어요.</p>'}${add}`;
}

function addInline(kind) {
  const label = kind === 'store' ? '가게 이름 (예: 호수)' : '작물 이름 (예: 고순)';
  return `<div class="add-inline">
    <input type="text" id="add-input" placeholder="${label}" autocomplete="off">
    <button data-action="confirm-add" data-kind="${kind}">추가</button>
    <button class="ghost-btn" data-action="cancel-add">취소</button>
  </div>`;
}

function connectPanel() {
  const url = getScriptUrl();
  const n = state.pending.length;
  const status = !url
    ? '연결 안 됨 — 지금은 이 폰에만 저장돼요'
    : n ? `아직 시트에 안 보낸 기록 ${n}개` : '연결됨 — 기록이 구글시트에 저장돼요';
  return `<p class="hint">${status}</p>
    <input type="url" id="url-input" placeholder="Apps Script 웹 앱 주소 붙여넣기" value="${esc(state.scriptUrl || '')}">
    <div class="btn-row">
      <button data-action="save-url">주소 저장</button>
      <button data-action="sync-now" ${url ? '' : 'disabled'}>지금 동기화</button>
    </div>`;
}

function confirmAdd(kind) {
  const input = document.getElementById('add-input');
  const name = input ? input.value.trim() : '';
  if (!name) return toast('이름을 넣어 주세요', true);
  if (name.includes(SEP)) return toast(`이름에 ${SEP} 기호는 못 써요`, true);
  if (kind === 'store' && name === HOME_STORE) return toast(`'${HOME_STORE}'은 잔량 칸으로 이미 있어요`, true);
  const list = kind === 'store' ? state.stores : state.items;
  if (list.includes(name)) return toast('이미 있어요', true);
  list.push(name);
  queueOp(kind === 'store' ? 'addStore' : 'addItem', { name });
  render();
  focusAddInput();
  toast(`'${name}' 추가했어요`);
}

function removeName(kind, name) {
  requestConfirm(kind + ':' + name, () => {
    if (kind === 'store') state.stores = state.stores.filter((n) => n !== name);
    else state.items = state.items.filter((n) => n !== name);
    queueOp(kind === 'store' ? 'removeStore' : 'removeItem', { name });
    render();
    toast(`'${name}' 뺐어요 (지난 기록은 남아요)`);
  });
}

function requestConfirm(key, doIt) {
  if (confirmKey === key) {
    clearTimeout(confirmTimer);
    confirmKey = null;
    doIt();
    return;
  }
  confirmKey = key;
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => { confirmKey = null; render(); }, CONFIRM_RESET_MS);
  render();
}

/* ===== 구글시트 동기화 ===== */
function getScriptUrl() {
  return (state.scriptUrl || '').trim();
}

function queueOp(op, payload) {
  state.pending.push({ op, payload });
  saveState();
  scheduleSync();
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, SYNC_DEBOUNCE_MS);
}

async function syncNow() {
  if (!getScriptUrl() || syncing || !navigator.onLine) return updateSyncBadge();
  syncing = true;
  updateSyncBadge();
  try {
    const sentCount = state.pending.length;
    const data = sentCount ? await apiPost(state.pending) : await apiGet();
    applyServer(data, sentCount);
  } catch (e) {
    // 인터넷이 안 되면 그대로 두고 다음 기회에 다시 보냄
  }
  syncing = false;
  updateSyncBadge();
}

function applyServer(data, sentCount) {
  if (!data || !data.ok) return;
  state.pending = state.pending.slice(sentCount);
  state.entries = {};
  for (const e of data.entries || []) {
    state.entries[e.id] = { left: e.left, added: e.added, sold: e.sold, taken: e.taken, ts: e.ts || 0 };
  }
  state.stores = data.stores || [];
  state.items = data.items || [];
  state.pending.forEach(applyOpLocal);
  saveState();
  render();
}

function applyOpLocal(op) {
  const p = op.payload;
  if (op.op === 'upsertEntry') state.entries[p.id] = { left: p.left, added: p.added, sold: p.sold, taken: p.taken, ts: Date.now() };
  else if (op.op === 'deleteEntry') delete state.entries[p.id];
  else if (op.op === 'addStore' && !state.stores.includes(p.name)) state.stores.push(p.name);
  else if (op.op === 'removeStore') state.stores = state.stores.filter((n) => n !== p.name);
  else if (op.op === 'addItem' && !state.items.includes(p.name)) state.items.push(p.name);
  else if (op.op === 'removeItem') state.items = state.items.filter((n) => n !== p.name);
}

async function apiGet() {
  const res = await fetch(getScriptUrl() + '?action=load', { redirect: 'follow' });
  return res.json();
}

async function apiPost(ops) {
  const res = await fetch(getScriptUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ops }),
    redirect: 'follow',
  });
  return res.json();
}

function updateSyncBadge() {
  const el = document.getElementById('sync-badge');
  if (!getScriptUrl()) { el.textContent = '이 폰에만 저장'; el.className = 'off'; return; }
  if (syncing) { el.textContent = '시트에 보내는 중…'; el.className = 'busy'; return; }
  if (state.pending.length) {
    el.textContent = `안 보낸 기록 ${state.pending.length}개`;
    el.className = 'busy';
    return;
  }
  el.textContent = '시트에 저장됨 ✓';
  el.className = 'ok';
}

function saveUrl() {
  const v = document.getElementById('url-input').value.trim();
  if (v && !v.startsWith('https://script.google.com/')) {
    return toast('Apps Script 주소가 아닌 것 같아요', true);
  }
  state.scriptUrl = v;
  saveState();
  render();
  if (v) { toast('시트와 연결했어요'); syncNow(); }
  else toast('연결을 껐어요');
}

/* ===== 토스트 ===== */
function toast(msg, isError) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, TOAST_MS);
}

/* ===== 날짜 이동 ===== */
function shiftDate(days) {
  const [y, m, d] = viewDate.split('-').map(Number);
  viewDate = dateStr(new Date(y, m - 1, d + days));
  editing = null;
  render();
}

function goToday() {
  viewDate = today();
  editing = null;
  render();
}

/* ===== 이벤트 연결 ===== */
function onScreenClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const d = btn.dataset;
  const actions = {
    'edit-cell': () => openEditor(d.store, d.item),
    'save-cell': saveCell,
    'close-editor': () => { editing = null; render(); },
    'date-prev': () => shiftDate(-1),
    'date-next': () => shiftDate(1),
    'date-today': goToday,
    'month-prev': () => shiftMonth(-1),
    'month-next': () => shiftMonth(1),
    'view-mode': () => { state.viewMode = d.mode; saveState(); editing = null; render(); },
    'open-date': () => { viewDate = d.date; switchTab('ledger'); },
    'open-add': () => { addingKind = d.kind; render(); focusAddInput(); },
    'cancel-add': () => { addingKind = null; render(); },
    'confirm-add': () => confirmAdd(d.kind),
    'del-store': () => removeName('store', d.name),
    'del-item': () => removeName('item', d.name),
    'save-url': saveUrl,
    'sync-now': syncNow,
  };
  if (actions[d.action]) actions[d.action]();
}

function onScreenInput(e) {
  if (e.target.id && e.target.id.startsWith('edit-')) updateCalcLine();
}

function updateCalcLine() {
  const el = document.getElementById('calc-line');
  if (!el) return;
  const remain = num(readNum('edit-left')) + num(readNum('edit-added'))
    - num(readNum('edit-sold')) - num(readNum('edit-taken'));
  el.innerHTML = `계산하면 지금 <b>${fmtQty(remain)}개</b> 남아 있어요`;
}

function onScreenKeydown(e) {
  if (e.key === 'Enter' && e.target.id === 'add-input' && addingKind) {
    e.preventDefault();
    confirmAdd(addingKind);
  }
}

function focusAddInput() {
  const input = document.getElementById('add-input');
  if (input) input.focus();
}

/* ===== 시작 ===== */
function init() {
  const screen = document.getElementById('screen');
  screen.addEventListener('click', onScreenClick);
  screen.addEventListener('input', onScreenInput);
  screen.addEventListener('keydown', onScreenKeydown);
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });
  window.addEventListener('online', scheduleSync);
  window.addEventListener('focus', scheduleSync);
  render();
  if (getScriptUrl()) syncNow();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
