// Slår sammen to versjoner av profildata (f.eks. fra to telefoner) uten å miste noe.
// Hver bil/fylling har id og updatedAt; nyeste versjon vinner. Slettinger lagres som
// "gravsteiner" (deleted: true) slik at de ikke dukker opp igjen fra en eldre kopi.

function mergeLists(a = [], b = []) {
  const byId = new Map();
  for (const item of [...a, ...b]) {
    const existing = byId.get(item.id);
    if (!existing || (item.updatedAt ?? 0) > (existing.updatedAt ?? 0)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function mergeData(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  return {
    ...remote,
    ...local,
    cars: mergeLists(remote.cars, local.cars),
    fillUps: mergeLists(remote.fillUps, local.fillUps),
  };
}
