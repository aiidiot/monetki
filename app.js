// Grafik redakcji — vanilla JS SPA + opcjonalny Firebase Realtime DB
// Dwie zakładki: Grafik (siatka miesiąc) i Redakcja (osoby + role)
// Zero wpisywania w komórkach: wszystko z dropdownów (osoba + godziny z presetu).

// ============ Stałe ============
const MONTHS_PL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
const DOW_PL    = ['Nd','Pn','Wt','Śr','Cz','Pt','So'];

const HOURS_WEEK = ['6-14','7-15','8-16','9-17','13-21','14-22','16-22'];
const HOURS_WKND = ['7-15','8-16','9-17','13-21'];

const FIXED_HOLIDAYS = [[1,1],[1,6],[5,1],[5,3],[8,15],[11,1],[11,11],[12,25],[12,26]];

const ROLES = {
  wp_finanse: 'WP Finanse',
  money:      'Money',
  wydawca:    'Wydawca',
};

// Definicja kolumn grafiku
const COLUMNS = [
  { key: 'wp_finanse', label: 'WP FINANSE',  bg: 'wp',        kind: 'shifts', preferRole: 'wp_finanse', maxSlots: 4 },
  { key: 'poranek',    label: 'Poranek 6-14',bg: 'am',        kind: 'shifts', preferRole: 'money',      maxSlots: 4 },
  { key: 'popo',       label: 'Popo 14-22',  bg: 'pm',        kind: 'shifts', preferRole: 'money',      maxSlots: 4 },
  { key: 'obecni',     label: 'OBECNI',      bg: 'obecni',    kind: 'people', preferRoles: ['wp_finanse','money'], maxSlots: 20 },
  { key: 'wydawanie',  label: 'WYDAWANIE',   bg: 'wydawanie', kind: 'wydawanie', preferRole: 'wydawca' },
  { key: 'odbiory',    label: 'Odbiory',     bg: 'odbiory',   kind: 'people', maxSlots: 6 },
  { key: 'urlopy',     label: 'Urlopy',      bg: 'urlopy',    kind: 'people', maxSlots: 8 },
];

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

const LS_FB = 'monetki.firebaseConfig';
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

