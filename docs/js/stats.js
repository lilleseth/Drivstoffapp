// Nøkkeltall for en samling fyllinger. Ren logikk uten DOM, slik at den kan testes med Node.
//
// Kilometerstand er valgfri. Mangler den, estimeres kjørelengden ut fra forbruket:
// enten målt forbruk (fra fyllinger som har km-stand) eller forventet forbruk satt på bilen.

/** Km-stand regnes som ukjent hvis den mangler eller er en plassholder som 0 eller 1. */
export const hasOdometer = (f) => Number.isFinite(f?.odometer) && f.odometer > 1;

const byDate = (a, b) => a.date.localeCompare(b.date) || (a.odometer || 0) - (b.odometer || 0);

/**
 * Målt forbruk mellom første og siste fylling med kjent km-stand.
 * Fyllinger uten km-stand mellom disse teller med i literne (drivstoffet ble jo brukt).
 */
export function measuredConsumption(fillUps) {
  const sorted = [...fillUps].sort(byDate);
  const known = sorted.map((f, i) => [f, i]).filter(([f]) => hasOdometer(f));
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
  const firstKnown = sorted.findIndex(hasOdometer);
  const lastKnown = sorted.findLastIndex(hasOdometer);
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
