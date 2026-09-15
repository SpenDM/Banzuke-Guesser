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

export function loadBasho(id) {
  return getJson(`data/basho/${id}.json`);
}
