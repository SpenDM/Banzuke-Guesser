// Loads the static JSON produced by the Python scraper (public/data/…).

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export function loadIndex() {
  return getJson('data/index.json');
}

// Rikishi profile pages (data/profiles/{rikishi_id}.json), memoized so re-opening is instant.
const profileCache = new Map();

export function loadProfile(rikishiId) {
  if (!profileCache.has(rikishiId)) {
    profileCache.set(rikishiId, getJson(`data/profiles/${rikishiId}.json`).catch((err) => {
      profileCache.delete(rikishiId); // don't cache a failure; allow a retry on the next open
      throw err;
    }));
  }
  return profileCache.get(rikishiId);
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

/** The announced banzuke a round is scored against (data/banzuke/YYYYMM.json), or null before it is published. */
export async function loadBanzuke(id) {
  const res = await fetch(`data/banzuke/${id}.json`, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`banzuke ${id}: HTTP ${res.status}`);
  // Cloudflare Pages answers unknown paths with index.html and a 200, so check what came back.
  if (!(res.headers.get('content-type') || '').includes('json')) return null;
  return res.json();
}

export async function loadBasho(id) {
  const [basho, overrides] = await Promise.all([getJson(`data/basho/${id}.json`), loadOverrides(id)]);
  return applyOverrides(basho, overrides);
}
