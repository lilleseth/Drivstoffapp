// Nøkkeltall for en samling fyllinger. Ren logikk uten DOM, slik at den kan testes med Node.
//
// Kilometerstand er valgfri. Mangler den, estimeres kjørelengden ut fra forbruket:
// enten målt forbruk (fra fyllinger som har km-stand) eller forventet forbruk satt på bilen.
//
// Forbruk måles med «full tank-metoden»: bare mellom to fyllinger der tanken ble fylt helt opp
// er literne man fyller lik det man har brukt. Delfyllinger (full: false) imellom legges sammen
// med neste fulle tank. Fyllinger uten `full`-felt (eldre data) regnes som full tank.

/** Km-stand regnes som ukjent hvis den mangler eller er en plassholder som 0 eller 1. */
export const hasOdometer = (f) => Number.isFinite(f?.odometer) && f.odometer > 1;

/** Fylt helt opp? Mangler feltet, antas full tank. */
export const isFull = (f) => f?.full !== false;

/** Et målepunkt for forbruk: full tank med kjent km-stand. */
const isAnchor = (f) => isFull(f) && hasOdometer(f);

const byDate = (a, b) => a.date.localeCompare(b.date)
  || (hasOdometer(a) && hasOdometer(b) ? a.odometer - b.odometer : 0)
  || (a.createdAt || 0) - (b.createdAt || 0);

/**
 * Målt forbruk mellom første og siste fulle tank med kjent km-stand.
 * Alle fyllinger mellom disse (også delfyllinger og fyllinger uten km-stand) teller med i literne.
 */
export function measuredConsumption(fillUps) {
  const sorted = [...fillUps].sort(byDate);
  const known = sorted.map((f, i) => [f, i]).filter(([f]) => isAnchor(f));
  if (known.length < 2) return null;
  const [first, firstIndex] = known[0];
  const [last, lastIndex] = known.at(-1);
  const km = last.odometer - first.odometer;
  if (km <= 0) return null;
  // Drivstoffet fylt ved første kjente fylling ble brukt før målingen startet, så det telles ikke.
  const used = sorted.slice(firstIndex + 1, lastIndex + 1);
  const liters = used.reduce((s, f) => s + f.liters, 0);
  const cost = used.reduce((s, f) => s + f.total, 0);
  return { distance: km, litersPerMil: (liters / km) * 10, costPerKm: cost / km };
}

/**
 * @param {{date:string, odometer?:number|null, liters:number, total:number}[]} fillUps
 * @param {{expectedLitersPerMil?: number|null}} [options] forventet forbruk for bilen (l/mil)
 */
export function computeStats(fillUps, { expectedLitersPerMil = null } = {}) {
  const totalCost = fillUps.reduce((s, f) => s + f.total, 0);
  const totalLiters = fillUps.reduce((s, f) => s + f.liters, 0);
  const result = {
    count: fillUps.length,
    totalCost,
    totalLiters,
    averagePricePerLiter: totalLiters > 0 ? totalCost / totalLiters : null,
    distance: null,
    litersPerMil: null,
    costPerKm: null,
    /** 'measured' = beregnet fra km-stand, 'expected' = estimert fra forventet forbruk. */
    basis: null,
  };

  const measured = measuredConsumption(fillUps);
  if (measured) {
    Object.assign(result, measured, { basis: 'measured' });
    // Fyllinger etter siste kjente km-stand: legg til estimert kjørelengde.
    const extra = estimateExtraDistance(fillUps, measured.litersPerMil);
    if (extra > 0) {
      result.distance += extra;
      result.distanceIncludesEstimate = true;
    }
  } else if (expectedLitersPerMil > 0 && fillUps.length >= 2) {
    const used = [...fillUps].sort(byDate).slice(1);
    const liters = used.reduce((s, f) => s + f.liters, 0);
    const km = liters / (expectedLitersPerMil / 10);
    Object.assign(result, {
      distance: Math.round(km),
      litersPerMil: expectedLitersPerMil,
      costPerKm: km > 0 ? used.reduce((s, f) => s + f.total, 0) / km : null,
      basis: 'expected',
      distanceIncludesEstimate: true,
    });
  }
  return result;
}

/** Estimert kjørelengde for fyllinger før første / etter siste kjente km-stand. */
function estimateExtraDistance(fillUps, litersPerMil) {
  const sorted = [...fillUps].sort(byDate);
  const firstKnown = sorted.findIndex(isAnchor);
  const lastKnown = sorted.findLastIndex(isAnchor);
  const kmPerLiter = 10 / litersPerMil;
  // Før første kjente: fyllingene fra nr. 2 og frem til og med første kjente.
  const before = sorted.slice(1, firstKnown + 1).reduce((s, f) => s + f.liters, 0);
  const after = sorted.slice(lastKnown + 1).reduce((s, f) => s + f.liters, 0);
  return Math.round((before + after) * kmPerLiter);
}

/**
 * Beregner km-stand for hver fylling: kjent verdi, eller estimat ut fra forbruket.
 * Literne fylt ved en fylling tilsvarer drivstoffet brukt siden forrige fylling.
 * @returns {Map<string, {odometer:number|null, estimated:boolean, kmSincePrevious:number|null, kmEstimated:boolean}>}
 */
