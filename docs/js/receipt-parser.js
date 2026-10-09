// Tolker OCR-tekst fra norske drivstoffkvitteringer (Circle K, Esso, Uno-X, YX, Shell, St1 osv.).
// Kvitteringer varierer mye, så parseren bruker flere mønstre og kryssjekker
// liter × literpris mot totalbeløpet for å velge de mest sannsynlige verdiene.
// Ren JavaScript uten avhengigheter, slik at den kan testes med Node.

export const LITERS_RANGE = [0.5, 300];
export const PRICE_PER_LITER_RANGE = [5, 60];
export const TOTAL_RANGE = [1, 20000];

const inRange = (v, [min, max]) => v != null && Number.isFinite(v) && v >= min && v <= max;
const round2 = (v) => Math.round(v * 100) / 100;

// JavaScript sin \b er bare ASCII, så vi bruker egne grenser som forstår æøå.
const END = String.raw`(?![\p{L}\d])`;
const START = String.raw`(?<![\p{L}\d])`;

/** Et tall med 1–3 desimaler, f.eks. "42,31", "21.490". */
const DECIMAL = String.raw`(?<![\d.,])\d{1,4}[.,]\d{1,3}`;
/** Pengebeløp med to desimaler, ev. med tusenskille. Avvises hvis det er en del av en dato. */
const MONEY = String.raw`(?<![\d.,])(?:\d{1,3}(?:[  .]\d{3})+|\d+)[.,]\d{2}(?![.,]?\d)`;
const LITER_UNIT = String.raw`(?:liter|ltr|lit|l)${END}`;

const re = (pattern) => new RegExp(pattern, 'giu');

