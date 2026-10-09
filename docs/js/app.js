import { loadConfig, saveConfig, clearConfig, Store, slugify, listProfiles } from './store.js';
import { GitHubClient } from './github.js';
import { parseReceipt, parseNumber } from './receipt-parser.js';
import { processReceiptFiles } from './scan.js';
import { computeStats, monthlyCost } from './stats.js';

// MARK: Hjelpere

const $app = document.getElementById('app');
let store = null;
const ui = { tab: 'fills', carFilter: '', statsCar: '' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nok = new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK' });
const dec2 = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('nb-NO');
const fmt = {
  kr: (v) => nok.format(v),
  l: (v) => `${dec2.format(v)} l`,
  ppl: (v) => `${dec2.format(v)} kr/l`,
  km: (v) => `${int.format(v)} km`,
  date: (iso) => new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }),
  input: (v) => (v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ',')),
};
const FUEL = { bensin: 'Bensin', diesel: 'Diesel' };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const carName = (car) => (car ? (car.plate ? `${car.name} (${car.plate})` : car.name) : 'Slettet bil');
const sum = (list, key) => list.reduce((s, x) => s + (x[key] || 0), 0);

const ICONS = {
  fills: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h8a2 2 0 0 1 2 2v6h1a2 2 0 0 1 2 2v4a1 1 0 0 0 2 0V9.4l-2.7-2.7 1.4-1.4 3 3c.2.2.3.4.3.7V17a3 3 0 0 1-6 0v-4h-1v7h1v2H2v-2h1V5a2 2 0 0 1 2-2Zm0 2v5h8V5H5Z"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 20h16v2H2V3h2v17Zm3-3V10h3v7H7Zm5 0V5h3v12h-3Zm5 0v-5h3v5h-3Z"/></svg>',
  cars: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 11 6.5 6.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11a2 2 0 0 1 2 2v5h-2v2h-3v-2H8v2H5v-2H3v-5a2 2 0 0 1 2-2Zm2.1 0h9.8l-1.2-4H8.3l-1.2 4ZM6.5 16a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-1.7-8h3.4l.5 2.6c.6.2 1.2.6 1.7 1l2.5-.9 1.7 3-2 1.7a7 7 0 0 1 0 2l2 1.7-1.7 3-2.5-.9c-.5.4-1.1.8-1.7 1l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.6-1.7-1l-2.5.9-1.7-3 2-1.7a7 7 0 0 1 0-2l-2-1.7 1.7-3 2.5.9c.5-.4 1.1-.8 1.7-1l.5-2.6Z"/></svg>',
};

function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

function overlay(message) {
  let el = document.querySelector('.overlay');
  if (message == null) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = '<div class="box"><div class="spinner"></div><div class="msg"></div></div>';
    document.body.append(el);
  }
  el.querySelector('.msg').textContent = message;
}

function openSheet(html) {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = html;
  document.body.append(el);
  document.body.style.overflow = 'hidden';
  return el;
}

function closeSheet() {
  document.querySelectorAll('.sheet').forEach((s) => s.remove());
  document.body.style.overflow = '';
}

function segmented(name, value) {
  return `<div class="segmented" data-seg="${name}">
    ${Object.entries(FUEL).map(([k, v]) => `<button type="button" data-value="${k}" class="${k === value ? 'on' : ''}">${v}</button>`).join('')}
  </div>`;
}

function bindSegmented(root, name, onChange) {
  const seg = root.querySelector(`[data-seg="${name}"]`);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onChange(b.dataset.value);
  });
  return (value) => seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.value === value));
}

// MARK: Oppsett (første gang)

