// ============================================================
// Schuldenkompass — app.js
// Bewusst als EINE Datei gehalten (kein Framework, kein Build-Schritt,
// keine Modul-Ladewasserfälle). Innerhalb klar in Abschnitte gegliedert.
// ============================================================


// ============================================================
// Formatierung (Geld, Datum, IDs)
// ============================================================
const currencyFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const numberFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const monthFmt = new Intl.NumberFormat('de-DE'); // fallback, unused directly

function euro(value) {
  const v = Number(value) || 0;
  return currencyFmt.format(v);
}

function euroCompact(value) {
  const v = Number(value) || 0;
  if (Math.abs(v) >= 1000) {
    return numberFmt.format(v / 1000) + ' Tsd. €';
  }
  return euro(v);
}

function percent(value, digits = 0) {
  const v = Number(value) || 0;
  return v.toFixed(digits).replace('.', ',') + ' %';
}

const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONATE_LANG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function monthShort(date) {
  return `${MONATE[date.getMonth()]} ${date.getFullYear()}`;
}

function monthLong(date) {
  return `${MONATE_LANG[date.getMonth()]} ${date.getFullYear()}`;
}

/** Formatiert eine Monatsanzahl als lesbaren Zeitraum, z. B. "2 Jahre, 3 Monate" */
function durationText(months) {
  if (months <= 0) return 'sofort';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'Jahr' : 'Jahre'}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? 'Monat' : 'Monate'}`);
  return parts.join(', ');
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}



// ============================================================
// Gemeinsame Helfer (von mehreren Views genutzt)
// ============================================================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function monthsFromNow(months) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

// ============================================================
// Abgeleitete Werte (Summen, freies Budget)
// ============================================================
/** Monatliches Einkommen einer einzelnen Quelle. Bei variablem Einkommen: Ø der letzten 3 geloggten Monate. */
function incomeMonthlyAmount(entry) {
  if (entry.kind === 'variabel' && entry.history && entry.history.length > 0) {
    const recent = [...entry.history].sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, 3);
    const sum = recent.reduce((s, h) => s + Number(h.amount || 0), 0);
    return sum / recent.length;
  }
  return Number(entry.amount) || 0;
}

function totalIncome(incomeList) {
  return incomeList.reduce((s, e) => s + incomeMonthlyAmount(e), 0);
}

function totalFixedCosts(fixedCosts) {
  return fixedCosts.reduce((s, f) => s + (Number(f.amount) || 0), 0);
}

/** Frei verfügbares Geld nach Fixkosten und Sicherheitspuffer — Basis für die Tilgung. */
function freeBudget(state) {
  const income = totalIncome(state.income);
  const fixed = totalFixedCosts(state.fixedCosts);
  const buffer = Number(state.settings.buffer) || 0;
  return income - fixed - buffer;
}

/** Tatsächliches Budget, das laut Einstellungen in die Tilgung fließt (kann manuell überschrieben sein). */
function tilgungsBudget(state) {
  const override = state.settings.tilgungsBudgetOverride;
  if (override !== null && override !== undefined && override !== '') {
    return Number(override);
  }
  return Math.max(0, freeBudget(state));
}

function categoryLabel(category) {
  const labels = {
    wohnen: 'Wohnen',
    versicherung: 'Versicherung',
    abo: 'Abo & Streaming',
    mobilitaet: 'Mobilität',
    sonstiges: 'Sonstiges'
  };
  return labels[category] || 'Sonstiges';
}

function debtTypeLabel(type) {
  const labels = {
    kreditkarte: 'Kreditkarte',
    kredit: 'Ratenkredit',
    dispo: 'Dispo / Girokonto',
    sonstige: 'Sonstige Schuld'
  };
  return labels[type] || 'Sonstige Schuld';
}


// ============================================================
// Visualisierung: Liniendiagramm + Kompass-Gauge
// ============================================================
// Bewusst ohne externe Chart-Bibliothek: keine CDN-Abhängigkeit, funktioniert offline
// in der installierten PWA ohne zusätzliches Gewicht.

/**
 * Zeichnet eine einfache Linie (Restschuld über die Zeit) in ein <canvas>.
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} values - Restschuld pro Monat (0 = Startpunkt inklusive)
 */
function drawBalanceLine(canvas, values, { color = '#C9A24B', fill = 'rgba(201,162,75,0.14)' } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (!values || values.length < 2) {
    ctx.fillStyle = 'rgba(237,234,226,0.4)';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.fillText('Noch keine Daten für eine Projektion.', 8, rect.height / 2);
    return;
  }

  const padTop = 10, padBottom = 20, padLeft = 4, padRight = 4;
  const w = rect.width - padLeft - padRight;
  const h = rect.height - padTop - padBottom;
  const max = Math.max(...values, 1);

  const pts = values.map((v, i) => ({
    x: padLeft + (i / (values.length - 1)) * w,
    y: padTop + h - (v / max) * h
  }));

  // Fläche unter der Linie
  ctx.beginPath();
  ctx.moveTo(pts[0].x, padTop + h);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, padTop + h);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // Linie
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Achsenbeschriftung: Start / Ende
  ctx.fillStyle = 'rgba(237,234,226,0.55)';
  ctx.font = '11px -apple-system, sans-serif';
  ctx.fillText('heute', padLeft, rect.height - 4);
  const endLabel = 'schuldenfrei';
  const endWidth = ctx.measureText(endLabel).width;
  ctx.fillText(endLabel, rect.width - padRight - endWidth, rect.height - 4);
}

/**
 * Erzeugt das SVG-Markup für den Kompass-Dial auf dem Cockpit.
 * @param {number} progressPct - 0..100, Anteil bereits getilgter Schulden
 */
function compassGaugeSVG(progressPct) {
  const pct = Math.max(0, Math.min(100, progressPct));
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const arcFraction = 0.75; // 270° Bogen, wie ein Kompass-Zifferblatt statt vollem Kreis
  const arcLength = circumference * arcFraction;
  const offset = arcLength - (pct / 100) * arcLength;
  const rotation = 135; // Start bei "unten links", 270° im Uhrzeigersinn

  return `
    <svg viewBox="0 0 200 200" class="compass-gauge" role="img" aria-label="${Math.round(pct)} Prozent der Schulden getilgt">
      <g transform="rotate(${rotation} 100 100)">
        <circle cx="100" cy="100" r="${radius}" class="compass-gauge__track"
          stroke-dasharray="${arcLength} ${circumference}" />
        <circle cx="100" cy="100" r="${radius}" class="compass-gauge__progress"
          stroke-dasharray="${arcLength} ${circumference}"
          stroke-dashoffset="${offset}" />
      </g>
    </svg>
  `;
}


// ============================================================
// Tilgungs-Engine (Avalanche / Schneeball / Hybrid)
// ============================================================
// Kernstück der App: simuliert die Tilgung aller Schulden Monat für Monat.
//
// Prinzip:
// 1. Jeden Monat wird zuerst der Zins auf die Restschuld aufgeschlagen
//    (nominal APR / 12, klassische Kreditkarten-Logik).
// 2. Dann werden die Mindestzahlungen aller offenen Schulden bezahlt.
// 3. Der Rest des monatlichen Budgets ("Extra") fließt nach einer
//    Prioritäts-Strategie in eine einzelne Schuld – sobald diese getilgt
//    ist, "rollt" der frei werdende Betrag automatisch in die nächste
//    Priorität (Schneeball-Effekt), noch im selben Monat.
//
// Drei Strategien:
//  - avalanche: höchster Zinssatz zuerst -> mathematisch optimal, spart am meisten Zinsen
//  - snowball:  kleinste Restschuld zuerst -> schnellste "Erfolgserlebnisse", psychologisch motivierend
//  - hybrid:    gewichtete Mischung aus beidem (hybridWeight 0 = reine Avalanche, 1 = reine Snowball)

const MAX_MONTHS = 600; // Sicherheitsgrenze (50 Jahre), verhindert Endlosschleifen

function cloneDebts(debts) {
  return debts.map(d => ({ ...d, balance: Number(d.balance) || 0 }));
}

function pickPriority(activeDebts, strategy, hybridWeight) {
  if (activeDebts.length === 1) return activeDebts[0];

  if (strategy === 'avalanche') {
    return activeDebts.slice().sort((a, b) => b.apr - a.apr || a.balance - b.balance)[0];
  }
  if (strategy === 'snowball') {
    return activeDebts.slice().sort((a, b) => a.balance - b.balance)[0];
  }
  // hybrid: normierter Score aus Zinssatz (Avalanche-Anteil) und inverser Restschuld (Snowball-Anteil)
  const maxApr = Math.max(...activeDebts.map(d => d.apr), 0.0001);
  const maxBal = Math.max(...activeDebts.map(d => d.balance), 0.0001);
  return activeDebts
    .map(d => {
      const aprScore = d.apr / maxApr;
      const balScore = 1 - d.balance / maxBal;
      const score = hybridWeight * balScore + (1 - hybridWeight) * aprScore;
      return { d, score };
    })
    .sort((a, b) => b.score - a.score)[0].d;
}

/**
 * Simuliert die vollständige Tilgung.
 * @param {Array} debtsInput - [{id, name, apr, minPayment, balance}]
 * @param {number} monthlyBudget - Gesamtbetrag pro Monat für alle Schulden zusammen (Mindestzahlungen + Extra)
 * @param {string} strategy - 'avalanche' | 'snowball' | 'hybrid'
 * @param {number} hybridWeight - 0..1, nur relevant bei strategy 'hybrid'
 */
function simulatePayoff(debtsInput, monthlyBudget, strategy = 'avalanche', hybridWeight = 0.3) {
  const debts = cloneDebts(debtsInput);
  const startTotal = debts.reduce((s, d) => s + d.balance, 0);

  if (debts.length === 0 || startTotal <= 0.01) {
    return { months: 0, totalInterest: 0, schedule: [], insufficientBudget: false, payoffOrder: [], startTotal: 0, reachedZero: true };
  }

  const initialSumMin = debts.reduce((s, d) => s + Math.min(d.minPayment, d.balance), 0);
  const insufficientBudget = monthlyBudget + 0.005 < initialSumMin;

  let month = 0;
  let totalInterest = 0;
  const schedule = [];
  const payoffOrder = [];

  while (debts.some(d => d.balance > 0.01) && month < MAX_MONTHS) {
    month++;
    const balanceBefore = debts.reduce((s, d) => s + d.balance, 0);

    // 1) Zinsen
    let monthInterest = 0;
    for (const d of debts) {
      if (d.balance > 0.01) {
        const interest = d.balance * (d.apr / 100 / 12);
        d.balance += interest;
        monthInterest += interest;
      }
    }
    totalInterest += monthInterest;

    // 2) Mindestzahlungen
    let budgetLeft = monthlyBudget;
    for (const d of debts) {
      if (d.balance > 0.01) {
        const pay = Math.min(d.minPayment, d.balance, Math.max(budgetLeft, 0));
        d.balance -= pay;
        budgetLeft -= pay;
      }
    }
    if (budgetLeft < 0) budgetLeft = 0;

    // 3) Extra-Betrag nach Priorität, mit Schneeball-Rollover im selben Monat
    let safety = 0;
    while (budgetLeft > 0.01 && debts.some(d => d.balance > 0.01) && safety < debts.length + 5) {
      safety++;
      const active = debts.filter(d => d.balance > 0.01);
      const target = pickPriority(active, strategy, hybridWeight);
      const pay = Math.min(target.balance, budgetLeft);
      target.balance -= pay;
      budgetLeft -= pay;
      if (target.balance <= 0.01 && !payoffOrder.includes(target.id)) {
        payoffOrder.push(target.id);
      }
    }

    schedule.push({
      month,
      balances: Object.fromEntries(debts.map(d => [d.id, Math.max(0, Math.round(d.balance * 100) / 100)])),
      totalBalance: Math.max(0, Math.round(debts.reduce((s, d) => s + Math.max(0, d.balance), 0) * 100) / 100),
      interestPaid: Math.round(monthInterest * 100) / 100
    });

    const balanceAfter = debts.reduce((s, d) => s + Math.max(0, d.balance), 0);
    // Budget reicht nicht mal für die Zinsen -> Schulden wachsen statt zu sinken, Abbruch
    if (insufficientBudget && balanceAfter >= balanceBefore && month > 1) {
      break;
    }
  }

  return {
    months: month,
    totalInterest: Math.round(totalInterest * 100) / 100,
    schedule,
    insufficientBudget,
    payoffOrder,
    startTotal: Math.round(startTotal * 100) / 100,
    reachedZero: debts.every(d => d.balance <= 0.01)
  };
}

/**
 * Berechnet nur die Zahlungsaufteilung für den aktuellen Monat (nicht die volle Simulation).
 * Wird genutzt, um dem Nutzer einen konkreten Betrag pro Schuld für "diesen Monat" vorzuschlagen.
 * @returns {Object} { [debtId]: empfohlene Zahlung in diesem Monat }
 */
function currentMonthAllocation(debtsInput, monthlyBudget, strategy = 'avalanche', hybridWeight = 0.3) {
  const debts = cloneDebts(debtsInput);
  const payments = Object.fromEntries(debts.map(d => [d.id, 0]));

  for (const d of debts) {
    if (d.balance > 0.01) d.balance += d.balance * (d.apr / 100 / 12);
  }

  let budgetLeft = monthlyBudget;
  for (const d of debts) {
    if (d.balance > 0.01) {
      const pay = Math.min(d.minPayment, d.balance, Math.max(budgetLeft, 0));
      payments[d.id] += pay;
      d.balance -= pay;
      budgetLeft -= pay;
    }
  }
  if (budgetLeft < 0) budgetLeft = 0;

  let safety = 0;
  while (budgetLeft > 0.01 && debts.some(d => d.balance > 0.01) && safety < debts.length + 5) {
    safety++;
    const active = debts.filter(d => d.balance > 0.01);
    const target = pickPriority(active, strategy, hybridWeight);
    const pay = Math.min(target.balance, budgetLeft);
    payments[target.id] += pay;
    target.balance -= pay;
    budgetLeft -= pay;
  }

  return Object.fromEntries(Object.entries(payments).map(([id, v]) => [id, Math.round(v * 100) / 100]));
}

/** Vergleicht alle drei Strategien auf Basis derselben Schulden & desselben Budgets. */
function compareStrategies(debts, monthlyBudget, hybridWeight = 0.3) {
  return {
    avalanche: simulatePayoff(debts, monthlyBudget, 'avalanche'),
    snowball: simulatePayoff(debts, monthlyBudget, 'snowball'),
    hybrid: simulatePayoff(debts, monthlyBudget, 'hybrid', hybridWeight)
  };
}

/** Rechnet ein Zieldatum aus einer Monatsanzahl ab heute. */
function monthsToDate(months, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth() + months, 1);
  return d;
}

/** Summe aller Mindestzahlungen offener Schulden. */
function sumMinPayments(debts) {
  return debts.reduce((s, d) => s + (d.balance > 0 ? Math.min(d.minPayment, d.balance) : 0), 0);
}

/** Gesamtrestschuld über alle Schulden. */
function totalDebtBalance(debts) {
  return debts.reduce((s, d) => s + Math.max(0, d.balance), 0);
}


// ============================================================
// localStorage + JSON-Backup
// ============================================================
// Kein Server, kein Tracking, kein Sync — bewusst so gewählt für sensible Finanzdaten.

const STORAGE_KEY = 'schuldenkompass_state_v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('Konnte gespeicherte Daten nicht lesen:', err);
    return null;
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.error('Konnte Daten nicht speichern:', err);
    return false;
  }
}

function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Erzeugt eine herunterladbare JSON-Datei mit dem kompletten Datenstand (Backup). */
function exportStateAsFile(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `schuldenkompass-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Liest eine vom Nutzer ausgewählte Backup-Datei ein und liefert das geparste Objekt. */
function importStateFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        resolve(parsed);
      } catch (err) {
        reject(new Error('Die Datei enthält kein gültiges Backup-Format.'));
      }
    };
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsText(file);
  });
}


