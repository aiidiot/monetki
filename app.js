// Grafik redakcji — vanilla JS SPA + Firebase Realtime DB (hardcoded config)
// Dwie zakładki: Grafik (siatka miesiąc) i Redakcja (osoby + role)
// Zero wpisywania w komórkach: wszystko z dropdownów (osoba + godziny z presetu).
//
// Każdy z linkiem automatycznie łączy się z bazą — bez logowania, bez konfiguracji.
// API key meant-to-be-public (Firebase pattern); bezpieczeństwo na poziomie Rules.

// gitleaks:allow
// trufflehog:ignore
// UWAGA dla skanerów sekretów (GitHub Secret Scanning, gitleaks, trufflehog itp.):
// Firebase web API key NIE JEST sekretem. Z założenia Google'a trafia do każdej
// przeglądarki która ładuje stronę i jest jawnie publiczny — patrz oficjalny FAQ:
// https://firebase.google.com/docs/projects/api-keys#api-keys-for-firebase-are-different
// Bezpieczeństwo bazy gwarantują Realtime Database Rules, nie ukrycie tego klucza.
// Klucz nie wymaga rotacji w przypadku ekspozycji w publicznym repo.
const FIREBASE_CONFIG = {
  apiKey:      "AIzaSyBOmMx_OuB-w3EbMCxxOKg3HkMW4Lxj7HE",
  authDomain:  "monetki-eea78.firebaseapp.com",
  databaseURL: "https://monetki-eea78-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:   "monetki-eea78",
};

// ============ Stałe ============
const MONTHS_PL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
const DOW_PL    = ['Nd','Pn','Wt','Śr','Cz','Pt','So'];

// Godziny rozdzielone na ranne (start ≤9) i popołudniowe (start ≥13).
// WP FINANSE = wszystkie (różne zmiany w jednej kolumnie). Poranek = AM, Popo = PM.
// Weekend ma okrojoną listę.
const HOURS_AM_WEEK  = ['6-14','7-15','8-16','9-17'];
const HOURS_PM_WEEK  = ['13-21','14-22','16-22'];
const HOURS_ALL_WEEK = [...HOURS_AM_WEEK, ...HOURS_PM_WEEK];

const HOURS_AM_WKND  = ['7-15','8-16','9-17'];
const HOURS_PM_WKND  = ['13-21','14-22'];
const HOURS_ALL_WKND = [...HOURS_AM_WKND, ...HOURS_PM_WKND];

function hoursPreset(part, isWeekend) {
  if (part === 'am') return isWeekend ? HOURS_AM_WKND  : HOURS_AM_WEEK;
  if (part === 'pm') return isWeekend ? HOURS_PM_WKND  : HOURS_PM_WEEK;
  return                isWeekend ? HOURS_ALL_WKND : HOURS_ALL_WEEK;
}

const FIXED_HOLIDAYS = [[1,1],[1,6],[5,1],[5,3],[8,15],[11,1],[11,11],[12,25],[12,26]];

const ROLES = {
  wp_finanse: 'WP Finanse',
  money:      'Money',
  wydawca:    'Wydawca',
};

// Definicja kolumn grafiku.
// hoursPart: 'am' | 'pm' | 'all' — który preset godzin pokazać w dropdownie.
const COLUMNS = [
  { key: 'wp_finanse',  label: 'WP FINANSE',  bg: 'wp',        kind: 'shifts',    preferRole: 'wp_finanse', maxSlots: 4, hoursPart: 'all' },
  { key: 'poranek',     label: 'Poranek 6-14',bg: 'am',        kind: 'shifts',    preferRole: 'money',      maxSlots: 4, hoursPart: 'am' },
  { key: 'popo',        label: 'Popo 14-22',  bg: 'pm',        kind: 'shifts',    preferRole: 'money',      maxSlots: 4, hoursPart: 'pm' },
  { key: 'makrodyzur',  label: 'MAKRODYŻUR',  bg: 'makro',     kind: 'shifts',    maxSlots: 2, hoursPart: 'all' },
  { key: 'obecni',      label: 'OBECNI',      bg: 'obecni',    kind: 'people',    preferRoles: ['wp_finanse','money'], maxSlots: 20 },
  { key: 'wydawanie',   label: 'WYDAWANIE',   bg: 'wydawanie', kind: 'wydawanie', preferRole: 'wydawca' },
  { key: 'odbiory',     label: 'Odbiory',     bg: 'odbiory',   kind: 'people',    maxSlots: 6 },
  { key: 'urlopy',      label: 'Urlopy',      bg: 'urlopy',    kind: 'people',    maxSlots: 8 },
];