function renderSetup(error = '', values = null) {
  const cfg = loadConfig() || {};
  const prev = values || { repo: cfg.owner ? `${cfg.owner}/${cfg.repo}` : '', profile: cfg.profile || '' };
  $app.innerHTML = `
  <div class="setup">
    <img src="icons/icon-192.png" alt="">
    <h1>Drivstoff</h1>
    <p class="muted">Alle data og kvitteringer lagres i ditt eget GitHub-repo, under en profil du velger.</p>

    <div class="section-title">Slik kobler du til</div>
    <div class="card" style="padding:12px 16px">
      <ol>
        <li>Lag et <b>privat</b> repo på GitHub til dataene, f.eks. <i>drivstoff-data</i>
          (<a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a>).</li>
        <li>Lag en <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>:
          velg <i>Only select repositories</i> → data-repoet, og under <i>Permissions → Contents</i> velg <b>Read and write</b>.</li>
        <li>Lim inn tokenet under. Det lagres bare på denne enheten.</li>
      </ol>
    </div>

    <form id="setup-form" autocomplete="off">
      <div class="card">
        <div class="field stack"><label for="s-repo">Repo (eier/navn)</label>
          <input id="s-repo" required placeholder="brukernavn/drivstoff-data" value="${esc(prev.repo)}" autocapitalize="off" spellcheck="false"></div>
        <div class="field stack"><label for="s-profile">Profil</label>
          <input id="s-profile" required placeholder="f.eks. Elias" value="${esc(prev.profile || '')}"></div>
        <div class="field stack"><label for="s-token">GitHub-token</label>
          <input id="s-token" required type="password" placeholder="github_pat_…" autocapitalize="off" spellcheck="false"></div>
      </div>
      ${error ? `<div class="card"><div class="note error">${esc(error)}</div></div>` : ''}
      <button class="btn" type="submit">Koble til</button>
    </form>
    <p class="small muted">Tips: Trykk på Del-knappen i Safari og velg «Legg til på Hjem-skjerm» for å bruke Drivstoff som en app.</p>
  </div>`;

  $app.querySelector('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const repoText = $app.querySelector('#s-repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    const [owner, repo] = repoText.split('/');
    const profile = $app.querySelector('#s-profile').value.trim();
    const token = $app.querySelector('#s-token').value.trim();
    const values = { repo: repoText, profile };
    if (!owner || !repo) return renderSetup('Skriv repoet som eier/navn, f.eks. lilleseth/drivstoff-data.', values);

    overlay('Kobler til GitHub …');
    try {
      const client = new GitHubClient({ token, owner, repo });
      const access = await client.checkAccess();
      if (!access.canWrite) throw new Error('Tokenet har ikke skrivetilgang til repoet (Contents: Read and write).');
      if (!access.private && !confirm('Repoet er OFFENTLIG – kvitteringer og utgifter blir synlige for alle. Fortsette likevel?')) {
        overlay(null);
        return;
      }
      const config = { token, owner, repo, branch: client.branch, profile };
      saveConfig(config);
      await start(config);
      const existing = (await listProfiles(client).catch(() => [])).includes(slugify(profile));
      toast(existing ? `Hentet profilen «${profile}»` : `Ny profil «${profile}» opprettet`);
    } catch (err) {
      overlay(null);
      renderSetup(err.status === 404 ? 'Fant ikke repoet. Sjekk navnet og at tokenet har tilgang til det.' : err.message, values);
    }
  });
}

async function start(config) {
  store = new Store(config);
  store.addEventListener('change', () => renderMain());
  store.addEventListener('status', () => renderSyncStatus());
  renderMain();
  overlay('Henter data …');
  await store.sync();
  overlay(null);
}

// MARK: Hovedvisning

const TABS = [
  ['fills', 'Fyllinger'],
  ['stats', 'Statistikk'],
  ['cars', 'Biler'],
  ['settings', 'Innstillinger'],
];

function renderMain() {
  if (!store) return;
  const title = TABS.find(([k]) => k === ui.tab)[1];
  const body = { fills: renderFills, stats: renderStats, cars: renderCars, settings: renderSettings }[ui.tab]();
  const scroll = window.scrollY;
  $app.innerHTML = `
    <header class="topbar"><h1>${title}</h1><button class="sync" data-action="sync"></button></header>
    <main>${body}</main>
    ${ui.tab === 'fills' && store.cars.length ? '<button class="fab" data-action="new-fill" aria-label="Ny fylling">+</button>' : ''}
    <nav class="tabbar">
      ${TABS.map(([k, label]) => `<button data-action="tab" data-tab="${k}" class="${ui.tab === k ? 'on' : ''}">${ICONS[k]}<span>${label}</span></button>`).join('')}
    </nav>`;
  window.scrollTo(0, scroll);
  renderSyncStatus();
}