export function estimateOdometers(fillUps, litersPerMil) {
  const sorted = [...fillUps].sort(byDate);
  const kmPerLiter = litersPerMil > 0 ? 10 / litersPerMil : null;
  const odo = sorted.map((f) => (hasOdometer(f) ? f.odometer : null));
  const estimated = sorted.map(() => false);

  if (kmPerLiter) {
    // Fremover fra hver kjent/estimert km-stand.
    for (let i = 1; i < sorted.length; i++) {
      if (odo[i] == null && odo[i - 1] != null) {
        odo[i] = Math.round(odo[i - 1] + sorted[i].liters * kmPerLiter);
        estimated[i] = true;
      }
    }
    // Bakover fra første kjente km-stand.
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (odo[i] == null && odo[i + 1] != null) {
        odo[i] = Math.round(odo[i + 1] - sorted[i + 1].liters * kmPerLiter);
        estimated[i] = true;
      }
    }
  }

  const result = new Map();
  sorted.forEach((f, i) => {
    let kmSincePrevious = null;
    let kmEstimated = false;
    if (i > 0 && odo[i] != null && odo[i - 1] != null) {
      kmSincePrevious = odo[i] - odo[i - 1];
      kmEstimated = estimated[i] || estimated[i - 1];
    } else if (i > 0 && kmPerLiter) {
      kmSincePrevious = Math.round(f.liters * kmPerLiter);
      kmEstimated = true;
    }
    result.set(f.id, { odometer: odo[i], estimated: estimated[i], kmSincePrevious, kmEstimated });
  });
  return result;
}

/**
 * Forbruk mellom hver fylling og den forrige (for én bil), med full tank-metoden.
 *
 * - Mellom to fulle tanker med kjent km-stand er forbruket målt. Delfyllinger og fulle tanker
 *   uten km-stand imellom får snittet for hele strekningen.
 * - En full tank uten målepunkt bak seg estimeres ut fra `fallbackLitersPerMil`
 *   (bilens målte snittforbruk eller forventede forbruk).
 * - Delfyllinger får ikke eget forbruk – det regnes med ved neste fulle tank.
 *
 * @returns {Map<string, {kind:'measured'|'estimated'|'partial', km:number|null, kmEstimated:boolean,
 *   litersPerMil:number|null, costPerMil:number|null, spanFills:number, includesPartial:boolean}>}
 *   nøkkel = id til fyllingen strekningen ender med
 */
export function segmentConsumption(fillUps, fallbackLitersPerMil = null) {
  const sorted = [...fillUps].sort(byDate);
  const result = new Map();
  let anchor = -1; // siste fulle tank med km-stand
  let lastFull = -1; // siste fulle tank (med eller uten km-stand)

  const kmSincePrevious = (i) => (i > 0 && hasOdometer(sorted[i]) && hasOdometer(sorted[i - 1])
    ? sorted[i].odometer - sorted[i - 1].odometer : null);
  const sum = (list, key) => list.reduce((s, f) => s + f[key], 0);

  sorted.forEach((f, i) => {
    if (!isFull(f)) {
      if (i > 0) {
        result.set(f.id, { kind: 'partial', km: kmSincePrevious(i), kmEstimated: false,
          litersPerMil: null, costPerMil: null, spanFills: 1, includesPartial: true });
      }
      return;
    }

    // Full tank uten målepunkt bak seg, eller uten egen km-stand: estimat (overskrives hvis målt senere).
    if (lastFull >= 0 && fallbackLitersPerMil > 0) {
      const part = sorted.slice(lastFull + 1, i + 1);
      const km = Math.round((sum(part, 'liters') * 10) / fallbackLitersPerMil);
      result.set(f.id, { kind: 'estimated', km, kmEstimated: true, litersPerMil: fallbackLitersPerMil,
        costPerMil: km > 0 ? (sum(part, 'total') / km) * 10 : null, spanFills: part.length,
        includesPartial: part.some((x) => !isFull(x)) });
    }

    if (hasOdometer(f) && anchor >= 0) {
      const km = f.odometer - sorted[anchor].odometer;
      if (km > 0) {
        const span = sorted.slice(anchor + 1, i + 1);
        const litersPerMil = (sum(span, 'liters') / km) * 10;
        const costPerMil = (sum(span, 'total') / km) * 10;
        const fullsInSpan = span.filter(isFull);
        const includesPartial = span.some((x) => !isFull(x));
        // Hver full tank i strekningen får snittet; km fordeles etter liter hvis km-stand mangler.
        let prevFull = anchor;
        for (const g of fullsInSpan) {
          const gi = sorted.indexOf(g);
          const part = sorted.slice(prevFull + 1, gi + 1);
          const own = fullsInSpan.length === 1;
          result.set(g.id, {
            kind: 'measured',
            km: own ? km : Math.round((sum(part, 'liters') * 10) / litersPerMil),
            kmEstimated: !own,
            litersPerMil,
            costPerMil,
            spanFills: span.length,
            includesPartial,
          });
          prevFull = gi;
        }
      }
    }

    if (hasOdometer(f)) anchor = i;
    lastFull = i;
  });
  return result;
}

/** Sum kostnad per måned for de siste `months` månedene (inkludert inneværende). */
export function monthlyCost(fillUps, months = 12, now = new Date()) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
    const cost = fillUps.filter((f) => f.date.startsWith(key)).reduce((s, f) => s + f.total, 0);
    out.push({ month: start, key, cost });
  }
  return out;
}
