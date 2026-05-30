// Grafik redakcji — frontend SPA (vanilla JS + opcjonalny Firebase Realtime DB).
// Bez frameworków, bez build-stepu. Hostowane na GitHub Pages.

const MONTHS_PL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
const DOW_PL    = ['Nd','Pn','Wt','Śr','Cz','Pt','So'];

// Stałe święta polskie (m,d). Wielkanoc/Boże Ciało liczone osobno.
const FIXED_HOLIDAYS = [
  [1,1], [1,6], [5,1], [5,3], [8,15], [11,1], [11,11], [12,25], [12,26],
];

const COLUMNS = [
  { key: 'wp_finanse', label: 'WP FINANSE',     placeholder: '8-16 Master / 6-14 Krawiel' },
  { key: 'poranek',    label: 'Poranek 6-14',   placeholder: '7-15 Gadawa / 13-21 M.Walków' },
  { key: 'popo',       label: 'Popo 14-22',     placeholder: '9-17 Żugier' },
  { key: 'odbiory',    label: 'Odbiory',        placeholder: 'Kędzierski' },
  { key: 'urlopy',     label: 'Urlopy',         placeholder: 'Kalus, Sieńko' },
];

// === Stan globalny ===
const state = {
  year:  2021,
  monthIdx: 0,        // 0..11
  data:  {},          // { "YYYY-MM-DD": { wp_finanse, poranek, popo, odbiory, urlopy } }
  fbReady: false,
  fbRef:   null,
  fbDb:    null,
  suppressLocalWrite: false,  // gdy aplikujemy zdalną zmianę, nie chcemy jej wypchnąć z powrotem
};

// === Persistencja: localStorage (zawsze) + Firebase (opcjonalnie) ===

const LS_DATA = 'monetki.data';
const LS_FB   = 'monetki.firebaseConfig';
const LS_YEAR = 'monetki.year';

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_DATA);
    if (raw) state.data = JSON.parse(raw);
  } catch(e) { console.warn('localStorage read failed', e); }
  const y = parseInt(localStorage.getItem(LS_YEAR) || '', 10);
  if (!isNaN(y)) state.year = y;
}
function saveLocal() {
  try { localStorage.setItem(LS_DATA, JSON.stringify(state.data)); } catch(e) {}
  try { localStorage.setItem(LS_YEAR, String(state.year)); } catch(e) {}
}

// === Firebase (opcjonalnie) ===

async function tryInitFirebase() {
  let cfg;
  try { cfg = JSON.parse(localStorage.getItem(LS_FB) || 'null'); } catch(e) { cfg = null; }
  if (!cfg || !cfg.databaseURL) { setStatus('local', 'localStorage'); return; }
  try {
    const [{ initializeApp }, { getDatabase, ref, onValue, set, update }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js'),
    ]);
    const app = initializeApp(cfg);
    state.fbDb = getDatabase(app);
    state.fbRef = ref(state.fbDb, 'grafik');
    state.fbApi = { ref, onValue, set, update };
    setStatus('online', 'Firebase: ' + (cfg.projectId || 'connected'));
    state.fbReady = true;

    // Subskrybuj zdalne zmiany
    onValue(state.fbRef, snap => {
      const remote = snap.val();
      if (!remote) {
        // Pierwsza inicjalizacja — wepchnij to co mamy lokalnie (jeśli coś jest)
        if (Object.keys(state.data).length) set(state.fbRef, state.data);
        return;
      }
      state.suppressLocalWrite = true;
      state.data = remote;
      saveLocal();
      renderGrid();
      state.suppressLocalWrite = false;
    });
  } catch(e) {
    console.error('Firebase init failed:', e);
    setStatus('offline', 'Firebase błąd: ' + (e.message || e));
  }
}

function pushFirebase(dateKey, colKey, value) {
  if (!state.fbReady || state.suppressLocalWrite) return;
  const { update, ref } = state.fbApi;
  update(ref(state.fbDb, 'grafik/' + dateKey), { [colKey]: value }).catch(e => {
    console.warn('Firebase push failed', e);
  });
}

// === UI helpers ===