function renderSyncStatus() {
  const el = $app.querySelector('.sync');
  if (!el || !store) return;
  const { state, message } = store.status;
  const unsynced = store.hasUnsyncedChanges && state !== 'syncing';
  el.className = `sync ${unsynced && state !== 'error' ? 'syncing' : state}`;
  el.innerHTML = `<span class="dot"></span>${esc(unsynced && state === 'ok' ? 'Venter på synk' : message || '')}`;
  const settingsStatus = document.getElementById('settings-status');
  if (settingsStatus) settingsStatus.textContent = message || '–';
}

function renderFills() {
  const cars = store.cars;
  if (!cars.length) {
    return `<div class="empty"><div class="big">🚗</div><h2>Ingen biler ennå</h2>
      <p>Legg til bilen din for å begynne å registrere fyllinger.</p>
      <button class="btn" data-action="new-car">Legg til bil</button></div>`;
  }
  const carById = Object.fromEntries(cars.map((c) => [c.id, c]));
  const list = store.fillUps
    .filter((f) => !ui.carFilter || f.carId === ui.carFilter)
    .sort((a, b) => b.date.localeCompare(a.date));

  const filter = cars.length > 1 ? `
    <div class="card"><div class="field"><label for="car-filter">Bil</label>
      <select id="car-filter" data-change="car-filter">
        <option value="">Alle biler</option>
        ${cars.map((c) => `<option value="${c.id}" ${ui.carFilter === c.id ? 'selected' : ''}>${esc(carName(c))}</option>`).join('')}
      </select></div></div>` : '';

  if (!list.length) {
    return `${filter}<div class="empty"><div class="big">⛽️</div><h2>Ingen fyllinger</h2>
      <p>Trykk + for å registrere en fylling, eller skann kvitteringen.</p>
      <button class="btn" data-action="new-fill">Ny fylling</button></div>`;
  }

  return `${filter}
    <div class="card summary">
      <div><div class="label">Totalt</div><div class="value num">${fmt.kr(sum(list, 'total'))}</div></div>
      <div><div class="label">Liter</div><div class="value num">${fmt.l(sum(list, 'liters'))}</div></div>
      <div><div class="label">Fyllinger</div><div class="value num">${list.length}</div></div>
    </div>
    <div class="card">
      ${list.map((f) => `
        <button class="row" data-action="edit-fill" data-id="${f.id}">
          <span class="badge ${f.fuel}">⛽︎</span>
          <span class="grow">
            <div class="title">${fmt.date(f.date)} ${f.receipt ? '<span class="muted small">📄</span>' : ''}</div>
            <div class="sub">${cars.length > 1 && !ui.carFilter ? `${esc(carName(carById[f.carId]))} · ` : ''}${fmt.l(f.liters)} · ${FUEL[f.fuel] || ''} · ${fmt.km(f.odometer)}</div>
          </span>
          <span class="right">
            <div class="title num">${fmt.kr(f.total)}</div>
            <div class="sub num">${f.liters > 0 ? fmt.ppl(f.total / f.liters) : ''}</div>
          </span>
        </button>`).join('')}
    </div>`;
}

function renderCars() {
  const cars = store.cars;
  const fills = store.fillUps;
  return `
    ${cars.length ? `<div class="card">${cars.map((c) => {
      const own = fills.filter((f) => f.carId === c.id);
      return `<button class="row" data-action="edit-car" data-id="${c.id}">
        <span class="badge ${c.fuel}">🚗</span>
        <span class="grow"><div class="title">${esc(c.name)}</div>
          <div class="sub">${[c.plate, FUEL[c.fuel]].filter(Boolean).map(esc).join(' · ')}</div></span>
        <span class="right"><div class="num">${fmt.kr(sum(own, 'total'))}</div>
          <div class="sub">${own.length} fyllinger</div></span>
        <span class="chev">›</span>
      </button>`;
    }).join('')}</div>` : '<div class="empty"><div class="big">🚗</div><h2>Ingen biler</h2><p>Legg til bilene du vil føre utgifter for.</p></div>'}
    <button class="btn secondary" data-action="new-car">＋ Legg til bil</button>`;
}