async function bootstrapInitial() {
  if (state.redakcja.length > 0) return;
  try {
    const r = await fetch('data-initial.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const parsed = await r.json();
    state.redakcja = parsed.redakcja || [];
    state.grafik   = parsed.grafik   || {};
    saveLocal();
  } catch(e) { console.warn('bootstrap failed', e); }
}

// ============ Firebase (opcjonalnie) ============
async function tryInitFirebase() {
  let cfg;
  try { cfg = JSON.parse(localStorage.getItem(LS_FB) || 'null'); } catch(e){ cfg=null; }
  if (!cfg || !cfg.databaseURL) { setStatus('local','local'); return; }
  try {
    const [{ initializeApp }, dbMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js'),
    ]);
    const app = initializeApp(cfg);
    state.fbDb  = dbMod.getDatabase(app);
    state.fbApi = dbMod;
    state.fbReady = true;
    setStatus('online', 'online: '+(cfg.projectId||'fb'));

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

// ============ Render: Grafik ============
function renderMonthLabel() {
  $('#month-label').textContent = `${MONTHS_PL[state.monthIdx]} ${state.year}`;
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

function renderShiftPills(slots) {
  if (!slots || !slots.length) return '<div class="cell-empty">—</div>';
  return slots.map(s => `<span class="pill"><span class="hrs">${s.hours||''}</span>${s.hours?'<span class="sep">·</span>':''}${escapeHtml(s.name)}</span>`).join('');
}
function renderPeoplePills(people) {
  if (!people || !people.length) return '<div class="cell-empty">—</div>';
  return people.map(n => `<span class="pill">${escapeHtml(n)}</span>`).join('');
}
function renderWydawaniePills(wyd) {
  if (!wyd || (!wyd.rano && !wyd.popol)) return '<div class="cell-empty">—</div>';
  const parts = [];
  if (wyd.rano) parts.push(`<span class="pill"><span class="label">Rano</span><span class="hrs">${wyd.rano.hours||''}</span>${wyd.rano.hours?'<span class="sep">·</span>':''}${escapeHtml(wyd.rano.name)}</span>`);
  if (wyd.popol) parts.push(`<span class="pill"><span class="label">Popoł</span><span class="hrs">${wyd.popol.hours||''}</span>${wyd.popol.hours?'<span class="sep">·</span>':''}${escapeHtml(wyd.popol.name)}</span>`);
  return parts.join('');
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
    COLUMNS.forEach(col => {
      const td = document.createElement('td');
      td.className = 'cell col-c-'+col.bg;
      td.dataset.dateKey = key;
      td.dataset.col = col.key;
      const val = cell[col.key];
      let html;
      if (col.kind === 'shifts')       html = renderShiftPills(val);
      else if (col.kind === 'people')  html = renderPeoplePills(val);
      else if (col.kind === 'wydawanie') html = renderWydawaniePills(val);
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

  // Konstruuj slots na podstawie typu
  let slots;
  if (colDef.kind === 'shifts') {
    slots = (current || []).map(s => ({...s}));
  } else if (colDef.kind === 'people') {
    slots = (current || []).map(name => ({ name, hours: null }));
  } else if (colDef.kind === 'wydawanie') {
    slots = [
      { label: 'Rano',   name: current?.rano?.name  || '', hours: current?.rano?.hours  || '' },
      { label: 'Popoł',  name: current?.popol?.name || '', hours: current?.popol?.hours || '' },
    ];
  }

  // Day of week dla presetu godzin
  const [y,mm,dd] = dateKey.split('-').map(Number);
  const dow = new Date(y, mm-1, dd).getDay();
  const hoursPreset = isWeekendDay(dow) ? HOURS_WKND : HOURS_WEEK;

  dialogContext = { dateKey, colKey, colDef, slots, hoursPreset, fixedSlots: colDef.kind === 'wydawanie' };

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
  const { slots, colDef, hoursPreset, fixedSlots } = dialogContext;
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

    // Hours select (jeśli kolumna typu shifts/wydawanie)
    if (colDef.kind === 'shifts' || colDef.kind === 'wydawanie') {
      let optsHrs = '<option value="">—</option>';
      hoursPreset.forEach(h => { optsHrs += `<option value="${h}" ${h===slot.hours?'selected':''}>${h}</option>`; });
      // jeśli aktualne godziny nie pasują do presetu, dodaj jako custom
      if (slot.hours && !hoursPreset.includes(slot.hours)) {
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
      const [rano, popol] = slots;
      if (rano.name)  out.rano  = { name: rano.name.trim(),  hours: rano.hours  || '' };
      if (popol.name) out.popol = { name: popol.name.trim(), hours: popol.hours || '' };
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
  const sorted = [...state.redakcja].sort((a,b) => a.name.localeCompare(b.name, 'pl'));
  sorted.forEach((p, sortedIdx) => {
    const realIdx = state.redakcja.indexOf(p); // żeby update trafił w dobry element
    const row = document.createElement('div');
    row.className = 'person-row';
    row.innerHTML = `
      <div class="person-name"><input value="${escapeHtml(p.name)}" data-idx="${realIdx}"></div>
      <div class="person-roles">
        ${Object.keys(ROLES).map(r => `
          <span class="role-chip ${p.roles?.includes(r)?'active':''}" data-idx="${realIdx}" data-role="${r}">${ROLES[r]}</span>
        `).join('')}
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
};
$('#next-month').onclick = () => {
  state.monthIdx++;
  if (state.monthIdx > 11) { state.monthIdx = 0; state.year++; }
  renderGrafik();
};
$('#today-btn').onclick = () => {
  const now = new Date();
  state.year = now.getFullYear(); state.monthIdx = now.getMonth();
  renderGrafik();
};

// ============ Import / Export ============
$('#export-btn').onclick = () => {
  const out = { exportedAt: new Date().toISOString(), redakcja: state.redakcja, grafik: state.grafik };
  const blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `grafik-${state.year}-${pad2(state.monthIdx+1)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
};
$('#import-btn').onclick = () => $('#import-file').click();
$('#import-file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const parsed = JSON.parse(await f.text());
  if (parsed.redakcja) state.redakcja = parsed.redakcja;
  if (parsed.grafik)   state.grafik   = parsed.grafik;
  saveLocal();
  if (state.fbReady) {
    pushFirebase('redakcja', state.redakcja);
    pushFirebase('grafik',   state.grafik);
  }
  renderGrafik(); renderRedakcja();
};

// ============ Firebase config dialog ============
$('#settings-btn').onclick = () => {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(LS_FB) || '{}'); } catch(e){}
  $('#fb-url').value = cfg.databaseURL || '';
  $('#fb-apikey').value = cfg.apiKey || '';
  $('#fb-projectid').value = cfg.projectId || '';
  $('#settings-dialog').showModal();
};
$('#settings-dialog').addEventListener('close', e => {
  if (e.target.returnValue !== 'save') return;
  const cfg = {
    databaseURL: $('#fb-url').value.trim(),
    apiKey:      $('#fb-apikey').value.trim(),
    projectId:   $('#fb-projectid').value.trim(),
    authDomain:  $('#fb-projectid').value.trim() + '.firebaseapp.com',
  };
  if (!cfg.databaseURL || !cfg.apiKey || !cfg.projectId) { alert('Wymagane wszystkie 3 pola.'); return; }
  localStorage.setItem(LS_FB, JSON.stringify(cfg));
  location.reload();
});

// ============ Boot ============
(async function main() {
  loadLocal();
  await bootstrapInitial();
  renderGrafik();
  renderRedakcja();
  await tryInitFirebase();
})();