// ============================================================
// Zentraler Store (Pub/Sub)
// ============================================================
// Views abonnieren Änderungen mit subscribe() und rendern sich selbst neu.

function defaultState() {
  return {
    version: 1,
    income: [
      // { id, name, kind: 'fix' | 'variabel', amount, history: [{month:'2026-07', amount}] }
    ],
    fixedCosts: [
      // { id, name, category, amount }
    ],
    debts: [
      // { id, name, type: 'kreditkarte'|'kredit'|'sonstige', balance, apr, minPayment }
    ],
    settings: {
      strategy: 'avalanche', // 'avalanche' | 'snowball' | 'hybrid'
      hybridWeight: 0.3, // 0 = reine Avalanche, 1 = reine Snowball
      buffer: 0, // monatlicher Sicherheitspuffer, wird vom freien Budget abgezogen
      tilgungsBudgetOverride: null, // falls gesetzt: manuelles Tilgungsbudget statt automatisch berechnetem
      theme: 'dark'
    },
    paymentLog: [
      // { id, month:'2026-07', debtId, amount }
    ]
  };
}

class Store {
  constructor() {
    const loaded = loadState();
    this.state = loaded ? migrate(loaded) : defaultState();
    this.listeners = new Set();
  }

  getState() {
    return this.state;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notify() {
    saveState(this.state);
    for (const fn of this.listeners) fn(this.state);
  }

  replaceAll(newState) {
    this.state = migrate(newState);
    this._notify();
  }

  reset() {
    this.state = defaultState();
    this._notify();
  }

  // ---- Einkommen ----
  addIncome(entry) {
    this.state.income.push({ id: uid('inc'), history: [], ...entry });
    this._notify();
  }
  updateIncome(id, patch) {
    const item = this.state.income.find(i => i.id === id);
    if (item) Object.assign(item, patch);
    this._notify();
  }
  removeIncome(id) {
    this.state.income = this.state.income.filter(i => i.id !== id);
    this._notify();
  }
  logIncomeMonth(id, month, amount) {
    const item = this.state.income.find(i => i.id === id);
    if (!item) return;
    if (!item.history) item.history = [];
    const existing = item.history.find(h => h.month === month);
    if (existing) existing.amount = amount;
    else item.history.push({ month, amount });
    this._notify();
  }

  // ---- Fixkosten ----
  addFixedCost(entry) {
    this.state.fixedCosts.push({ id: uid('fix'), ...entry });
    this._notify();
  }
  updateFixedCost(id, patch) {
    const item = this.state.fixedCosts.find(i => i.id === id);
    if (item) Object.assign(item, patch);
    this._notify();
  }
  removeFixedCost(id) {
    this.state.fixedCosts = this.state.fixedCosts.filter(i => i.id !== id);
    this._notify();
  }

  // ---- Schulden ----
  addDebt(entry) {
    this.state.debts.push({ id: uid('debt'), ...entry });
    this._notify();
  }
  updateDebt(id, patch) {
    const item = this.state.debts.find(i => i.id === id);
    if (item) Object.assign(item, patch);
    this._notify();
  }
  removeDebt(id) {
    this.state.debts = this.state.debts.filter(i => i.id !== id);
    this._notify();
  }

  // ---- Einstellungen ----
  updateSettings(patch) {
    Object.assign(this.state.settings, patch);
    this._notify();
  }

  // ---- Zahlungs-Log (tatsächlich geleistete Zahlungen, zum Abhaken) ----
  logPayment(month, debtId, amount) {
    this.state.paymentLog.push({ id: uid('pay'), month, debtId, amount });
    this._notify();
  }
  removePaymentLog(id) {
    this.state.paymentLog = this.state.paymentLog.filter(p => p.id !== id);
    this._notify();
  }
}

function migrate(state) {
  // Platz für künftige Migrationen zwischen Datenversionen.
  const base = defaultState();
  return {
    ...base,
    ...state,
    settings: { ...base.settings, ...(state.settings || {}) }
  };
}

const store = new Store();


// ============================================================
// UI-Hilfen: Bottom-Sheet, Bestätigung, Toast
// ============================================================
// Bewusst ohne natives confirm()/alert(): in als Home-Screen-App installierten PWAs
// verhalten sich diese auf iOS inkonsistent, ein eigenes Sheet ist zuverlässiger.

const modalRoot = () => document.getElementById('modal-root');

function openSheet(title, bodyHTML, { onMount, wide = false } = {}) {
  closeSheet();
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet__handle"></div>
      <div class="sheet__header">
        <h2 class="sheet__title">${title}</h2>
        <button class="icon-btn" data-close-sheet aria-label="Schließen">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="sheet__body">${bodyHTML}</div>
    </div>
  `;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeSheet();
  });
  backdrop.querySelector('[data-close-sheet]').addEventListener('click', closeSheet);
  modalRoot().appendChild(backdrop);
  if (onMount) onMount(backdrop.querySelector('.sheet'));
  return backdrop;
}

function closeSheet() {
  modalRoot().innerHTML = '';
}

function confirmAction(message, { confirmLabel = 'Löschen', danger = true } = {}) {
  return new Promise((resolve) => {
    const body = `
      <p style="color:var(--text-dim); font-size:14.5px; line-height:1.5; margin-bottom:18px;">${message}</p>
      <div style="display:flex; gap:10px;">
        <button class="btn btn--secondary" style="flex:1" data-action="cancel">Abbrechen</button>
        <button class="btn ${danger ? '' : 'btn--primary'}" style="flex:1; ${danger ? 'background:var(--danger); color:#fff;' : ''}" data-action="confirm">${confirmLabel}</button>
      </div>
    `;
    const sheet = openSheet('Bist du sicher?', body);
    sheet.querySelector('[data-action="cancel"]').addEventListener('click', () => {
      closeSheet();
      resolve(false);
    });
    sheet.querySelector('[data-action="confirm"]').addEventListener('click', () => {
      closeSheet();
      resolve(true);
    });
  });
}

let toastTimer = null;
function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = `
      position: fixed; left: 50%; bottom: calc(90px + env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%); background: var(--surface-raised); color: var(--text);
      padding: 10px 18px; border-radius: 999px; font-size: 13.5px; box-shadow: var(--shadow);
      border: 1px solid var(--border-strong); z-index: 60; opacity: 0; transition: opacity 0.2s;
      pointer-events: none;
    `;
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1800);
}


// ============================================================
// View: Cockpit
// ============================================================
function renderCockpit(container, state) {
  const debts = state.debts;
  const currentTotal = totalDebtBalance(debts);
  const startingTotal = debts.reduce((s, d) => s + (Number(d.startingBalance) || Number(d.balance) || 0), 0);
  const paidOffPct = startingTotal > 0 ? ((startingTotal - currentTotal) / startingTotal) * 100 : (debts.length === 0 ? 0 : 100);

  const income = totalIncome(state.income);
  const fixed = totalFixedCosts(state.fixedCosts);
  const budget = tilgungsBudget(state);
  const minSum = sumMinPayments(debts);

  const hasDebts = debts.length > 0;
  const hasIncomeData = state.income.length > 0 || state.fixedCosts.length > 0;

  let sim = null;
  if (hasDebts && budget > 0) {
    sim = simulatePayoff(debts, budget, state.settings.strategy, state.settings.hybridWeight);
  }

  container.innerHTML = `
    <div class="cockpit-hero">
      <div class="cockpit-hero__gauge-wrap">
        ${compassGaugeSVG(hasDebts ? paidOffPct : 100)}
        <div class="cockpit-hero__center">
          <div class="cockpit-hero__pct tabular">${hasDebts ? Math.round(paidOffPct) + '\u00A0%' : '—'}</div>
          <div class="cockpit-hero__label">${hasDebts ? 'bereits getilgt' : 'noch keine Schulden erfasst'}</div>
        </div>
      </div>
    </div>

    ${!hasDebts ? `
      <div class="empty-state">
        <div class="empty-state__icon">⟡</div>
        <p>Trag zuerst deine Schulden ein, damit dein Kompass einen Kurs berechnen kann.</p>
        <button class="btn btn--primary" style="margin-top:14px; width:auto; padding-left:22px; padding-right:22px;" data-goto="debts">Schulden erfassen</button>
      </div>
    ` : `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card__label">Restschuld gesamt</div>
          <div class="stat-card__value stat-card__value--danger tabular">${euro(currentTotal)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Schuldenfrei ab</div>
          <div class="stat-card__value tabular">${sim && sim.reachedZero ? monthLong(monthsFromNow(sim.months)) : '—'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Tilgungsbudget / Monat</div>
          <div class="stat-card__value stat-card__value--good tabular">${euro(budget)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Zinsen bis Schuldenfreiheit</div>
          <div class="stat-card__value tabular">${sim ? euro(sim.totalInterest) : '—'}</div>
        </div>
      </div>

      ${sim && sim.insufficientBudget ? `
        <div class="callout callout--danger" style="margin-top:14px;">
          <strong>Achtung:</strong> Dein aktuelles Budget von ${euro(budget)} deckt nicht einmal die Mindestzahlungen von ${euro(minSum)}. So wächst deine Schuld weiter, statt zu sinken. Prüf deine Fixkosten oder sprich mit dem Anbieter über die Mindestrate.
        </div>
      ` : ''}

      ${sim && !sim.insufficientBudget && sim.months >= 600 ? `
        <div class="callout callout--danger" style="margin-top:14px;">
          Bei diesem Budget dauert die Tilgung sehr lange (über 50 Jahre). Schon eine kleine Erhöhung des monatlichen Betrags würde enorm helfen — schau dir den "Was-wäre-wenn"-Rechner im Tab <strong>Plan</strong> an.
        </div>
      ` : ''}

      <div class="section-title">Restschuld-Prognose</div>
      <div class="card">
        <div class="chart-wrap">
          <canvas id="cockpit-chart"></canvas>
        </div>
      </div>
    `}

    ${hasIncomeData ? `
      <div class="section-title">Monatliche Übersicht</div>
      <div class="card stack">
        <div class="row"><span class="row-label">Einkommen</span><span class="row-value tabular">${euro(income)}</span></div>
        <div class="row"><span class="row-label">Fixkosten</span><span class="row-value tabular">− ${euro(fixed)}</span></div>
        <div class="row"><span class="row-label">Sicherheitspuffer</span><span class="row-value tabular">− ${euro(state.settings.buffer || 0)}</span></div>
        <div class="row" style="border-top:1px solid var(--border); padding-top:10px; margin-top:2px;">
          <span class="row-label" style="font-weight:600; color:var(--text)">Frei für Tilgung</span>
          <span class="row-value tabular" style="color:var(--accent)">${euro(freeBudget(state))}</span>
        </div>
      </div>
    ` : `
      <div class="section-title">Monatliche Übersicht</div>
      <div class="empty-state">
        <p>Erfasse dein Einkommen und deine Fixkosten, damit dein Kompass dein monatliches Tilgungsbudget berechnen kann.</p>
      </div>
    `}
  `;

  if (hasDebts) {
    const canvas = container.querySelector('#cockpit-chart');
    if (canvas && sim) {
      const values = [currentTotal, ...sim.schedule.map(s => s.totalBalance)];
      drawBalanceLine(canvas, values);
    } else if (canvas) {
      drawBalanceLine(canvas, [currentTotal, currentTotal]);
    }
  }

  container.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector(`.tabbar__item[data-tab="${btn.dataset.goto}"]`)?.click();
    });
  });
}


// ============================================================
// View: Einkommen
// ============================================================
let expandedHistoryId = null;

function renderIncome(container, state) {
  const items = state.income;

  container.innerHTML = `
    <div class="section-title">Einkommen</div>
    ${items.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state__icon">✦</div>
        <p>Noch keine Einkommensquelle erfasst. Leg los — auch unregelmäßige Einnahmen wie dein Handy-Flipping kannst du als "variabel" eintragen.</p>
      </div>
    ` : `
      <div class="card stack" style="padding:8px 12px;">
        ${items.map(item => renderIncomeItem(item)).join('<div style="height:1px; background:var(--border); margin: 2px 0;"></div>')}
      </div>
      <div class="card" style="margin-top:12px;">
        <div class="row">
          <span class="row-label" style="font-weight:600; color:var(--text)">Gesamt / Monat</span>
          <span class="row-value tabular" style="color:var(--accent); font-size:17px;">${euro(totalIncome(items))}</span>
        </div>
      </div>
    `}

    <button class="fab-add" id="add-income-btn">+ Einkommensquelle hinzufügen</button>

    <div class="callout callout--accent" style="margin-top:16px;">
      <strong>Tipp:</strong> Schwankt dein Einkommen (z. B. durch Handy-Flipping)? Wähle "variabel" und trag jeden Monat den tatsächlichen Betrag ein. Der Kompass rechnet dann automatisch mit dem Schnitt der letzten drei Monate — realistischer als ein geschätzter Fixwert.
    </div>
  `;

  container.querySelector('#add-income-btn').addEventListener('click', () => openIncomeForm());

  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openIncomeForm(btn.dataset.edit));
  });
  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = items.find(i => i.id === btn.dataset.delete);
      const ok = await confirmAction(`"${item.name}" wirklich löschen?`);
      if (ok) {
        store.removeIncome(btn.dataset.delete);
        toast('Gelöscht');
      }
    });
  });
  container.querySelectorAll('[data-history]').forEach(btn => {
    btn.addEventListener('click', () => {
      expandedHistoryId = expandedHistoryId === btn.dataset.history ? null : btn.dataset.history;
      renderIncome(container, store.getState());
    });
  });
  container.querySelectorAll('[data-log-month]').forEach(btn => {
    btn.addEventListener('click', () => openMonthLogForm(btn.dataset.logMonth));
  });
}