function statsSection(title, fills, showConsumption) {
  const s = computeStats(fills);
  return `<div class="section-title">${esc(title)}</div><div class="card">
    <div class="kv"><span>Totalt brukt</span><span>${fmt.kr(s.totalCost)}</span></div>
    <div class="kv"><span>Liter totalt</span><span>${fmt.l(s.totalLiters)}</span></div>
    <div class="kv"><span>Antall fyllinger</span><span>${s.count}</span></div>
    ${s.averagePricePerLiter != null ? `<div class="kv"><span>Snitt literpris</span><span>${fmt.ppl(s.averagePricePerLiter)}</span></div>` : ''}
    ${showConsumption && s.distance != null ? `
      <div class="kv"><span>Kjørt</span><span>${fmt.km(s.distance)}</span></div>
      <div class="kv"><span>Forbruk</span><span>${dec2.format(s.litersPerMil)} l/mil</span></div>
      <div class="kv"><span>Drivstoff per km</span><span>${dec2.format(s.costPerKm)} kr</span></div>` : ''}
  </div>`;
}

function renderStats() {
  const cars = store.cars;
  const all = store.fillUps;
  if (!all.length) {
    return '<div class="empty"><div class="big">📊</div><h2>Ingen data ennå</h2><p>Statistikk vises når du har registrert fyllinger.</p></div>';
  }
  if (ui.statsCar && !cars.some((c) => c.id === ui.statsCar)) ui.statsCar = '';
  const selected = ui.statsCar ? all.filter((f) => f.carId === ui.statsCar) : all;
  const months = monthlyCost(selected, 12);
  const max = Math.max(1, ...months.map((m) => m.cost));
  const monthName = (d) => d.toLocaleDateString('nb-NO', { month: 'short' }).replace('.', '');

  let sections;
  if (ui.statsCar || cars.length === 1) {
    const car = cars.find((c) => c.id === (ui.statsCar || cars[0].id));
    sections = statsSection(carName(car), selected, true);
  } else {
    sections = statsSection('Alle biler', all, false)
      + cars.map((c) => statsSection(carName(c), all.filter((f) => f.carId === c.id), true)).join('');
  }

  return `
    ${cars.length > 1 ? `<div class="card"><div class="field"><label for="stats-car">Bil</label>
      <select id="stats-car" data-change="stats-car"><option value="">Alle biler</option>
      ${cars.map((c) => `<option value="${c.id}" ${ui.statsCar === c.id ? 'selected' : ''}>${esc(carName(c))}</option>`).join('')}
      </select></div></div>` : ''}
    <div class="section-title">Kostnad per måned</div>
    <div class="card"><div class="chart">
      ${months.map((m) => `<div class="bar" title="${monthName(m.month)}: ${fmt.kr(m.cost)}">
        <span style="height:${(m.cost / max) * 100}%"></span><small>${monthName(m.month)}</small></div>`).join('')}
    </div></div>
    ${sections}`;
}

function renderSettings() {
  const c = store.config;
  return `
    <div class="section-title">Profil</div>
    <div class="card">
      <div class="kv"><span>Profil</span><span>${esc(c.profile)}</span></div>
      <div class="kv"><span>Repo</span><span>${esc(c.owner)}/${esc(c.repo)}</span></div>
      <div class="kv"><span>Mappe</span><span>${esc(store.basePath)}/</span></div>
      <div class="kv"><span>Status</span><span id="settings-status">${esc(store.status.message || '–')}</span></div>
    </div>
    <div class="btn-row">
      <button class="btn secondary" data-action="sync-now">Synk nå</button>
      <button class="btn secondary" data-action="switch-profile">Bytt profil</button>
    </div>
    <div class="btn-row">
      <button class="btn secondary" data-action="export-csv">Eksporter CSV</button>
      <a class="btn secondary" href="https://github.com/${esc(c.owner)}/${esc(c.repo)}/tree/${esc(c.branch || 'main')}/${esc(store.basePath)}" target="_blank" rel="noopener">Åpne i GitHub</a>
    </div>
    <button class="btn danger" data-action="logout">Logg ut på denne enheten</button>
    <p class="small muted">Alt lagres som filer i GitHub-repoet ditt: <code>data.json</code> med biler og fyllinger,
      og kvitteringene som PDF i <code>kvitteringer/</code>. Hver endring blir en commit, så hele historikken tas vare på.
      Endringer gjort uten nett lagres på telefonen og lastes opp automatisk senere.</p>`;
}

// MARK: Fylling-skjema