/** Tolker tall med komma eller punktum som desimalskille, og mellomrom/punktum som tusenskille. */
export function parseNumber(text) {
  if (text == null) return null;
  let s = String(text).trim().replace(/[\s  ]/g, '');
  if (!s) return null;
  const c = s.lastIndexOf(',');
  const d = s.lastIndexOf('.');
  if (c >= 0 && d >= 0) {
    s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (c >= 0) {
    s = s.replace(/,/g, '.');
  }
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function captures(pattern, text) {
  return [...text.matchAll(re(pattern))].map((m) => m[1]).filter((v) => v != null);
}

function moneyValues(line) {
  return [...line.matchAll(re(MONEY))].map((m) => parseNumber(m[0])).filter((v) => v != null);
}

// MARK: Literpris

const PRICE_PER_LITER_PATTERNS = [
  // "21,49 kr/l", "21,49/l", "21,49 pr. liter", "21,49 nok/ltr"
  String.raw`(${DECIMAL})\s*(?:kr|nok|,-)?\s*(?:\/|pr\.?\s*|per\s+)${LITER_UNIT}`,
  // "Pris/l: 21,49", "kr pr liter 21,49"
  String.raw`(?:pris|kr|nok)\s*(?:\/|pr\.?\s*|per\s+)\s*${LITER_UNIT}\.?\s*:?\s*(?:kr|nok)?\s*(${DECIMAL})`,
  // "Literpris 21,49", "Enhetspris 21,49"
  String.raw`(?:literpris|enhetspris|à-pris|a-pris)\s*:?\s*(?:kr|nok)?\s*(${DECIMAL})`,
  // "@ 21,49"
  String.raw`@\s*(${DECIMAL})`,
];

function findPricePerLiter(lines) {
  for (const pattern of PRICE_PER_LITER_PATTERNS) {
    for (const line of lines) {
      for (const value of captures(pattern, line)) {
        const v = parseNumber(value);
        if (inRange(v, PRICE_PER_LITER_RANGE)) return v;
      }
    }
  }
  return null;
}

function mentionsPricePerLiter(line) {
  return PRICE_PER_LITER_PATTERNS.some((p) => captures(p, line).length > 0)
    || line.includes('pris') || line.includes('kr/');
}

// MARK: Liter

function findLiters(lines) {
  // "42,31 l", "42,31 ltr", "42.31 liter" – men ikke "kr/l".
  const suffix = String.raw`(${DECIMAL})\s*${LITER_UNIT}(?!\s*\/)`;
  // "Liter: 42,31", "Volum 42,31", "Antall 42,31 l"
  const prefix = String.raw`(?:liter|ltr|volum|mengde|antall|ant\.?)\s*:?\s*(${DECIMAL})`;

  // OCR leser ofte «l» som «1», «i» eller «|»: "30,00 1 x 21,67 kr/l".
  const misread = String.raw`(${DECIMAL})\s*[1i|]\s*[x×*]\s*${DECIMAL}`;

  for (const pattern of [suffix, misread]) {
    for (const line of lines) {
      for (const value of captures(pattern, line)) {
        const v = parseNumber(value);
        if (inRange(v, LITERS_RANGE)) return v;
      }
    }
  }
  for (const line of lines) {
    if (mentionsPricePerLiter(line)) continue;
    for (const value of captures(prefix, line)) {
      const v = parseNumber(value);
      if (inRange(v, LITERS_RANGE)) return v;
    }
  }
  return null;
}

// MARK: Totalbeløp

const TOTAL_KEYWORDS = ['å betale', 'a betale', 'å betal', 'total', 'sum', 'beløp', 'belop', 'bel0p',
  'kortbeløp', 'betalt', 'kjøp', 'purchase', 'amount'];
const EXCLUDED_TOTAL_KEYWORDS = ['mva', 'moms', 'netto', 'rabatt', 'tilbake', 'veksel', 'grunnlag', 'avgift', 'vat'];

function findTotal(lines) {
  const candidates = [];
  lines.forEach((line, i) => {
    if (!TOTAL_KEYWORDS.some((k) => line.includes(k))) return;
    if (EXCLUDED_TOTAL_KEYWORDS.some((k) => line.includes(k))) return;
    let amounts = moneyValues(line);
    // OCR deler ofte opp kolonner, slik at beløpet havner på linjen under.
    if (amounts.length === 0 && i + 1 < lines.length
        && !EXCLUDED_TOTAL_KEYWORDS.some((k) => lines[i + 1].includes(k))) {
      amounts = moneyValues(lines[i + 1]);
    }
    candidates.push(...amounts.filter((v) => inRange(v, TOTAL_RANGE)));
  });
  // Totalen er normalt det største av beløpene ved nøkkelordene (sum ≥ delsum).
  return candidates.length ? Math.max(...candidates) : null;
}

// MARK: Drivstofftype

function findFuelType(lines) {
  const text = lines.join('\n');
  const diesel = [String.raw`diesel`, String.raw`${START}hvo${END}`, String.raw`${START}d-?ultra${END}`];
  if (diesel.some((p) => re(p).test(text))) return 'diesel';
  const bensin = [
    String.raw`bensin`, String.raw`blyfri`, String.raw`${START}e10${END}`, String.raw`${START}e5${END}`,
    String.raw`v-?power`,
    String.raw`${START}(?:miles|uno-?x|best|ultra|yx|ren|bensin|blyfri|super|premium|v-?power|e10|e5)\s*(?:\+|plus)?\s*(?:95|98)${END}(?![.,]\d)`,
    String.raw`oktan`, String.raw`petrol`, String.raw`gasoline`,
  ];
  if (bensin.some((p) => re(p).test(text))) return 'bensin';
  return null;
}

// MARK: Dato

/** Returnerer dato som lokal tid i formatet "YYYY-MM-DDTHH:mm" (samme som <input type="datetime-local">). */
function findDate(lines) {
  const dmy = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/u;
  const ymd = /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/u;
  const time = /(?<!\d)([01]?\d|2[0-3])[:.]([0-5]\d)(?![.,]?\d)/u;

  for (const line of lines) {
    let y, m, d, rest;
    let match = line.match(ymd);
    if (match) {
      [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    } else if ((match = line.match(dmy))) {
      [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
      if (y < 100) y += 2000;
    } else {
      continue;
    }
    rest = line.slice(0, match.index) + ' ' + line.slice(match.index + match[0].length);

    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) continue;
    // Avvis datoer som ikke finnes, f.eks. 31.02.
    const check = new Date(y, m - 1, d);
    if (check.getMonth() !== m - 1 || check.getDate() !== d) continue;

    const t = rest.match(time);
    const hh = t ? Number(t[1]) : 12;
    const mm = t ? Number(t[2]) : 0;
    const pad = (n) => String(n).padStart(2, '0');
    return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}`;
  }
  return null;
}

// MARK: Stasjon

export const KNOWN_STATIONS = ['Circle K', 'Uno-X', 'Esso', 'Shell', 'YX', 'St1', 'Best', 'Tanken',
  'Automat1', 'Driv', 'Bunker Oil', 'Haltbakk', 'Trønder Oil', 'Preem', 'Statoil', 'Uno X'];

function findStation(originalLines) {
  const text = originalLines.slice(0, 8).join('\n').toLowerCase();
  for (const name of KNOWN_STATIONS) {
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (re(`${START}${escaped}${END}`).test(text)) return name === 'Uno X' ? 'Uno-X' : name;
  }
  const generic = ['kvittering', 'receipt', 'kopi', 'salg', 'velkommen'];
  const line = originalLines.slice(0, 3).find((l) => {
    const letters = (l.match(/\p{L}/gu) || []).length;
    return letters >= 3 && !generic.some((g) => l.toLowerCase().includes(g));
  });
  return line ?? null;
}

// MARK: Kryssjekk

function reconcile(r, lines) {
  const { liters: l, pricePerLiter: p, totalPrice: t } = r;
  const has = (v) => v != null;
  const allMoney = () => lines.flatMap(moneyValues);

  if (has(l) && has(p) && !has(t)) {
    r.totalPrice = round2(l * p);
  } else if (!has(l) && has(p) && has(t)) {
    const v = round2(t / p);
    if (inRange(v, LITERS_RANGE)) r.liters = v;
  } else if (has(l) && !has(p) && has(t)) {
    const v = t / l;
    if (inRange(v, PRICE_PER_LITER_RANGE)) r.pricePerLiter = round2(v);
  } else if (has(l) && has(p) && has(t) && Math.abs(l * p - t) > 1) {
    // Totalen stemmer ikke med liter × literpris. Se om et annet beløp gjør det.
    const expected = l * p;
    const best = allMoney().sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected))[0];
    if (best != null && Math.abs(best - expected) <= 1) r.totalPrice = best;
  } else if (!has(l) && !has(p) && !has(t)) {
    // Ingen nøkkelord funnet – bruk største plausible beløp som et forslag.
    const amounts = allMoney().filter((v) => inRange(v, TOTAL_RANGE));
    r.totalPrice = amounts.length ? Math.max(...amounts) : null;
  }
}

/**
 * @param {string|string[]} input OCR-tekst eller linjer.
 * @returns {{liters:number|null, totalPrice:number|null, pricePerLiter:number|null,
 *            fuelType:'bensin'|'diesel'|null, date:string|null, station:string|null}}
 */
export function parseReceipt(input) {
  const original = (Array.isArray(input) ? input : String(input).split(/\r?\n/))
    .map((l) => l.trim())
    .filter(Boolean);
  const lines = original.map((l) => l.toLowerCase());

  const result = {
    liters: findLiters(lines),
    totalPrice: findTotal(lines),
    pricePerLiter: findPricePerLiter(lines),
    fuelType: findFuelType(lines),
    date: findDate(lines),
    station: findStation(original),
  };
  reconcile(result, lines);
  return result;
}
