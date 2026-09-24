// Phones: scales wide tables down to their box so the page never scrolls sideways.

const MOBILE = matchMedia('(max-width: 640px)');

/** On phones, zooms each table in a .table-wrap down so it fits its box's width; elsewhere, clears any zoom. */
export function fitTables() {
  for (const wrap of document.querySelectorAll('.table-wrap')) {
    const table = wrap.firstElementChild;
    if (!table) continue;
    table.style.zoom = '';
    if (!MOBILE.matches || !wrap.clientWidth) continue; // not a phone, or its view is hidden
    const scale = wrap.clientWidth / table.scrollWidth;
    if (scale < 1) table.style.zoom = scale;
  }
}

MOBILE.addEventListener('change', fitTables);
window.addEventListener('resize', fitTables);