function previousFill(carId, date, excludeId) {
  return store.fillUps
    .filter((f) => f.carId === carId && f.id !== excludeId && f.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

function openFillSheet(existing) {
  const cars = store.cars;
  const lastCar = [...store.fillUps].sort((a, b) => b.date.localeCompare(a.date))[0]?.carId;
  const defaultCar = ui.carFilter || (cars.some((c) => c.id === lastCar) ? lastCar : cars[0]?.id);
  const f = existing ? { ...existing } : {
    id: uid(), carId: defaultCar, date: nowLocal(), liters: null, total: null, odometer: null,
    fuel: cars.find((c) => c.id === defaultCar)?.fuel || 'bensin', station: '', notes: '', receipt: null,
  };
  let receiptBlob = null; // ny kvittering som ikke er lagret ennå
  let fuelFromScan = false;

  const sheet = openSheet(`
    <div class="sheet-head">
      <button class="link" data-close>Avbryt</button>
      <h2>${existing ? 'Endre fylling' : 'Ny fylling'}</h2>
      <button class="link" id="f-save">Lagre</button>
    </div>
    <div class="sheet-body">
      <div class="section-title">Kvittering</div>
      <div class="card" id="receipt-card"></div>
      <div class="section-foot">Ta bilde av kvitteringen for å fylle ut feltene automatisk. Kontroller verdiene før du lagrer.</div>
      <input type="file" id="f-camera" accept="image/*" capture="environment" hidden>
      <input type="file" id="f-files" accept="image/*,application/pdf" multiple hidden>

      <div class="section-title">Bil</div>
      <div class="card">
        <div class="field"><label for="f-car">Bil</label>
          <select id="f-car">${cars.map((c) => `<option value="${c.id}" ${c.id === f.carId ? 'selected' : ''}>${esc(carName(c))}</option>`).join('')}</select></div>
        ${segmented('fuel', f.fuel)}
      </div>

      <div class="section-title">Fylling</div>
      <div class="card">
        <div class="field"><label for="f-date">Dato</label><input id="f-date" type="datetime-local" value="${esc(f.date)}"></div>
        <div class="field"><label for="f-liters">Antall liter</label><input id="f-liters" inputmode="decimal" placeholder="0,00" value="${fmt.input(f.liters)}"></div>
        <div class="field"><label for="f-total">Totalpris (kr)</label><input id="f-total" inputmode="decimal" placeholder="0,00" value="${fmt.input(f.total)}"></div>
        <div class="field"><label>Literpris</label><span class="value num" id="f-ppl">–</span></div>
      </div>

      <div class="section-title">Kilometerstand</div>
      <div class="card">
        <div class="field"><label for="f-odo">Km-stand</label><input id="f-odo" inputmode="numeric" placeholder="km" value="${f.odometer ?? ''}"></div>
        <div class="note info" id="f-odo-note"></div>
      </div>

      <div class="section-title">Annet</div>
      <div class="card">
        <div class="field"><label for="f-station">Stasjon</label><input id="f-station" value="${esc(f.station)}" placeholder="Valgfritt"></div>
        <div class="field"><label for="f-notes">Notat</label><textarea id="f-notes" rows="1" placeholder="Valgfritt">${esc(f.notes)}</textarea></div>
      </div>

      ${existing ? '<button class="btn danger" id="f-delete">Slett fylling</button>' : ''}
    </div>`);

  const $ = (sel) => sheet.querySelector(sel);
  const setFuel = bindSegmented(sheet, 'fuel', (v) => { f.fuel = v; });
  let ocrText = '';
  let scanNote = '';

  function renderReceiptCard() {
    const has = receiptBlob || f.receipt;
    $('#receipt-card').innerHTML = `
      <button class="row" data-pick="camera"><span class="badge bensin">📷</span><span class="grow">${has ? 'Ta nytt bilde' : 'Ta bilde av kvittering'}</span></button>
      <button class="row" data-pick="files"><span class="badge bensin">🖼️</span><span class="grow">Velg bilde eller PDF</span></button>
      ${scanNote ? `<div class="note ${scanNote.startsWith('!') ? 'warn' : 'info'}">${esc(scanNote.replace(/^!/, ''))}</div>` : ''}
      ${has ? `<button class="row" data-view-receipt><span class="badge bensin">📄</span><span class="grow">Vis kvittering (PDF)${receiptBlob ? ' <span class="muted small">– ikke lagret ennå</span>' : ''}</span><span class="chev">›</span></button>
        <button class="row" data-remove-receipt><span class="grow" style="color:var(--danger)">Fjern kvittering</span></button>` : ''}
      ${ocrText ? `<details class="ocr"><summary>Gjenkjent tekst</summary><pre>${esc(ocrText)}</pre></details>` : ''}`;
  }

  function update() {
    const liters = parseNumber($('#f-liters').value);
    const total = parseNumber($('#f-total').value);
    $('#f-ppl').textContent = liters > 0 && total > 0 ? fmt.ppl(total / liters) : '–';

    const odo = parseInt($('#f-odo').value.replace(/\D/g, ''), 10);
    const prev = previousFill($('#f-car').value, $('#f-date').value, f.id);
    const note = $('#f-odo-note');
    note.className = 'note info';
    if (prev && odo && odo <= prev.odometer) {
      note.className = 'note warn';
      note.textContent = `⚠︎ Lavere enn forrige fylling (${fmt.km(prev.odometer)}).`;
    } else if (prev && odo) {
      note.textContent = `${fmt.km(odo - prev.odometer)} siden forrige fylling.`;
    } else if (prev) {
      note.textContent = `Forrige fylling: ${fmt.km(prev.odometer)}.`;
    } else {
      note.textContent = 'Kilometerstanden står ikke på kvitteringen – les av i bilen.';
    }
    const ok = $('#f-car').value && liters > 0 && total > 0 && odo > 0;
    $('#f-save').disabled = !ok;
  }

  async function handleFiles(files) {
    if (!files?.length) return;
    overlay('Leser kvittering …');
    try {
      const result = await processReceiptFiles(files, (msg) => overlay(msg));
      receiptBlob = result.pdf;
      if (!result.text) {
        scanNote = 'PDF lagt ved. Fyll inn verdiene manuelt.';
      } else {
        ocrText = result.text.trim();
        applyParsed(parseReceipt(result.text));
      }
    } catch (e) {
      if (e.pdf) {
        receiptBlob = e.pdf;
        scanNote = '!Kunne ikke lese teksten (krever nett første gang). Kvitteringen er lagt ved – fyll inn manuelt.';
      } else {
        scanNote = `!Feil: ${e.message}`;
      }
    } finally {
      overlay(null);
      renderReceiptCard();
      update();
    }
  }

  function applyParsed(p) {
    const found = [];
    if (p.liters != null) { $('#f-liters').value = fmt.input(p.liters); found.push('liter'); }
    if (p.totalPrice != null) { $('#f-total').value = fmt.input(p.totalPrice); found.push('beløp'); }
    if (p.fuelType) { f.fuel = p.fuelType; setFuel(p.fuelType); fuelFromScan = true; found.push('drivstoff'); }
    if (p.date) { $('#f-date').value = p.date; found.push('dato'); }
    if (p.station && !$('#f-station').value) { $('#f-station').value = p.station; found.push('stasjon'); }
    scanNote = found.length
      ? `Fant ${new Intl.ListFormat('nb', { type: 'conjunction' }).format(found)}. Kontroller verdiene.`
      : '!Fant ingen verdier automatisk – fyll inn manuelt. Kvitteringen er lagt ved.';
  }

  async function save() {
    const car = cars.find((c) => c.id === $('#f-car').value);
    const item = {
      ...f,
      carId: car.id,
      date: $('#f-date').value || nowLocal(),
      liters: parseNumber($('#f-liters').value),
      total: parseNumber($('#f-total').value),
      odometer: parseInt($('#f-odo').value.replace(/\D/g, ''), 10),
      station: $('#f-station').value.trim(),
      notes: $('#f-notes').value.trim(),
    };
    const label = `${item.date.slice(0, 10)} ${car.name} ${dec2.format(item.total)} kr`;
    try {
      if (receiptBlob) {
        item.receipt = store.receiptPath(item);
        await store.queueReceipt(item.receipt, receiptBlob, `Kvittering: ${label}`);
      }
    } catch (e) {
      alert(`Kunne ikke lagre kvitteringen på enheten: ${e.message}`);
      return;
    }
    store.upsert('fillUps', item, `${existing ? 'Endret' : 'Ny'} fylling: ${label}`);
    closeSheet();
    toast('Fylling lagret');
  }

  sheet.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-close]')) closeSheet();
    else if (t.id === 'f-save') save();
    else if (t.id === 'f-delete') {
      if (confirm('Slette denne fyllingen?')) {
        store.remove('fillUps', f.id, `Slettet fylling: ${f.date.slice(0, 10)}`);
        closeSheet();
        toast('Fylling slettet');
      }
    } else if (t.dataset.pick) $(t.dataset.pick === 'camera' ? '#f-camera' : '#f-files').click();
    else if (t.matches('[data-view-receipt]')) openReceipt(receiptBlob || f.receipt, `Kvittering ${f.date.slice(0, 10)}`);
    else if (t.matches('[data-remove-receipt]')) {
      receiptBlob = null;
      f.receipt = null;
      scanNote = '';
      ocrText = '';
      renderReceiptCard();
    }
  });
  for (const id of ['#f-camera', '#f-files']) {
    $(id).addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  }
  sheet.addEventListener('input', update);
  $('#f-car').addEventListener('change', () => {
    const car = cars.find((c) => c.id === $('#f-car').value);
    if (!existing && !fuelFromScan && car) { f.fuel = car.fuel; setFuel(car.fuel); }
    update();
  });

  renderReceiptCard();
  update();
}