function renderIncomeItem(item) {
  const monthly = incomeMonthlyAmount(item);
  const isVariable = item.kind === 'variabel';
  const historyOpen = expandedHistoryId === item.id;
  const sortedHistory = isVariable ? [...(item.history || [])].sort((a, b) => (a.month < b.month ? 1 : -1)) : [];

  return `
    <div>
      <div class="item-card" style="padding:8px 2px;">
        <div class="item-card__main">
          <div class="item-card__name">${escapeHtml(item.name)}</div>
          <div class="item-card__meta">
            ${isVariable ? `variabel · Ø letzte ${Math.min(sortedHistory.length, 3) || 0} Mon.` : 'fix, monatlich'}
          </div>
        </div>
        <div class="item-card__amount tabular">${euro(monthly)}</div>
        <div class="item-card__actions">
          ${isVariable ? `<button class="icon-btn" data-history="${item.id}" title="Verlauf" aria-label="Verlauf anzeigen"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/><path d="M12 8v4l3 2"/></svg></button>` : ''}
          <button class="icon-btn" data-edit="${item.id}" aria-label="Bearbeiten"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
          <button class="icon-btn" data-delete="${item.id}" aria-label="Löschen"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/></svg></button>
        </div>
      </div>
      ${isVariable ? `
        <div style="padding: 0 2px 8px;">
          <button class="btn btn--ghost btn--sm" data-log-month="${item.id}">+ Monat eintragen</button>
        </div>
      ` : ''}
      ${historyOpen ? `
        <div style="padding: 0 2px 12px; display:flex; flex-direction:column; gap:6px;">
          ${sortedHistory.length === 0 ? `<div class="field-hint">Noch keine Monate eingetragen.</div>` :
            sortedHistory.map(h => `
              <div class="row" style="font-size:13px;">
                <span class="row-label">${monthShort(new Date(h.month + '-01'))}</span>
                <span class="tabular">${euro(h.amount)}</span>
              </div>
            `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function openIncomeForm(id = null) {
  const state = store.getState();
  const existing = id ? state.income.find(i => i.id === id) : null;

  const body = `
    <div class="field">
      <label for="f-name">Bezeichnung</label>
      <input id="f-name" type="text" placeholder="z. B. Nebenjob, Handy-Flipping" value="${existing ? escapeHtml(existing.name) : ''}" />
    </div>
    <div class="field">
      <label>Art</label>
      <div class="segmented" id="f-kind">
        <button type="button" data-val="fix" class="${(!existing || existing.kind === 'fix') ? 'active' : ''}">Fix</button>
        <button type="button" data-val="variabel" class="${existing && existing.kind === 'variabel' ? 'active' : ''}">Variabel</button>
      </div>
      <div class="field-hint">Fix: gleicher Betrag jeden Monat. Variabel: schwankt, z. B. Verkaufserlöse.</div>
    </div>
    <div class="field">
      <label for="f-amount" id="f-amount-label">${existing && existing.kind === 'variabel' ? 'Geschätzter Betrag (bis genug Verlaufsdaten da sind)' : 'Monatlicher Betrag'}</label>
      <input id="f-amount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0,00" value="${existing ? existing.amount ?? '' : ''}" />
    </div>
    <button class="btn btn--primary" id="f-save">${existing ? 'Speichern' : 'Hinzufügen'}</button>
  `;

  const sheet = openSheet(existing ? 'Einkommen bearbeiten' : 'Einkommen hinzufügen', body);
  let selectedKind = existing ? existing.kind : 'fix';

  sheet.querySelector('#f-kind').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    selectedKind = btn.dataset.val;
    sheet.querySelectorAll('#f-kind button').forEach(b => b.classList.toggle('active', b === btn));
    sheet.querySelector('#f-amount-label').textContent = selectedKind === 'variabel'
      ? 'Geschätzter Betrag (bis genug Verlaufsdaten da sind)'
      : 'Monatlicher Betrag';
  });

  sheet.querySelector('#f-save').addEventListener('click', () => {
    const name = sheet.querySelector('#f-name').value.trim();
    const amount = parseFloat(sheet.querySelector('#f-amount').value.replace(',', '.')) || 0;
    if (!name) { toast('Bitte einen Namen eingeben'); return; }

    if (existing) {
      store.updateIncome(existing.id, { name, kind: selectedKind, amount });
    } else {
      store.addIncome({ name, kind: selectedKind, amount, history: [] });
    }
    closeSheet();
    toast('Gespeichert');
  });
}

function openMonthLogForm(incomeId) {
  const state = store.getState();
  const item = state.income.find(i => i.id === incomeId);
  if (!item) return;
  const month = currentMonthKey();
  const existingEntry = (item.history || []).find(h => h.month === month);

  const body = `
    <div class="field">
      <label>Monat</label>
      <input type="text" value="${monthShort(new Date(month + '-01'))}" disabled />
    </div>
    <div class="field">
      <label for="f-log-amount">Tatsächlicher Betrag</label>
      <input id="f-log-amount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0,00" value="${existingEntry ? existingEntry.amount : ''}" autofocus />
    </div>
    <button class="btn btn--primary" id="f-log-save">Eintragen</button>
  `;
  const sheet = openSheet(`${item.name}: diesen Monat`, body);
  sheet.querySelector('#f-log-amount').focus();
  sheet.querySelector('#f-log-save').addEventListener('click', () => {
    const amount = parseFloat(sheet.querySelector('#f-log-amount').value.replace(',', '.')) || 0;
    store.logIncomeMonth(incomeId, month, amount);
    closeSheet();
    toast('Monat eingetragen');
  });
}


// ============================================================
// View: Fixkosten
// ============================================================
const CATEGORIES = ['wohnen', 'versicherung', 'abo', 'mobilitaet', 'sonstiges'];

function renderFixedCosts(container, state) {
  const items = state.fixedCosts;
  const grouped = CATEGORIES.map(cat => ({
    cat,
    items: items.filter(i => (i.category || 'sonstiges') === cat)
  })).filter(g => g.items.length > 0);

  container.innerHTML = `
    <div class="section-title">Fixkosten</div>
    ${items.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state__icon">▤</div>
        <p>Trag deine monatlichen Fixkosten ein — Miete, Versicherungen, Abos. Alles, was jeden Monat sicher weg ist, bevor du an Tilgung denken kannst.</p>
      </div>
    ` : `
      ${grouped.map(g => `
        <div class="card stack" style="padding:8px 12px; margin-bottom:10px;">
          <div class="field-hint" style="margin: 4px 0 -2px;">${categoryLabel(g.cat)}</div>
          ${g.items.map(item => renderFixedItem(item)).join('<div style="height:1px; background:var(--border);"></div>')}
        </div>
      `).join('')}
      <div class="card">
        <div class="row">
          <span class="row-label" style="font-weight:600; color:var(--text)">Gesamt / Monat</span>
          <span class="row-value tabular" style="color:var(--danger); font-size:17px;">${euro(totalFixedCosts(items))}</span>
        </div>
      </div>
    `}
    <button class="fab-add" id="add-fixed-btn">+ Fixkosten hinzufügen</button>
  `;

  container.querySelector('#add-fixed-btn').addEventListener('click', () => openFixedForm());
  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openFixedForm(btn.dataset.edit));
  });
  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = items.find(i => i.id === btn.dataset.delete);
      const ok = await confirmAction(`"${item.name}" wirklich löschen?`);
      if (ok) {
        store.removeFixedCost(btn.dataset.delete);
        toast('Gelöscht');
      }
    });
  });
}

function renderFixedItem(item) {
  return `
    <div class="item-card" style="padding:8px 2px;">
      <div class="item-card__main">
        <div class="item-card__name">${escapeHtml(item.name)}</div>
      </div>
      <div class="item-card__amount tabular">${euro(item.amount)}</div>
      <div class="item-card__actions">
        <button class="icon-btn" data-edit="${item.id}" aria-label="Bearbeiten"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
        <button class="icon-btn" data-delete="${item.id}" aria-label="Löschen"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/></svg></button>
      </div>
    </div>
  `;
}

function openFixedForm(id = null) {
  const state = store.getState();
  const existing = id ? state.fixedCosts.find(i => i.id === id) : null;

  const body = `
    <div class="field">
      <label for="f-name">Bezeichnung</label>
      <input id="f-name" type="text" placeholder="z. B. Miete, Handyvertrag" value="${existing ? escapeHtml(existing.name) : ''}" />
    </div>
    <div class="field">
      <label for="f-category">Kategorie</label>
      <select id="f-category">
        ${CATEGORIES.map(c => `<option value="${c}" ${existing && existing.category === c ? 'selected' : ''}>${categoryLabel(c)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="f-amount">Monatlicher Betrag</label>
      <input id="f-amount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0,00" value="${existing ? existing.amount ?? '' : ''}" />
    </div>
    <button class="btn btn--primary" id="f-save">${existing ? 'Speichern' : 'Hinzufügen'}</button>
  `;

  const sheet = openSheet(existing ? 'Fixkosten bearbeiten' : 'Fixkosten hinzufügen', body);
  sheet.querySelector('#f-save').addEventListener('click', () => {
    const name = sheet.querySelector('#f-name').value.trim();
    const category = sheet.querySelector('#f-category').value;
    const amount = parseFloat(sheet.querySelector('#f-amount').value.replace(',', '.')) || 0;
    if (!name) { toast('Bitte einen Namen eingeben'); return; }

    if (existing) {
      store.updateFixedCost(existing.id, { name, category, amount });
    } else {
      store.addFixedCost({ name, category, amount });
    }
    closeSheet();
    toast('Gespeichert');
  });
}


// ============================================================
// View: Schulden
// ============================================================
const TYPES = ['kreditkarte', 'kredit', 'dispo', 'sonstige'];

function renderDebts(container, state) {
  const items = state.debts;

  container.innerHTML = `
    <div class="section-title">Schulden</div>
    ${items.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state__icon">◈</div>
        <p>Erfasse jede Schuld einzeln — Kreditkarte, Ratenkredit, Dispo. Je genauer Zinssatz und Mindestrate, desto besser der Plan.</p>
      </div>
    ` : `
      <div class="stack">
        ${items.map(item => renderDebtItem(item)).join('')}
      </div>
      <div class="card" style="margin-top:12px;">
        <div class="stack">
          <div class="row"><span class="row-label">Gesamtschuld</span><span class="row-value tabular" style="color:var(--danger)">${euro(totalDebtBalance(items))}</span></div>
          <div class="row"><span class="row-label">Summe Mindestzahlungen / Monat</span><span class="row-value tabular">${euro(sumMinPayments(items))}</span></div>
        </div>
      </div>
    `}
    <button class="fab-add" id="add-debt-btn">+ Schuld hinzufügen</button>
  `;

  container.querySelector('#add-debt-btn').addEventListener('click', () => openDebtForm());
  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openDebtForm(btn.dataset.edit));
  });
  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = items.find(i => i.id === btn.dataset.delete);
      const ok = await confirmAction(`"${item.name}" wirklich löschen? Der Tilgungsplan wird danach ohne diese Schuld neu berechnet.`);
      if (ok) {
        store.removeDebt(btn.dataset.delete);
        toast('Gelöscht');
      }
    });
  });
}

function renderDebtItem(item) {
  return `
    <div class="card">
      <div class="row" style="align-items:flex-start;">
        <div class="item-card__main">
          <div class="item-card__name">${escapeHtml(item.name)}</div>
          <div class="item-card__meta">
            <span class="pill" style="margin-top:4px;">${debtTypeLabel(item.type)}</span>
          </div>
        </div>
        <div class="item-card__actions">
          <button class="icon-btn" data-edit="${item.id}" aria-label="Bearbeiten"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
          <button class="icon-btn" data-delete="${item.id}" aria-label="Löschen"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/></svg></button>
        </div>
      </div>
      <div class="stat-grid" style="margin-top:12px;">
        <div>
          <div class="stat-card__label">Restschuld</div>
          <div class="row-value tabular" style="font-size:16px;">${euro(item.balance)}</div>
        </div>
        <div>
          <div class="stat-card__label">Zinssatz p. a.</div>
          <div class="row-value tabular" style="font-size:16px;">${percent(item.apr, 1)}</div>
        </div>
        <div>
          <div class="stat-card__label">Mindestrate / Monat</div>
          <div class="row-value tabular" style="font-size:16px;">${euro(item.minPayment)}</div>
        </div>
      </div>
    </div>
  `;
}

function openDebtForm(id = null) {
  const state = store.getState();
  const existing = id ? state.debts.find(i => i.id === id) : null;

  const body = `
    <div class="field">
      <label for="f-name">Bezeichnung</label>
      <input id="f-name" type="text" placeholder="z. B. Kreditkarte Comdirect" value="${existing ? escapeHtml(existing.name) : ''}" />
    </div>
    <div class="field">
      <label for="f-type">Art</label>
      <select id="f-type">
        ${TYPES.map(t => `<option value="${t}" ${existing && existing.type === t ? 'selected' : ''}>${debtTypeLabel(t)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="f-balance">Aktuelle Restschuld</label>
      <input id="f-balance" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0,00" value="${existing ? existing.balance ?? '' : ''}" />
    </div>
    <div class="field-row">
      <div class="field">
        <label for="f-apr">Zinssatz p. a. (%)</label>
        <input id="f-apr" type="number" inputmode="decimal" min="0" step="0.01" placeholder="z. B. 19,9" value="${existing ? existing.apr ?? '' : ''}" />
      </div>
      <div class="field">
        <label for="f-min">Mindestrate / Monat</label>
        <input id="f-min" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0,00" value="${existing ? existing.minPayment ?? '' : ''}" />
      </div>
    </div>
    <div class="field-hint" style="margin-bottom:14px;">
      Den Zinssatz findest du im Kreditkartenvertrag oder in der Abrechnung ("effektiver/nominaler Jahreszins"). Bei Unsicherheit: lieber etwas höher schätzen als zu niedrig.
    </div>
    <button class="btn btn--primary" id="f-save">${existing ? 'Speichern' : 'Hinzufügen'}</button>
  `;

  const sheet = openSheet(existing ? 'Schuld bearbeiten' : 'Schuld hinzufügen', body);
  sheet.querySelector('#f-save').addEventListener('click', () => {
    const name = sheet.querySelector('#f-name').value.trim();
    const type = sheet.querySelector('#f-type').value;
    const balance = parseFloat(sheet.querySelector('#f-balance').value.replace(',', '.')) || 0;
    const apr = parseFloat(sheet.querySelector('#f-apr').value.replace(',', '.')) || 0;
    const minPayment = parseFloat(sheet.querySelector('#f-min').value.replace(',', '.')) || 0;
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    if (balance <= 0) { toast('Bitte eine Restschuld größer als 0 eingeben'); return; }

    if (existing) {
      store.updateDebt(existing.id, { name, type, balance, apr, minPayment });
    } else {
      store.addDebt({ name, type, balance, apr, minPayment, startingBalance: balance });
    }
    closeSheet();
    toast('Gespeichert');
  });
}


// ============================================================
// View: Tilgungsplan
// ============================================================
const STRATEGY_INFO = {
  avalanche: {
    label: 'Avalanche',
    desc: 'Tilgt zuerst die Schuld mit dem höchsten Zinssatz. Mathematisch optimal — über die gesamte Laufzeit zahlst du am wenigsten Zinsen.'
  },
  snowball: {
    label: 'Schneeball',
    desc: 'Tilgt zuerst die kleinste Restschuld. Du hast schneller ein Erfolgserlebnis — motivierend, kostet über die Laufzeit meist etwas mehr Zinsen.'
  },
  hybrid: {
    label: 'Hybrid',
    desc: 'Mischung aus beidem. Der Regler bestimmt die Gewichtung: links spart mehr Zinsen, rechts bringt schnellere Etappensiege.'
  }
};

function renderPlan(container, state) {
  const debts = state.debts;

  if (debts.length === 0) {
    container.innerHTML = `
      <div class="section-title">Tilgungsplan</div>
      <div class="empty-state">
        <div class="empty-state__icon">➤</div>
        <p>Sobald du mindestens eine Schuld erfasst hast, berechnet der Kompass hier deinen Tilgungsplan.</p>
        <button class="btn btn--primary" style="margin-top:14px; width:auto; padding-left:22px; padding-right:22px;" id="goto-debts">Schulden erfassen</button>
      </div>
    `;
    container.querySelector('#goto-debts').addEventListener('click', () => {
      document.querySelector('.tabbar__item[data-tab="debts"]')?.click();
    });
    return;
  }

  const strategy = state.settings.strategy;
  const hybridWeight = state.settings.hybridWeight;
  const recommendedBudget = Math.max(0, freeBudget(state));
  const budget = tilgungsBudget(state);
  const minSum = sumMinPayments(debts);
  const month = currentMonthKey();

  container.innerHTML = `
    <div class="section-title">Strategie</div>
    <div class="card">
      <div class="segmented" id="strategy-picker">
        ${Object.entries(STRATEGY_INFO).map(([key, info]) => `
          <button type="button" data-strategy="${key}" class="${strategy === key ? 'active' : ''}">${info.label}</button>
        `).join('')}
      </div>
      <p class="field-hint" id="strategy-desc" style="margin-top:10px; line-height:1.5;">${STRATEGY_INFO[strategy].desc}</p>
      <div id="hybrid-slider-wrap" style="margin-top:14px; ${strategy === 'hybrid' ? '' : 'display:none;'}">
        <div class="row" style="margin-bottom:6px;">
          <span class="field-hint">Zinsersparnis</span>
          <span class="field-hint" id="hybrid-weight-label">${Math.round(hybridWeight * 100)} %</span>
          <span class="field-hint">Schnelle Erfolge</span>
        </div>
        <div class="slider-field">
          <input type="range" id="hybrid-slider" min="0" max="100" step="5" value="${Math.round(hybridWeight * 100)}" />
        </div>
      </div>
    </div>

    <div class="section-title">Monatliches Tilgungsbudget</div>
    <div class="card">
      <div class="field" style="margin-bottom:8px;">
        <label for="budget-input">Betrag pro Monat</label>
        <input id="budget-input" type="number" inputmode="decimal" min="0" step="10" value="${budget.toFixed(2)}" />
      </div>
      <div class="row">
        <span class="field-hint">Empfohlen (Einkommen − Fixkosten − Puffer): ${euro(recommendedBudget)}</span>
        <button class="btn btn--ghost btn--sm" id="reset-budget-btn" style="padding:2px 0;">Zurücksetzen</button>
      </div>
    </div>

    <div id="insufficient-warning"></div>

    <div class="section-title">Ergebnis</div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-card__label">Schuldenfrei in</div>
        <div class="stat-card__value tabular" id="plan-duration">–</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Schuldenfrei ab</div>
        <div class="stat-card__value tabular" id="plan-date">–</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Zinsen gesamt</div>
        <div class="stat-card__value tabular" id="plan-interest">–</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Restschuld heute</div>
        <div class="stat-card__value tabular stat-card__value--danger">${euro(totalDebtBalance(debts))}</div>
      </div>
    </div>

    <div class="section-title">Restschuld-Verlauf</div>
    <div class="card">
      <div class="chart-wrap"><canvas id="plan-chart"></canvas></div>
    </div>

    <div class="section-title">Strategievergleich bei ${euro(budget)}/Monat</div>
    <div class="card" style="overflow-x:auto;">
      <table class="strategy-table" id="strategy-table">
        <thead>
          <tr><th>Strategie</th><th>Dauer</th><th>Zinsen</th></tr>
        </thead>
        <tbody id="strategy-table-body"></tbody>
      </table>
    </div>

    <div class="section-title">Reihenfolge der Tilgung</div>
    <div class="card" id="payoff-order-card"></div>

    <div class="section-title">Diesen Monat zahlen · ${monthLong(new Date())}</div>
    <div class="stack" id="monthly-payments"></div>
  `;

  // ---- Live-Rechenkern: nutzt ggf. noch nicht gespeicherte Slider-/Eingabewerte ----
  function recalcAndPatch(liveBudget, liveHybridWeight) {
    const b = Math.max(0, liveBudget);
    const sim = simulatePayoff(debts, b, strategy, liveHybridWeight);
    const cmp = compareStrategies(debts, b, liveHybridWeight);

    if (sim.reachedZero) {
      container.querySelector('#plan-duration').textContent = durationText(sim.months);
      container.querySelector('#plan-date').textContent = monthLong(monthsFromNow(sim.months));
    } else if (sim.insufficientBudget) {
      container.querySelector('#plan-duration').textContent = 'nie';
      container.querySelector('#plan-date').textContent = '—';
    } else {
      container.querySelector('#plan-duration').textContent = '> 50 Jahre';
      container.querySelector('#plan-date').textContent = '—';
    }
    container.querySelector('#plan-interest').textContent = sim.reachedZero ? euro(sim.totalInterest) : '—';

    const warnEl = container.querySelector('#insufficient-warning');
    if (sim.insufficientBudget) {
      warnEl.innerHTML = `<div class="callout callout--danger" style="margin-bottom:14px;">Dieses Budget deckt nicht einmal die Mindestzahlungen von ${euro(minSum)}. Erhöhe den Betrag, sonst wächst die Schuld weiter.</div>`;
    } else {
      warnEl.innerHTML = '';
    }

    const canvas = container.querySelector('#plan-chart');
    if (canvas) {
      const values = [totalDebtBalance(debts), ...sim.schedule.map(s => s.totalBalance)];
      drawBalanceLine(canvas, values);
    }

    const rows = Object.entries(cmp).map(([key, res]) => ({ key, res }));
    const bestInterest = Math.min(...rows.map(r => r.res.reachedZero ? r.res.totalInterest : Infinity));
    const durationLabel = (res) => res.reachedZero ? durationText(res.months) : (res.insufficientBudget ? 'nie' : '> 50 J.');
    container.querySelector('#strategy-table-body').innerHTML = rows.map(({ key, res }) => `
      <tr class="${key === strategy ? 'selected' : ''}">
        <td>${STRATEGY_INFO[key].label}${key === strategy ? ' ✓' : ''}</td>
        <td>${durationLabel(res)}</td>
        <td>${res.reachedZero ? euro(res.totalInterest) + (res.totalInterest === bestInterest ? ' ★' : '') : '—'}</td>
      </tr>
    `).join('');

    // Reihenfolge der Tilgung mit Datum
    const orderCard = container.querySelector('#payoff-order-card');
    if (!sim.reachedZero) {
      orderCard.innerHTML = `<p class="field-hint">Bei diesem Budget lässt sich die Reihenfolge nicht sinnvoll vorhersagen — erhöh das Budget oben.</p>`;
    } else {
      const dateForDebt = {};
      for (const snap of sim.schedule) {
        for (const id of Object.keys(snap.balances)) {
          if (snap.balances[id] <= 0 && !(id in dateForDebt)) dateForDebt[id] = snap.month;
        }
      }
      orderCard.innerHTML = sim.payoffOrder.map((id, i) => {
        const d = debts.find(x => x.id === id);
        if (!d) return '';
        return `
          <div class="row" style="padding:7px 0; ${i > 0 ? 'border-top:1px solid var(--border);' : ''}">
            <span class="row-label"><span class="tabular" style="color:var(--text-faint)">${i + 1}.</span>&nbsp; ${escapeHtml(d.name)}</span>
            <span class="row-value tabular">${monthLong(monthsFromNow(dateForDebt[id] || 0))}</span>
          </div>
        `;
      }).join('');
    }

    return sim;
  }

  recalcAndPatch(budget, hybridWeight);
  renderMonthlyPayments(container, state, budget, strategy, hybridWeight, month);

  // ---- Strategie wählen (Klick, kein Drag-Problem) ----
  container.querySelector('#strategy-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    store.updateSettings({ strategy: btn.dataset.strategy });
  });

  // ---- Hybrid-Regler: live patchen während Drag, erst bei "change" speichern ----
  const hybridSlider = container.querySelector('#hybrid-slider');
  if (hybridSlider) {
    hybridSlider.addEventListener('input', () => {
      const w = Number(hybridSlider.value) / 100;
      container.querySelector('#hybrid-weight-label').textContent = `${hybridSlider.value} %`;
      recalcAndPatch(currentLiveBudget(), w);
    });
    hybridSlider.addEventListener('change', () => {
      store.updateSettings({ hybridWeight: Number(hybridSlider.value) / 100 });
    });
  }

  // ---- Budget-Eingabe: live patchen, erst bei "change"/blur speichern ----
  const budgetInput = container.querySelector('#budget-input');
  function currentLiveBudget() {
    const v = parseFloat(budgetInput.value.replace(',', '.'));
    return isNaN(v) ? 0 : v;
  }
  budgetInput.addEventListener('input', () => {
    recalcAndPatch(currentLiveBudget(), currentHybridWeight());
  });
  budgetInput.addEventListener('change', () => {
    store.updateSettings({ tilgungsBudgetOverride: currentLiveBudget() });
  });
  function currentHybridWeight() {
    return hybridSlider ? Number(hybridSlider.value) / 100 : hybridWeight;
  }

  container.querySelector('#reset-budget-btn').addEventListener('click', () => {
    store.updateSettings({ tilgungsBudgetOverride: null });
    toast('Auf empfohlenen Betrag zurückgesetzt');
  });
}

function renderMonthlyPayments(container, state, budget, strategy, hybridWeight, month) {
  const debts = state.debts;
  const allocation = currentMonthAllocation(debts, budget, strategy, hybridWeight);
  const el = container.querySelector('#monthly-payments');
  if (!el) return;

  el.innerHTML = debts.map(d => {
    const logged = state.paymentLog.find(p => p.month === month && p.debtId === d.id);
    const suggested = allocation[d.id] || 0;
    return `
      <div class="card" data-payment-card="${d.id}">
        <div class="row">
          <div class="item-card__main">
            <div class="item-card__name">${escapeHtml(d.name)}</div>
            <div class="item-card__meta">${debtTypeLabel(d.type)} · Restschuld ${euro(d.balance)}</div>
          </div>
          ${logged ? `<span class="pill pill--good">✓ ${euro(logged.amount)}</span>` : ''}
        </div>
        ${logged ? `
          <button class="btn btn--ghost btn--sm" data-undo="${d.id}" style="margin-top:6px;">Eintrag rückgängig machen</button>
        ` : `
          <div class="field-row" style="margin-top:10px; align-items:flex-end;">
            <div class="field" style="margin-bottom:0;">
              <label>Zahlung diesen Monat</label>
              <input type="number" inputmode="decimal" min="0" step="0.01" value="${suggested.toFixed(2)}" data-amount-input="${d.id}" />
            </div>
            <button class="btn btn--primary btn--sm" data-confirm-payment="${d.id}" style="height:44px;">Eintragen</button>
          </div>
        `}
      </div>
    `;
  }).join('');

  el.querySelectorAll('[data-confirm-payment]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.confirmPayment;
      const input = el.querySelector(`[data-amount-input="${id}"]`);
      const amount = parseFloat(input.value.replace(',', '.')) || 0;
      const debt = debts.find(d => d.id === id);
      if (!debt) return;
      const newBalance = Math.max(0, Number(debt.balance) - amount);
      store.updateDebt(id, { balance: newBalance });
      store.logPayment(month, id, amount);
      toast('Zahlung eingetragen');
    });
  });

  el.querySelectorAll('[data-undo]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.undo;
      const entry = state.paymentLog.find(p => p.month === month && p.debtId === id);
      if (!entry) return;
      const debt = debts.find(d => d.id === id);
      if (debt) store.updateDebt(id, { balance: Number(debt.balance) + Number(entry.amount) });
      store.removePaymentLog(entry.id);
      toast('Rückgängig gemacht');
    });
  });
}


