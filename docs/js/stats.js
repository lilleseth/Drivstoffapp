// Nøkkeltall for en samling fyllinger. Ren logikk uten DOM, slik at den kan testes med Node.

/**
 * @param {{date:string, odometer:number, liters:number, total:number}[]} fillUps
 */
export function computeStats(fillUps) {
  const count = fillUps.length;
  const totalCost = fillUps.reduce((s, f) => s + f.total, 0);
  const totalLiters = fillUps.reduce((s, f) => s + f.liters, 0);
  const result = {
    count,
    totalCost,
    totalLiters,
    averagePricePerLiter: totalLiters > 0 ? totalCost / totalLiters : null,
    distance: null,
    litersPerMil: null,
    costPerKm: null,
  };

  // Forbruk: drivstoffet fra første fylling ble brukt før registreringene startet,
  // så det telles ikke med. Resten fordeles på kjørt distanse.
  const sorted = [...fillUps].sort((a, b) => a.odometer - b.odometer || a.date.localeCompare(b.date));
  if (sorted.length >= 2) {
    const km = sorted.at(-1).odometer - sorted[0].odometer;
    if (km > 0) {
      const rest = sorted.slice(1);
      result.distance = km;
      result.litersPerMil = (rest.reduce((s, f) => s + f.liters, 0) / km) * 10;
      result.costPerKm = rest.reduce((s, f) => s + f.total, 0) / km;
    }
  }
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