// MARK: Kvitteringsvisning

async function openReceipt(source, title) {
  let blob = source;
  if (typeof source === 'string') {
    overlay('Henter kvittering …');
    try {
      blob = await store.getReceipt(source);
    } catch (e) {
      overlay(null);
      alert(`Kunne ikke hente kvitteringen: ${e.message}`);
      return;
    }
    overlay(null);
  }
  const url = URL.createObjectURL(blob);
  const fileName = `${title.replace(/[^\p{L}\d -]/gu, '')}.pdf`;
  const viewer = document.createElement('div');
  viewer.className = 'sheet';
  viewer.style.zIndex = 25;
  viewer.innerHTML = `
    <div class="sheet-head"><button class="link" data-x>Lukk</button><h2>Kvittering</h2>
      <button class="link" data-share>Del</button></div>
    <div class="sheet-body">
      <iframe class="pdf-frame" src="${url}" title="Kvittering"></iframe>
      <a class="btn secondary" style="margin-top:12px" href="${url}" target="_blank" rel="noopener" download="${esc(fileName)}">Åpne / last ned PDF</a>
    </div>`;
  document.body.append(viewer);
  viewer.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) { viewer.remove(); URL.revokeObjectURL(url); }
    if (e.target.closest('[data-share]')) {
      const file = new File([blob], fileName, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title }); } catch { /* avbrutt */ }
      } else {
        viewer.querySelector('a.btn').click();
      }
    }
  });
}

