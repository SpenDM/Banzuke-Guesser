// Loads the static JSON produced by the Python scraper (public/data/…).

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export function loadIndex() {
  return getJson('data/index.json');
}

export function loadSchedule() {
  return getJson('data/schedule.json');
}

/**
 * Hand-edited corrections for one basho, `data/overrides/YYYYMM.json`: { rikishiKey: { field: value } }.
 * Used for facts the scraper cannot know (a retirement announced after the data was fetched, an
 * announced Yokozuna run the heuristic missed). Missing or malformed -> no overrides.
 */
async function loadOverrides(id) {
  try {
    const o = await getJson(`data/overrides/${id}.json`);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

export function applyOverrides(basho, overrides) {
  for (const r of basho.rikishi) {
    const patch = overrides[r.key];
    if (patch && typeof patch === 'object') Object.assign(r, patch);
  }
  return basho;
}

export async function loadBasho(id) {
  const [basho, overrides] = await Promise.all([getJson(`data/basho/${id}.json`), loadOverrides(id)]);
  return applyOverrides(basho, overrides);
}
