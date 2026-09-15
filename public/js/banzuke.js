// Renders the previous banzuke (left) and the guess banzuke (right).
import { RANK_NAMES, DIVISION_OF, parseSlot, rankChange, slotId } from './rank.js';

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('data')) el.dataset[k.slice(4, 5).toLowerCase() + k.slice(5)] = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
};

function chip(r, { placed = false, dest = null, draggable = true, kind = null } = {}) {
  const el = h('div', {
    class: `chip${placed ? ' placed' : ''}${r.retired ? ' retired' : ''}${kind ? ` kind-${kind}` : ''}`,
    draggable: draggable ? 'true' : null,
    dataKey: r.key,
    title: r.retired ? `${r.name} (retired)` : r.name,
  }, h('span', { class: 'name', text: r.name }));
  if (r.note) el.append(h('span', { class: 'tag', text: r.note }));
  if (r.retired) el.append(h('span', { class: 'tag tag-retired', text: 'intai' }));
  if (dest) el.append(h('span', { class: 'dest', text: `→ ${dest}` }));
  return el;
}

function divisionRow(rank, colspan) {
  return h('tr', { class: 'division' }, h('td', { colspan, text: RANK_NAMES[rank] }));
}

/** Left: Result | East | Rank | West | Result */
export function renderPrevious(table, state) {
  const bySlot = new Map(state.basho.rikishi.map((r) => [slotId(r.rank, r.num, r.side), r]));
  const rows = [];
  const seen = new Set();
  for (const r of state.basho.rikishi) {
    const rowKey = `${r.rank}${r.num}`;
    if (!seen.has(rowKey)) { seen.add(rowKey); rows.push({ rank: r.rank, num: r.num }); }
  }

  const tbody = h('tbody', { dataDropzone: 'previous' });
  let lastDivision = null;
  for (const { rank, num } of rows) {
    if (DIVISION_OF[rank] !== lastDivision) { tbody.append(divisionRow(rank, 5)); lastDivision = DIVISION_OF[rank]; }
    const east = bySlot.get(slotId(rank, num, 'E'));
    const west = bySlot.get(slotId(rank, num, 'W'));
    const cellFor = (r) => {
      if (!r) return h('td', { class: 'rikishi empty' });
      const dest = state.slotOf(r.key);
      return h('td', { class: 'rikishi' }, chip(r, { placed: !!dest, dest, draggable: !dest }));
    };
    tbody.append(h('tr', {},
      h('td', { class: 'result', text: east ? east.record : '' }),
      cellFor(east),
      h('td', { class: 'rank', text: `${rank}${num}` }),
      cellFor(west),
      h('td', { class: 'result', text: west ? west.record : '' }),
    ));
  }
  table.replaceChildren(
    h('thead', {}, h('tr', {},
      h('th', { text: 'Result' }), h('th', { text: 'East' }), h('th', { text: 'Rank' }),
      h('th', { text: 'West' }), h('th', { text: 'Result' }))),
    tbody,
  );
}

/** Right: Cur Rank | East | Result | Change | Rank | Cur Rank | West | Result | Change */
export function renderGuess(table, state) {
  const rows = state.rows();
  const tbody = h('tbody');
  let lastDivision = null;
  for (let i = 0; i < rows.length; i++) {
    const { rank, num } = rows[i];
    if (DIVISION_OF[rank] !== lastDivision) { tbody.append(divisionRow(rank, 9)); lastDivision = DIVISION_OF[rank]; }
    const isLastOfType = !rows[i + 1] || rows[i + 1].rank !== rank;
    const rankCell = h('td', { class: 'rank' }, h('span', { text: `${rank}${num}` }));
    if (isLastOfType && DIVISION_OF[rank] === 'makuuchi' && rank !== 'M') {
      rankCell.append(h('button', { class: 'add-row', type: 'button', dataAddRow: rank, title: `Add ${RANK_NAMES[rank]} ${num + 1}`, text: '+' }));
    }
    tbody.append(h('tr', {}, ...sideCells(state, rank, num, 'E'), rankCell, ...sideCells(state, rank, num, 'W')));
  }
  table.replaceChildren(
    h('thead', {}, h('tr', {},
      h('th', { text: 'Cur Rank' }), h('th', { text: 'East' }), h('th', { text: 'Result' }), h('th', { text: 'Change' }),
      h('th', { text: 'Rank' }),
      h('th', { text: 'Cur Rank' }), h('th', { text: 'West' }), h('th', { text: 'Result' }), h('th', { text: 'Change' }))),
    tbody,
  );
}

function sideCells(state, rank, num, side) {
  const id = slotId(rank, num, side);
  const to = { rank, num, side };
  const occupants = state.occupants(id);
  const cls = `slot${occupants.length > 1 ? ' multi' : ''}${occupants.length === 0 && DIVISION_OF[rank] === 'makuuchi' ? ' empty' : ''}`;
  const stack = (fn) => h('div', { class: 'stack' }, occupants.map((r) => h('div', { class: 'line' }, fn(r))));
  const changeOf = (r) => rankChange({ rank: r.rank, num: r.num, side: r.side }, to);
  return [
    h('td', { class: `${cls} cur-rank`, dataSlot: id }, stack((r) => h('span', { text: `${r.rank}${r.num}${r.side}` }))),
    h('td', { class: `${cls} rikishi`, dataSlot: id }, stack((r) => chip(r, { kind: changeOf(r).kind }))),
    h('td', { class: `${cls} result`, dataSlot: id }, stack((r) => h('span', { text: r.record }))),
    h('td', { class: `${cls} change-cell`, dataSlot: id }, stack((r) => {
      const c = changeOf(r);
      return h('span', { class: `change ${c.kind}`, text: c.text });
    })),
  ];
}

export function renderSummary(el, state) {
  const c = state.counts();
  el.textContent = `${c.placed} of ${c.total} placed · ${c.unplacedMakuuchi} Makuuchi rikishi still unplaced`;
}

export { parseSlot };