// ============================================================
// View: Einstellungen (Sheet)
// ============================================================
function openSettingsSheet(store) {
  const state = store.getState();

  const body = `
    <div class="field">
      <label>Darstellung</label>
      <div class="segmented" id="s-theme">
        <button type="button" data-val="dark" class="${state.settings.theme !== 'light' ? 'active' : ''}">Dunkel</button>
        <button type="button" data-val="light" class="${state.settings.theme === 'light' ? 'active' : ''}">Hell</button>
      </div>
    </div>

    <div class="field">
      <label for="s-buffer">Monatlicher Sicherheitspuffer</label>
      <input id="s-buffer" type="number" inputmode="decimal" min="0" step="10" value="${state.settings.buffer || 0}" />
      <div class="field-hint">Wird vom freien Budget abgezogen, bevor der Rest zur Tilgung vorgeschlagen wird — z. B. für Rücklagen oder Unvorhergesehenes.</div>
    </div>

    <div class="field">
      <label>Daten</label>
      <div class="stack">
        <button class="btn btn--secondary btn--block" id="s-export">Backup exportieren (JSON)</button>
        <label class="btn btn--secondary btn--block" style="text-align:center;" for="s-import-file">Backup importieren</label>
        <input type="file" id="s-import-file" accept="application/json" style="display:none;" />
      </div>
      <div class="field-hint">Alle Daten liegen ausschließlich lokal auf diesem Gerät — kein Server, kein Sync. Exportiere regelmäßig ein Backup, z. B. bevor du das Gerät wechselst.</div>
    </div>

    <div class="field">
      <label>Gefahrenzone</label>
      <button class="btn btn--block" id="s-reset" style="background:var(--danger-soft); color:var(--danger);">Alle Daten löschen</button>
    </div>

    <p class="field-hint" style="text-align:center; margin-top:10px;">Schuldenkompass · lokal, werbefrei, ohne Tracking</p>
  `;

  const sheet = openSheet('Einstellungen', body);

  sheet.querySelector('#s-theme').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    sheet.querySelectorAll('#s-theme button').forEach(b => b.classList.toggle('active', b === btn));
    store.updateSettings({ theme: btn.dataset.val });
  });

  sheet.querySelector('#s-buffer').addEventListener('change', (e) => {
    const val = parseFloat(e.target.value.replace(',', '.')) || 0;
    store.updateSettings({ buffer: val });
    toast('Gespeichert');
  });

  sheet.querySelector('#s-export').addEventListener('click', () => {
    exportStateAsFile(store.getState());
    toast('Backup wird heruntergeladen …');
  });

  sheet.querySelector('#s-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = await importStateFromFile(file);
      const ok = await confirmAction('Backup importieren? Deine aktuellen Daten in dieser App werden dadurch komplett ersetzt.', { confirmLabel: 'Importieren' });
      if (ok) {
        store.replaceAll(parsed);
        toast('Backup importiert');
      }
    } catch (err) {
      toast(err.message || 'Import fehlgeschlagen');
    }
  });

  sheet.querySelector('#s-reset').addEventListener('click', async () => {
    const ok = await confirmAction('Wirklich ALLE Daten unwiderruflich löschen? Exportiere vorher am besten ein Backup.', { confirmLabel: 'Alles löschen' });
    if (ok) {
      store.reset();
      closeSheet();
      toast('Zurückgesetzt');
    }
  });
}