// Pomocniczo: które kolumny "liczą się" jako dyżur (do detekcji duplikatów + statystyk).
const SHIFT_COLS = ['wp_finanse','poranek','popo','makrodyzur','wydawanie'];

// ============ Stan ============
const state = {
  view: 'grafik',
  year: new Date().getFullYear(),
  monthIdx: new Date().getMonth(),
  redakcja: [],
  grafik: {},
  fbReady: false,
  fbDb: null, fbApi: null,
  suppressRemote: false,
};

const LS_REDAKCJA = 'monetki.redakcja';
const LS_GRAFIK   = 'monetki.grafik';

// ============ Helpers ============
const pad2 = n => String(n).padStart(2,'0');
const dateKey = (y,m,d) => `${y}-${pad2(m+1)}-${pad2(d)}`;
const daysInMonth = (y,m) => new Date(y, m+1, 0).getDate();
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function easterSunday(year) {
  const a=year%19, b=Math.floor(year/100), c=year%100;
  const d=Math.floor(b/4), e=b%4, f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4;
  const l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31), day=((h+l-7*m+114)%31)+1;
  return new Date(year, month-1, day);
}
function holidaysForYear(year) {
  const set = new Set();
  FIXED_HOLIDAYS.forEach(([m,d]) => set.add(dateKey(year, m-1, d)));
  const e = easterSunday(year);
  [0,1,49,60].forEach(off => { const x=new Date(e); x.setDate(x.getDate()+off); set.add(dateKey(x.getFullYear(),x.getMonth(),x.getDate())); });
  return set;
}
function isWeekendDay(dow) { return dow===0 || dow===6; }

// ============ Persistencja ============
function loadLocal() {
  try { const r = JSON.parse(localStorage.getItem(LS_REDAKCJA)||'null'); if (r) state.redakcja = r; } catch(e){}
  try { const g = JSON.parse(localStorage.getItem(LS_GRAFIK)||'null');   if (g) state.grafik = g;   } catch(e){}
}
function saveLocal() {
  try { localStorage.setItem(LS_REDAKCJA, JSON.stringify(state.redakcja)); } catch(e){}
  try { localStorage.setItem(LS_GRAFIK,   JSON.stringify(state.grafik));   } catch(e){}
}

// Bootstrap usunięty — dane przychodzą z Firebase automatycznie.
// localStorage służy tylko jako offline cache między sesjami.

// ============ Firebase (auto-connect dla każdego z linkiem) ============
async function tryInitFirebase() {
  setStatus('local','łączę...');
  try {
    const [{ initializeApp }, dbMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js'),
    ]);
    const app = initializeApp(FIREBASE_CONFIG);
    state.fbDb  = dbMod.getDatabase(app);
    state.fbApi = dbMod;
    state.fbReady = true;
    setStatus('online', 'online');

    // Subskrybuj redakcja + grafik
    dbMod.onValue(dbMod.ref(state.fbDb, 'redakcja'), snap => {
      const r = snap.val();
      if (r) {
        state.suppressRemote = true;
        state.redakcja = r; saveLocal();
        renderRedakcja(); renderGrafik();
        state.suppressRemote = false;
      } else if (state.redakcja.length) {
        dbMod.set(dbMod.ref(state.fbDb, 'redakcja'), state.redakcja);
      }
    });
    dbMod.onValue(dbMod.ref(state.fbDb, 'grafik'), snap => {
      const g = snap.val();
      if (g) {
        state.suppressRemote = true;
        state.grafik = g; saveLocal(); renderGrafik();
        state.suppressRemote = false;
      } else if (Object.keys(state.grafik).length) {
        dbMod.set(dbMod.ref(state.fbDb, 'grafik'), state.grafik);
      }
    });
  } catch(e) {
    console.error('Firebase init', e);
    setStatus('offline', 'fb błąd');
  }
}
function pushFirebase(path, value) {
  if (!state.fbReady || state.suppressRemote) return;
  const { set, ref } = state.fbApi;
  set(ref(state.fbDb, path), value).catch(e => console.warn('push fail', path, e));
}

function setStatus(kind, label) {
  const el = $('#status'); el.className = 'status status-'+kind; el.textContent = label;
}