// MARK: Bil-skjema

function openCarSheet(existing) {
  const car = existing ? { ...existing } : { id: uid(), name: '', plate: '', fuel: 'bensin' };
  const sheet = openSheet(`
    <div class="sheet-head">
      <button class="link" data-close>Avbryt</button>
      <h2>${existing ? 'Endre bil' : 'Ny bil'}</h2>
      <button class="link" id="c-save">Lagre</button>
    </div>
    <div class="sheet-body">
      <div class="section-title">Bil</div>
      <div class="card">
        <div class="field"><label for="c-name">Navn</label><input id="c-name" value="${esc(car.name)}" placeholder="f.eks. VW Golf"></div>
        <div class="field"><label for="c-plate">Reg.nr.</label><input id="c-plate" value="${esc(car.plate)}" placeholder="AB 12345" autocapitalize="characters"></div>
      </div>
      <div class="section-title">Standard drivstoff</div>
      <div class="card">${segmented('cfuel', car.fuel)}</div>
      <div class="section-foot">Velges automatisk når du registrerer en fylling på denne bilen.</div>
      ${existing ? '<button class="btn danger" id="c-delete">Slett bil</button>' : ''}
    </div>`);
  const $ = (sel) => sheet.querySelector(sel);
  bindSegmented(sheet, 'cfuel', (v) => { car.fuel = v; });
  const update = () => { $('#c-save').disabled = !$('#c-name').value.trim(); };
  sheet.addEventListener('input', update);
  update();

  sheet.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-close]')) closeSheet();
    if (t.id === 'c-save') {
      car.name = $('#c-name').value.trim();
      car.plate = $('#c-plate').value.trim().toUpperCase();
      store.upsert('cars', car, `${existing ? 'Endret' : 'Ny'} bil: ${car.name}`);
      closeSheet();
      toast('Bil lagret');
    }
    if (t.id === 'c-delete') {
      const fills = store.data.fillUps.filter((f) => f.carId === car.id && !f.deleted);
      if (!confirm(`Slette ${car.name}${fills.length ? ` og ${fills.length} fyllinger` : ''}?\n\nKvitteringene ligger fortsatt i GitHub-historikken.`)) return;
      const now = Date.now();
      for (const x of [...fills, store.data.cars.find((c) => c.id === car.id)]) Object.assign(x, { deleted: true, updatedAt: now });
      store.commitLocal(`Slettet bil: ${car.name}`);
      if (ui.carFilter === car.id) ui.carFilter = '';
      closeSheet();
      toast('Bil slettet');
    }
  });
}