// ============================================================
// App-Einstieg: Tab-Routing, Wiring
// ============================================================

const TABS = {
  cockpit: renderCockpit,
  income: renderIncome,
  fixedCosts: renderFixedCosts,
  debts: renderDebts,
  plan: renderPlan
};

let currentTab = 'cockpit';
const viewEl = document.getElementById('view');
const tabbarEl = document.getElementById('tabbar');

function applyTheme() {
  const theme = store.getState().settings.theme || 'dark';
  document.body.setAttribute('data-theme', theme);
}

function renderApp() {
  applyTheme();
  const renderFn = TABS[currentTab] || renderCockpit;
  renderFn(viewEl, store.getState());

  tabbarEl.querySelectorAll('.tabbar__item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === currentTab);
  });
}

function setTab(tab) {
  if (!TABS[tab]) return;
  currentTab = tab;
  viewEl.scrollTo(0, 0);
  renderApp();
}

tabbarEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.tabbar__item');
  if (btn) setTab(btn.dataset.tab);
});

document.getElementById('settings-btn').addEventListener('click', () => {
  openSettingsSheet(store);
});

store.subscribe(renderApp);
renderApp();

// Service Worker für Offline-Nutzung registrieren (nur bei Aufruf über http/https,
// nicht bei lokalem file:// Testen — dort würde die Registrierung ohnehin fehlschlagen).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {
      // Offline-Support ist ein Extra, kein Blocker — App funktioniert auch ohne SW.
    });
  });
}