// ============ Wykrywanie duplikatów + statystyki ============

// Zwraca Set nazwisk które TEGO DNIA występują w więcej niż jednej kolumnie obsadowej.
// Liczą się: wp_finanse, poranek, popo, wydawanie (każda jako jedno wystąpienie per osoba per kolumna).
function dayDuplicates(cell) {
  if (!cell) return new Set();
  const counts = {};
  const bump = name => { if (name) counts[name] = (counts[name]||0) + 1; };
  (cell.wp_finanse || []).forEach(s => bump(s.name));
  (cell.poranek    || []).forEach(s => bump(s.name));
  (cell.popo       || []).forEach(s => bump(s.name));
  (cell.makrodyzur || []).forEach(s => bump(s.name));
  const w = cell.wydawanie;
  if (w) {
    if (w.rano)  bump(w.rano.name);
    if (w.popol) bump(w.popol.name);
    if (w.plan)  bump(w.plan.name);
  }
  const dups = new Set();
  Object.entries(counts).forEach(([n,c]) => { if (c > 1) dups.add(n); });
  return dups;
}

// Liczy dyżury wszystkich osób w danym miesiącu.
// Zwraca { 'Master': {wp_finanse: 5, poranek: 0, popo: 0, wydawanie: 0, total: 5}, ... }
function shiftCountsForMonth(year, monthIdx) {
  const counts = {};
  const dim = daysInMonth(year, monthIdx);
  for (let d=1; d<=dim; d++) {
    const cell = state.grafik[dateKey(year, monthIdx, d)];
    if (!cell) continue;
    const add = (name, col) => {
      if (!name) return;
      if (!counts[name]) counts[name] = { wp_finanse:0, poranek:0, popo:0, makrodyzur:0, wydawanie:0, total:0 };
      counts[name][col]++; counts[name].total++;
    };
    (cell.wp_finanse || []).forEach(s => add(s.name, 'wp_finanse'));
    (cell.poranek    || []).forEach(s => add(s.name, 'poranek'));
    (cell.popo       || []).forEach(s => add(s.name, 'popo'));
    (cell.makrodyzur || []).forEach(s => add(s.name, 'makrodyzur'));
    if (cell.wydawanie?.rano)  add(cell.wydawanie.rano.name,  'wydawanie');
    if (cell.wydawanie?.popol) add(cell.wydawanie.popol.name, 'wydawanie');
    if (cell.wydawanie?.plan)  add(cell.wydawanie.plan.name,  'wydawanie');
  }
  return counts;
}

// ============ Kopiowanie miesiąca (uwzględnia dni tygodnia) ============

// Mapowanie source month → target month po (dow, nth-of-dow), żeby Pn padał na Pn,
// 1-szy Pn źródła → 1-szy Pn celu, 2-gi → 2-gi itd. Sobotnio-niedzielne godziny
// nie wycieką na dni robocze (zachowujemy strukturę tygodnia).
function copyMonthSchedule(srcYear, srcMonthIdx, dstYear, dstMonthIdx) {
  // Zbuduj indeks źródła: { dow_nth: cellCopy }, np. "1_2" = drugi Pn źródła
  const srcIdx = {};
  const srcDim = daysInMonth(srcYear, srcMonthIdx);
  const dowCount = {};
  for (let d=1; d<=srcDim; d++) {
    const dow = new Date(srcYear, srcMonthIdx, d).getDay();
    dowCount[dow] = (dowCount[dow]||0) + 1;
    const cell = state.grafik[dateKey(srcYear, srcMonthIdx, d)];
    if (cell) srcIdx[`${dow}_${dowCount[dow]}`] = JSON.parse(JSON.stringify(cell));
  }
  // Dla każdego dnia celu znajdź odpowiednik źródła
  const dstDim = daysInMonth(dstYear, dstMonthIdx);
  const dstDow = {};
  let copied = 0, skipped = 0;
  for (let d=1; d<=dstDim; d++) {
    const dow = new Date(dstYear, dstMonthIdx, d).getDay();
    dstDow[dow] = (dstDow[dow]||0) + 1;
    const src = srcIdx[`${dow}_${dstDow[dow]}`];
    const key = dateKey(dstYear, dstMonthIdx, d);
    if (src) { state.grafik[key] = src; copied++; }
    else      { delete state.grafik[key]; skipped++; }
  }
  return { copied, skipped };
}