function setStatus(kind, label) {
  const el = document.getElementById('status');
  el.className = 'status status-' + kind;
  el.textContent = label;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function dateKey(y, m, d) { return `${y}-${pad2(m+1)}-${pad2(d)}`; }
function daysInMonth(y, m) { return new Date(y, m+1, 0).getDate(); }

// === Daty świąteczne (Wielkanoc Gaussa) ===
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year/100), c = year % 100;
  const d = Math.floor(b/4), e = b % 4;
  const f = Math.floor((b+8)/25), g = Math.floor((b-f+1)/3);
  const h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c/4), k = c % 4;
  const l = (32 + 2*e + 2*i - h - k) % 7;
  const m = Math.floor((a + 11*h + 22*l)/451);
  const month = Math.floor((h + l - 7*m + 114)/31);
  const day   = ((h + l - 7*m + 114) % 31) + 1;
  return new Date(year, month-1, day);
}
function holidaysForYear(year) {
  const set = new Set();
  FIXED_HOLIDAYS.forEach(([m,d]) => set.add(`${year}-${pad2(m)}-${pad2(d)}`));
  const easter = easterSunday(year);
  const add = (dt, days) => {
    const x = new Date(dt); x.setDate(x.getDate() + days);
    set.add(`${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`);
  };
  add(easter, 0);    // Niedziela Wielkanocna
  add(easter, 1);    // Poniedziałek Wielkanocny
  add(easter, 49);   // Zielone Świątki
  add(easter, 60);   // Boże Ciało
  return set;
}

// === Render ===

function renderMonthSelect() {
  const sel = document.getElementById('month-select');
  sel.innerHTML = '';
  MONTHS_PL.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = String(i); opt.textContent = name;
    sel.appendChild(opt);
  });
  sel.value = String(state.monthIdx);
}

function renderGrid() {
  document.getElementById('year-input').value = state.year;
  document.getElementById('month-select').value = String(state.monthIdx);

  const tbody = document.getElementById('grid-body');
  tbody.innerHTML = '';
  const y = state.year, m = state.monthIdx;
  const dim = daysInMonth(y, m);
  const holidays = holidaysForYear(y);
  const todayKey = (() => { const d = new Date(); return dateKey(d.getFullYear(), d.getMonth(), d.getDate()); })();

  for (let d = 1; d <= dim; d++) {
    const key = dateKey(y, m, d);
    const dow = new Date(y, m, d).getDay(); // 0=Niedziela
    const tr = document.createElement('tr');
    if (dow === 0 || dow === 6) tr.classList.add('weekend');
    if (holidays.has(key))      tr.classList.add('holiday');
    if (key === todayKey)       tr.classList.add('today');

    const tdDay = document.createElement('td');
    tdDay.className = 'col-day';
    tdDay.innerHTML = `<div class="cell-day"><span>${d}</span><span class="dow">${DOW_PL[dow]}</span></div>`;
    tr.appendChild(tdDay);

    const row = state.data[key] || {};
    COLUMNS.forEach(col => {
      const td = document.createElement('td');
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.spellcheck = false;
      div.dataset.placeholder = col.placeholder;
      div.dataset.key = key;
      div.dataset.col = col.key;
      div.textContent = row[col.key] || '';
      td.appendChild(div);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  }
}

// === Event handlers ===

function onCellBlur(e) {
  const div = e.target;
  if (!div.dataset || !div.dataset.key) return;
  const key = div.dataset.key, col = div.dataset.col;
  const val = div.textContent.trim();
  if (!state.data[key]) state.data[key] = {};
  if (state.data[key][col] === val) return;  // bez zmiany
  state.data[key][col] = val;
  if (!val) delete state.data[key][col];
  if (Object.keys(state.data[key]).length === 0) delete state.data[key];
  saveLocal();
  pushFirebase(key, col, val);
}

function onCellKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    e.target.blur();
  }
}

// === Import / Export ===

function exportJson() {
  const out = { year: state.year, exportedAt: new Date().toISOString(), data: state.data };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `grafik-${state.year}.json`;
  a.click(); URL.revokeObjectURL(a.href);
}