// MARK: Innstillinger

async function switchProfile() {
  if (store.hasUnsyncedChanges && !confirm('Det finnes endringer som ikke er synkronisert ennå. De blir liggende på denne enheten og lastes opp neste gang du bruker profilen. Fortsette?')) return;
  overlay('Henter profiler …');
  let profiles = [];
  try { profiles = await listProfiles(store.client); } catch { /* frakoblet */ }
  overlay(null);
  const name = prompt(`Skriv navnet på profilen du vil bruke.${profiles.length ? `\n\nFinnes i repoet: ${profiles.join(', ')}` : ''}`, '');
  if (!name?.trim()) return;
  const config = { ...store.config, profile: name.trim() };
  saveConfig(config);
  ui.carFilter = '';
  ui.statsCar = '';
  await start(config);
  toast(`Profil: ${config.profile}`);
}

function exportCsv() {
  const cars = Object.fromEntries(store.data.cars.map((c) => [c.id, c]));
  const n = (v) => (v == null ? '' : String(v).replace('.', ','));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Dato', 'Bil', 'Reg.nr.', 'Drivstoff', 'Liter', 'Totalpris', 'Literpris', 'Km-stand', 'Stasjon', 'Notat', 'Kvittering']];
  for (const f of [...store.fillUps].sort((a, b) => a.date.localeCompare(b.date))) {
    const c = cars[f.carId];
    rows.push([f.date.replace('T', ' '), c?.name, c?.plate, FUEL[f.fuel], n(f.liters), n(f.total),
      n(f.liters > 0 ? Math.round((f.total / f.liters) * 100) / 100 : ''), f.odometer, f.station, f.notes, f.receipt || '']);
  }
  const csv = '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
  const file = new File([csv], `drivstoff-${slugify(store.config.profile)}.csv`, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file] }).catch(() => {});
  } else {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
    a.click();
  }
}

// MARK: Hendelser

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !store || el.closest('.sheet')) return;
  const action = el.dataset.action;
  if (action === 'tab') { ui.tab = el.dataset.tab; window.scrollTo(0, 0); renderMain(); }
  else if (action === 'new-fill') openFillSheet(null);
  else if (action === 'edit-fill') openFillSheet(store.fillUps.find((f) => f.id === el.dataset.id));
  else if (action === 'new-car') openCarSheet(null);
  else if (action === 'edit-car') openCarSheet(store.cars.find((c) => c.id === el.dataset.id));
  else if (action === 'sync' || action === 'sync-now') store.sync().then(() => toast(store.status.message));
  else if (action === 'switch-profile') switchProfile();
  else if (action === 'export-csv') exportCsv();
  else if (action === 'logout') {
    const warn = store.hasUnsyncedChanges ? '\n\nOBS: Noen endringer er ikke lastet opp ennå og vil bli liggende på enheten.' : '';
    if (confirm(`Fjerne GitHub-tokenet fra denne enheten?${warn}`)) {
      clearConfig();
      store = null;
      renderSetup();
    }
  }
});

document.addEventListener('change', (e) => {
  const key = e.target.dataset?.change;
  if (key === 'car-filter') { ui.carFilter = e.target.value; renderMain(); }
  if (key === 'stats-car') { ui.statsCar = e.target.value; renderMain(); }
});

window.addEventListener('online', () => store?.sync());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') store?.sync(); // hent endringer fra andre enheter
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// MARK: Oppstart

const config = loadConfig();
if (config?.token) {
  start(config).catch((e) => renderSetup(e.message));
} else {
  renderSetup();
}