// ============ Render: Grafik ============
function renderMonthLabel() {
  $('#month-label').textContent = `${MONTHS_PL[state.monthIdx]} ${state.year}`;
  let srcY = state.year, srcM = state.monthIdx - 1;
  if (srcM < 0) { srcM = 11; srcY--; }
  const btn = $('#copy-prev-btn');
  if (btn) btn.textContent = `📋 Kopiuj z ${MONTHS_PL[srcM]}`;
}

function getPeopleSorted(preferRole, preferRoles) {
  // Zwraca [{name, roles, preferred:bool}] — preferowani na górze.
  const prefer = new Set(preferRoles || (preferRole ? [preferRole] : []));
  const tagged = state.redakcja.map(p => ({
    ...p,
    preferred: prefer.size > 0 && (p.roles||[]).some(r => prefer.has(r)),
  }));
  // Sort: preferowani alfabetycznie, potem reszta alfabetycznie
  tagged.sort((a,b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return a.name.localeCompare(b.name, 'pl');
  });
  return tagged;
}

function pillClass(name, dups) { return dups && dups.has(name) ? 'pill pill-dup' : 'pill'; }

function renderShiftPills(slots, dups) {
  if (!slots || !slots.length) return '<div class="cell-empty">—</div>';
  return slots.map(s => `<span class="${pillClass(s.name, dups)}" title="${dups?.has(s.name)?'⚠ dubel dnia':''}">${s.hours?`<span class="hrs">${s.hours}</span><span class="sep">·</span>`:''}${escapeHtml(s.name)}</span>`).join('');
}
function renderPeoplePills(people) {
  if (!people || !people.length) return '<div class="cell-empty">—</div>';
  return people.map(n => `<span class="pill pill-person">${escapeHtml(n)}</span>`).join('');
}
function renderWydawaniePills(wyd, dups, isFriday) {
  if (!wyd || (!wyd.rano && !wyd.popol && !wyd.plan)) return '<div class="cell-empty">—</div>';
  const row = (lab, slot, extraCls='') => slot
    ? `<div class="wyd-row ${extraCls}"><span class="label">${lab}</span><span class="${pillClass(slot.name, dups)}" title="${dups?.has(slot.name)?'⚠ dubel dnia':''}">${slot.hours?`<span class="hrs">${slot.hours}</span><span class="sep">·</span>`:''}${escapeHtml(slot.name)}</span></div>`
    : `<div class="wyd-row wyd-empty ${extraCls}"><span class="label">${lab}</span><span class="cell-empty">—</span></div>`;
  let out = row('Rano', wyd.rano) + row('Popoł', wyd.popol);
  // Planowanie weekendu — tylko w piątki (lub jeśli już zapisane mimo nie-piątku)
  if (isFriday || wyd.plan) out += row('Plan WKD', wyd.plan, 'wyd-plan');
  return out;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderGrafik() {
  renderMonthLabel();
  const tbody = $('#grid-body');
  tbody.innerHTML = '';
  const y = state.year, m = state.monthIdx;
  const dim = daysInMonth(y, m);
  const hols = holidaysForYear(y);
  const now = new Date();
  const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate());

  for (let d = 1; d <= dim; d++) {
    const key = dateKey(y, m, d);
    const dt  = new Date(y, m, d);
    const dow = dt.getDay();
    const tr = document.createElement('tr');
    if (isWeekendDay(dow))    tr.classList.add('weekend');
    if (hols.has(key))        tr.classList.add('holiday');
    if (key === todayKey)     tr.classList.add('today');

    const tdDay = document.createElement('td');
    tdDay.className = 'col-day';
    tdDay.innerHTML = `<div class="cell-day"><span>${d}</span><span class="dow">${DOW_PL[dow]}</span></div>`;
    tr.appendChild(tdDay);

    const cell = state.grafik[key] || {};
    const dups = dayDuplicates(cell);
    COLUMNS.forEach(col => {
      const td = document.createElement('td');
      td.className = 'cell col-c-'+col.bg;
      td.dataset.dateKey = key;
      td.dataset.col = col.key;
      const val = cell[col.key];
      let html;
      if (col.kind === 'shifts')         html = renderShiftPills(val, dups);
      else if (col.kind === 'people')    html = renderPeoplePills(val);
      else if (col.kind === 'wydawanie') html = renderWydawaniePills(val, dups, dow === 5);
      td.innerHTML = html;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

// ============ Edytor komórki ============
let dialogContext = null; // { dateKey, colKey, type, slots: [...] }

function openCellEditor(dateKey, colKey) {
  const colDef = COLUMNS.find(c => c.key === colKey);
  const cell = state.grafik[dateKey] || {};
  const current = cell[colKey];

  // Day of week (do wyboru presetu godzin)
  const [y,mm,dd] = dateKey.split('-').map(Number);
  const dow = new Date(y, mm-1, dd).getDay();
  const wknd = isWeekendDay(dow);

  // Konstruuj slots — każdy slot trzyma własny hoursPart (am/pm/all)
  let slots;
  if (colDef.kind === 'shifts') {
    slots = (current || []).map(s => ({ ...s, hoursPart: colDef.hoursPart || 'all' }));
  } else if (colDef.kind === 'people') {
    slots = (current || []).map(name => ({ name, hours: null }));
  } else if (colDef.kind === 'wydawanie') {
    slots = [
      { label: 'Rano',   name: current?.rano?.name  || '', hours: current?.rano?.hours  || '', hoursPart: 'am' },
      { label: 'Popoł',  name: current?.popol?.name || '', hours: current?.popol?.hours || '', hoursPart: 'pm' },
    ];
    // Piątek (lub gdy plan już zapisany) → 3-ci slot "Planowanie WKD"
    if (dow === 5 || current?.plan) {
      slots.push({ label: 'Plan WKD', name: current?.plan?.name || '', hours: current?.plan?.hours || '', hoursPart: 'all' });
    }
  }

  dialogContext = { dateKey, colKey, colDef, slots, isWeekend: wknd, fixedSlots: colDef.kind === 'wydawanie' };

  $('#cell-dialog-title').textContent = `${colDef.label} — ${formatDateLabel(dateKey)}`;
  renderSlots();
  $('#cell-add-slot').style.display = dialogContext.fixedSlots ? 'none' : 'inline-block';
  $('#cell-dialog').showModal();
}

function formatDateLabel(key) {
  const [y,m,d] = key.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return `${d} ${MONTHS_PL[m-1]} ${y} (${DOW_PL[dt.getDay()]})`;
}

function renderSlots() {
  const wrap = $('#cell-slots'); wrap.innerHTML = '';
  const { slots, colDef, isWeekend, fixedSlots } = dialogContext;
  const people = getPeopleSorted(colDef.preferRole, colDef.preferRoles);

  slots.forEach((slot, idx) => {
    const row = document.createElement('div');
    row.className = 'slot-row';
    let html = '';
    if (slot.label) html += `<span class="slot-label">${slot.label}</span>`;

    // Person select
    let optsPeople = '<option value="">— wybierz —</option>';
    const preferred = people.filter(p => p.preferred);
    const others    = people.filter(p => !p.preferred);
    if (preferred.length) {
      optsPeople += '<optgroup label="Preferowani">';
      preferred.forEach(p => { optsPeople += `<option value="${escapeHtml(p.name)}" ${p.name===slot.name?'selected':''}>${escapeHtml(p.name)}</option>`; });
      optsPeople += '</optgroup>';
    }
    if (others.length) {
      optsPeople += `<optgroup label="${preferred.length?'Pozostali (zastępstwa)':'Wszyscy'}">`;
      others.forEach(p => { optsPeople += `<option value="${escapeHtml(p.name)}" ${p.name===slot.name?'selected':''}>${escapeHtml(p.name)}</option>`; });
      optsPeople += '</optgroup>';
    }
    html += `<select class="slot-person" data-idx="${idx}">${optsPeople}</select>`;

    // Hours select — preset zależy od typu slotu (am/pm/all) i dnia tygodnia
    if (colDef.kind === 'shifts' || colDef.kind === 'wydawanie') {
      const preset = hoursPreset(slot.hoursPart || colDef.hoursPart || 'all', isWeekend);
      let optsHrs = '<option value="">—</option>';
      preset.forEach(h => { optsHrs += `<option value="${h}" ${h===slot.hours?'selected':''}>${h}</option>`; });
      if (slot.hours && !preset.includes(slot.hours)) {
        optsHrs += `<option value="${escapeHtml(slot.hours)}" selected>${escapeHtml(slot.hours)} (niestand.)</option>`;
      }
      html += `<select class="slot-hrs" data-idx="${idx}">${optsHrs}</select>`;
    }

    // Delete (nie dla fixedSlots = wydawanie)
    if (!fixedSlots) {
      html += `<button type="button" class="slot-del" data-idx="${idx}" title="Usuń">×</button>`;
    }
    row.innerHTML = html;
    wrap.appendChild(row);
  });

  // Bind change handlers
  wrap.querySelectorAll('.slot-person').forEach(sel => sel.onchange = e => {
    dialogContext.slots[+e.target.dataset.idx].name = e.target.value;
  });
  wrap.querySelectorAll('.slot-hrs').forEach(sel => sel.onchange = e => {
    dialogContext.slots[+e.target.dataset.idx].hours = e.target.value;
  });
  wrap.querySelectorAll('.slot-del').forEach(btn => btn.onclick = e => {
    dialogContext.slots.splice(+e.target.dataset.idx, 1);
    renderSlots();
  });
}

$('#cell-add-slot').onclick = () => {
  dialogContext.slots.push({ name: '', hours: '' });
  renderSlots();
};

$('#cell-dialog').addEventListener('close', e => {
  const ret = e.target.returnValue;
  if (ret === 'cancel') { dialogContext = null; return; }
  const { dateKey: dk, colKey, colDef, slots } = dialogContext;
  if (!state.grafik[dk]) state.grafik[dk] = {};
  if (ret === 'clear') {
    delete state.grafik[dk][colKey];
    if (Object.keys(state.grafik[dk]).length === 0) delete state.grafik[dk];
  } else {
    // Zapis wg typu
    if (colDef.kind === 'shifts') {
      const out = slots.filter(s => s.name && s.name.trim()).map(s => ({ name: s.name.trim(), hours: s.hours || '' }));
      if (out.length) state.grafik[dk][colKey] = out;
      else delete state.grafik[dk][colKey];
    } else if (colDef.kind === 'people') {
      const out = slots.filter(s => s.name && s.name.trim()).map(s => s.name.trim());
      if (out.length) state.grafik[dk][colKey] = out;
      else delete state.grafik[dk][colKey];
    } else if (colDef.kind === 'wydawanie') {
      const out = {};
      const [rano, popol, plan] = slots;
      if (rano?.name)  out.rano  = { name: rano.name.trim(),  hours: rano.hours  || '' };
      if (popol?.name) out.popol = { name: popol.name.trim(), hours: popol.hours || '' };
      if (plan?.name)  out.plan  = { name: plan.name.trim(),  hours: plan.hours  || '' };
      if (Object.keys(out).length) state.grafik[dk][colKey] = out;
      else delete state.grafik[dk][colKey];
    }
    if (Object.keys(state.grafik[dk]).length === 0) delete state.grafik[dk];
  }
  saveLocal();
  pushFirebase('grafik', state.grafik);
  renderGrafik();
  dialogContext = null;
});

// Klik w komórkę
document.addEventListener('click', e => {
  const td = e.target.closest('td.cell');
  if (!td || !td.dataset.col) return;
  openCellEditor(td.dataset.dateKey, td.dataset.col);
});

// ============ Render: Redakcja ============
function renderRedakcja() {
  const list = $('#redakcja-list'); list.innerHTML = '';
  // Licznik dyżurów w bieżącym miesiącu (do statystyk obok osoby)
  const counts = shiftCountsForMonth(state.year, state.monthIdx);
  $('#redakcja-month-label').textContent = `${MONTHS_PL[state.monthIdx]} ${state.year}`;

  const sorted = [...state.redakcja].sort((a,b) => a.name.localeCompare(b.name, 'pl'));
  sorted.forEach((p) => {
    const realIdx = state.redakcja.indexOf(p);
    const c = counts[p.name] || { wp_finanse:0, poranek:0, popo:0, makrodyzur:0, wydawanie:0, total:0 };
    const row = document.createElement('div');
    row.className = 'person-row';
    row.innerHTML = `
      <div class="person-name"><input value="${escapeHtml(p.name)}" data-idx="${realIdx}"></div>
      <div class="person-roles">
        ${Object.keys(ROLES).map(r => `
          <span class="role-chip ${p.roles?.includes(r)?'active':''}" data-idx="${realIdx}" data-role="${r}">${ROLES[r]}</span>
        `).join('')}
      </div>
      <div class="person-stats" title="Dyżury w bieżącym miesiącu: WP / Poranek / Popo / Makrodyżur / Wydawanie">
        <span class="stat stat-total">${c.total}</span>
        <span class="stat-detail">${c.wp_finanse}·${c.poranek}·${c.popo}·${c.makrodyzur}·${c.wydawanie}</span>
      </div>
      <button class="person-delete" data-idx="${realIdx}" title="Usuń">×</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('.person-name input').forEach(inp => {
    inp.onchange = e => {
      const i = +e.target.dataset.idx;
      state.redakcja[i].name = e.target.value.trim() || 'Bez nazwy';
      saveLocal(); pushFirebase('redakcja', state.redakcja);
      renderGrafik(); // odśwież dropdowny
    };
  });
  list.querySelectorAll('.role-chip').forEach(chip => {
    chip.onclick = () => {
      const i = +chip.dataset.idx, role = chip.dataset.role;
      const p = state.redakcja[i];
      if (!p.roles) p.roles = [];
      const idx = p.roles.indexOf(role);
      if (idx >= 0) p.roles.splice(idx, 1); else p.roles.push(role);
      saveLocal(); pushFirebase('redakcja', state.redakcja);
      renderRedakcja();
    };
  });
  list.querySelectorAll('.person-delete').forEach(btn => {
    btn.onclick = () => {
      const i = +btn.dataset.idx;
      if (!confirm(`Usunąć ${state.redakcja[i].name}?`)) return;
      state.redakcja.splice(i, 1);
      saveLocal(); pushFirebase('redakcja', state.redakcja);
      renderRedakcja();
    };
  });
}

$('#add-person-btn').onclick = () => {
  state.redakcja.push({ name: 'Nowa osoba', roles: [] });
  saveLocal(); pushFirebase('redakcja', state.redakcja);
  renderRedakcja();
};

// ============ Nav: tabs, month, today ============
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.remove('tab-active'));
  t.classList.add('tab-active');
  state.view = t.dataset.tab;
  $$('.view').forEach(v => v.classList.remove('view-active'));
  $('#view-'+state.view).classList.add('view-active');
  if (state.view === 'redakcja') renderRedakcja();
  if (state.view === 'grafik')   renderGrafik();
});

$('#prev-month').onclick = () => {
  state.monthIdx--;
  if (state.monthIdx < 0) { state.monthIdx = 11; state.year--; }
  renderGrafik();
  if (state.view === 'redakcja') renderRedakcja();
};
$('#next-month').onclick = () => {
  state.monthIdx++;
  if (state.monthIdx > 11) { state.monthIdx = 0; state.year++; }
  renderGrafik();
  if (state.view === 'redakcja') renderRedakcja();
};
$('#today-btn').onclick = () => {
  const now = new Date();
  state.year = now.getFullYear(); state.monthIdx = now.getMonth();
  renderGrafik();
};

// Kopiuj z poprzedniego miesiąca (z poszanowaniem dni tygodnia)
$('#copy-prev-btn').onclick = () => {
  let srcY = state.year, srcM = state.monthIdx - 1;
  if (srcM < 0) { srcM = 11; srcY--; }
  const srcLabel = `${MONTHS_PL[srcM]} ${srcY}`;
  const dstLabel = `${MONTHS_PL[state.monthIdx]} ${state.year}`;
  if (!confirm(`Skopiować grafik z ${srcLabel} do ${dstLabel}?\n\nDni tygodnia są zachowane (Pn→Pn, So→So itd.), więc weekendowe godziny nie wycieką na dni robocze. UWAGA: nadpisze wszystko co masz w ${dstLabel}.`)) return;
  const { copied, skipped } = copyMonthSchedule(srcY, srcM, state.year, state.monthIdx);
  saveLocal(); pushFirebase('grafik', state.grafik);
  renderGrafik();
  alert(`Skopiowano: ${copied} dni · puste: ${skipped} dni`);
};

// Aktualizuj label przycisku przy każdym renderze miesiąca
function updateCopyPrevLabel() {
  let srcY = state.year, srcM = state.monthIdx - 1;
  if (srcM < 0) { srcM = 11; srcY--; }
  const btn = $('#copy-prev-btn');
  if (btn) btn.textContent = `📋 Kopiuj z ${MONTHS_PL[srcM]}`;
}

// ============ Boot ============
(async function main() {
  loadLocal();
  renderGrafik();
  renderRedakcja();
  await tryInitFirebase();
})();