async function importJson(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  // Akceptuj dwa formaty: nasz export {year, data} oraz starsze {months:[...]}
  if (parsed.data) {
    state.data = parsed.data;
    if (parsed.year) state.year = parsed.year;
  } else if (parsed.months) {
    // Konwersja z xlsx-export (data-initial.json)
    state.data = {};
    const year = parsed.year || state.year;
    parsed.months.forEach(m => {
      const monthIdx = MONTHS_PL.findIndex(n => n.toLowerCase() === m.name.toLowerCase());
      if (monthIdx < 0) return;
      m.days.forEach(d => {
        const key = dateKey(year, monthIdx, d.day);
        const cell = {};
        COLUMNS.forEach(c => { if (d[c.key]) cell[c.key] = d[c.key]; });
        if (Object.keys(cell).length) state.data[key] = cell;
      });
    });
    if (parsed.year) state.year = parsed.year;
  } else {
    alert('Nieznany format JSON.'); return;
  }
  saveLocal();
  if (state.fbReady) state.fbApi.set(state.fbApi.ref(state.fbDb, 'grafik'), state.data);
  renderGrid();
}

// === Pierwszy run — załaduj data-initial.json, jeśli localStorage puste ===

async function bootstrapInitialData() {
  if (Object.keys(state.data).length > 0) return;
  try {
    const r = await fetch('data-initial.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const parsed = await r.json();
    state.year = parsed.year || state.year;
    parsed.months.forEach(m => {
      const monthIdx = MONTHS_PL.findIndex(n => n.toLowerCase() === m.name.toLowerCase());
      if (monthIdx < 0) return;
      m.days.forEach(d => {
        const key = dateKey(state.year, monthIdx, d.day);
        const cell = {};
        COLUMNS.forEach(c => { if (d[c.key]) cell[c.key] = d[c.key]; });
        if (Object.keys(cell).length) state.data[key] = cell;
      });
    });
    saveLocal();
  } catch(e) { console.warn('bootstrap failed', e); }
}

// === Settings dialog ===

function openSettings() {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(LS_FB) || '{}'); } catch(e) {}
  document.getElementById('fb-url').value       = cfg.databaseURL || '';
  document.getElementById('fb-apikey').value    = cfg.apiKey || '';
  document.getElementById('fb-projectid').value = cfg.projectId || '';
  document.getElementById('settings-dialog').showModal();
}

document.getElementById('settings-btn').onclick = openSettings;
document.getElementById('settings-dialog').addEventListener('close', (e) => {
  const dlg = e.target;
  if (dlg.returnValue !== 'save') return;
  const cfg = {
    databaseURL: document.getElementById('fb-url').value.trim(),
    apiKey:      document.getElementById('fb-apikey').value.trim(),
    projectId:   document.getElementById('fb-projectid').value.trim(),
    authDomain:  document.getElementById('fb-projectid').value.trim() + '.firebaseapp.com',
  };
  if (!cfg.databaseURL || !cfg.apiKey || !cfg.projectId) {
    alert('Wszystkie 3 pola wymagane.');
    return;
  }
  localStorage.setItem(LS_FB, JSON.stringify(cfg));
  location.reload();
});

// === Boot ===

(async function main() {
  loadLocal();
  await bootstrapInitialData();

  // Ustaw bieżący miesiąc jako start jeśli mamy dane z tego roku
  const now = new Date();
  if (now.getFullYear() === state.year) state.monthIdx = now.getMonth();

  renderMonthSelect();
  renderGrid();
  await tryInitFirebase();

  // Listenery
  document.getElementById('year-input').addEventListener('change', e => {
    state.year = parseInt(e.target.value, 10) || 2021;
    saveLocal(); renderGrid();
  });
  document.getElementById('month-select').addEventListener('change', e => {
    state.monthIdx = parseInt(e.target.value, 10) || 0;
    renderGrid();
  });

  document.getElementById('grid-body').addEventListener('blur', onCellBlur, true);
  document.getElementById('grid-body').addEventListener('keydown', onCellKeydown);

  document.getElementById('export-btn').onclick = exportJson;
  document.getElementById('import-btn').onclick = () => document.getElementById('import-file').click();
  document.getElementById('import-file').onchange = e => { if (e.target.files[0]) importJson(e.target.files[0]); };

  document.getElementById('show-readme').onclick = (e) => {
    e.preventDefault();
    document.getElementById('readme-dialog').showModal();
  };
})();
