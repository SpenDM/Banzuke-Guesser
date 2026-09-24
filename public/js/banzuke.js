// Renders the previous banzuke (left) and the guess banzuke (right).
import {
  RANK_NAMES, DIVISION_OF, DIVISION_NAMES, SANYAKU_TINT, MAX_SANYAKU_ROWS, MIN_SANYAKU_ROWS,
  DEMOTION_SLOT, buildLadder, candidateSlotId, compareSlots, parseSlot, rankChange, slotId, slotName,
} from './rank.js';
import {
  KACHI_KOSHI, KOMUSUBI_FORCE_WINS, M1_FORCE_WINS, M2_FORCE_WINS, OZEKI_RETURN_WINS, OZEKI_TARGET,
  kadobanFailed, komusubiForceMet, maegashiraForceMet, maegashiraForceWinsNeeded, netScore,
  ozekiReturnMet, ozekiRunMet, ozekiRunNeeded, tsunatoriMet,
} from './promote.js';

const formatNetWins = (n) => (n > 0 ? `+${n}` : `${n}`);

const rankRowClass = (rank, num) => {
  if (SANYAKU_TINT[rank]) return `sanyaku-${SANYAKU_TINT[rank]}`;
  return null;
};

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

function chip(r, { placed = false, dest = null, draggable = true, kind = null, mark = null } = {}) {
  const el = h('div', {
    class: `chip${placed ? ' placed' : ''}${r.retired ? ' retired' : ''}${kind ? ` kind-${kind}` : ''}${mark ? ` ${mark}` : ''}`,
    draggable: draggable ? 'true' : null,
    dataKey: r.key,
    dataRikishiId: r.rikishi_id ?? null,
    title: r.retired ? `${r.name} (retired)` : r.name,
  }, h('span', { class: 'name', text: r.name }));
  if (r.note) el.append(h('span', { class: 'tag', text: r.note }));
  el.append(...badges(r));
  if (dest) el.append(h('span', { class: 'dest', text: `→ ${slotName(dest)}` }));
  return el;
}

/**
 * Indicator badges (see the Legend box): what the rikishi carried into the basho and, now that
 * the result is known, whether they made it (`tag-met`, blue) or not (`tag-missed`, red).
 * The same rules drive "Apply Ideal Rank Changes" (promote.js).
 */
function badges(r) {
  const out = [];
  const tag = (cls, text, title, met) => out.push(h('span', {
    class: `tag ${cls}${met == null ? '' : met ? ' tag-met' : ' tag-missed'}`, text, title,
  }));
  if (r.kadoban) tag('tag-kadoban', 'KB', `Kadoban Ozeki: a losing record this tournament results in demotion`, !kadobanFailed(r));
  if (r.tsunatori) {
    const title = r.tsunatori_needs_yusho
      ? 'Yokozuna run: won or tied for the title as ozeki in the previous basho; since that was a tie, only an outright win this tournament completes it (a second straight tie doesn’t)'
      : 'Yokozuna run: won or tied for the title as ozeki in the previous basho; a win or another tie this tournament completes it';
    tag('tag-tsunatori', '→Y', title, tsunatoriMet(r));
  }
  if (r.ozeki_return) tag('tag-ozeki-return', `↪O ${OZEKI_RETURN_WINS}`, `Ozeki demoted due to injury can obtain ozeki re-promotion with ${OZEKI_RETURN_WINS} wins`, ozekiReturnMet(r));
  if (r.ozeki_run != null) {
    const need = ozekiRunNeeded(r);
    tag('tag-ozeki-run', `→O ${need}`, `Ozeki run: ${need} wins this basho reaches the target ${OZEKI_TARGET} wins over three basho at sanyaku typically required for promotion`, ozekiRunMet(r));
  }
  // Unlike the indicators above (carried into the basho, shown met or missed), these two only
  // ever appear once already true: a Komusubi/M1/M2 either force-promotes or it doesn't.
  if (komusubiForceMet(r)) {
    tag('tag-komusubi-force', `→S ${KOMUSUBI_FORCE_WINS}`, `New sekiwake slot forced by ${KOMUSUBI_FORCE_WINS}+ wins at komusubi even if no existing slot is available`, true);
  }
  if (maegashiraForceMet(r)) {
    const need = maegashiraForceWinsNeeded(r);
    tag('tag-maegashira-force', `→K ${need}`, `New komusubi slot forced by ${M1_FORCE_WINS}+ wins at M1 or ${M2_FORCE_WINS}+ wins at M2 even if no existing slot is available`, true);
  }
  if (r.suspended) tag('tag-suspended', 'SUS', 'Suspended');
  if (r.retired) tag('tag-retired', 'Retired', 'Retired');
  // The trophy goes last so it sits at the right edge of the chip whatever else stacks with it.
  if (r.yusho) tag('tag-yusho', '🏆', 'Tournament winner');
  return out;
}

function changeSpan(c) {
  const span = h('span', { class: `change ${c.kind}` });
  span.append(c.main);
  if (c.sub) span.append(' ', h('span', { class: 'sub', text: c.sub }));
  return span;
}

function divisionRow(rank, colspan) {
  return h('tr', { class: 'division' }, h('td', { colspan, text: DIVISION_NAMES[DIVISION_OF[rank]] }));
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
    tbody.append(h('tr', { class: rankRowClass(rank, num) },
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

/** Right: Cur Rank | East | Net Wins | Rank Change | Rank | Cur Rank | West | Net Wins | Rank Change */
export function renderGuess(table, state) {
  const rows = state.rows();
  const ladder = buildLadder(state.basho.rikishi);
  const tbody = h('tbody');
  let lastDivision = null;
  for (let i = 0; i < rows.length; i++) {
    const { rank, num, candidates } = rows[i];
    if (DIVISION_OF[rank] !== lastDivision) { tbody.append(divisionRow(rank, 9)); lastDivision = DIVISION_OF[rank]; }
    if (candidates) { tbody.append(candidatesRow(state, rank, ladder)); continue; }
    const next = rows[i + 1];
    const isLastOfType = !next || next.rank !== rank || next.candidates;
    const rankCell = h('td', { class: 'rank' }, h('span', { text: `${rank}${num}` }));
    if (isLastOfType && DIVISION_OF[rank] === 'makuuchi' && rank !== 'M') {
      const count = state.rowCounts[rank];
      const btnClass = `row-btn row-btn-${SANYAKU_TINT[rank]}`;
      const controls = h('div', { class: 'rank-controls' });
      if (count > MIN_SANYAKU_ROWS) {
        controls.append(h('button', {
          class: btnClass, type: 'button', dataRemoveRow: rank, title: `Remove ${RANK_NAMES[rank]} ${num}`, text: '−',
        }));
      }
      if (count < MAX_SANYAKU_ROWS) {
        controls.append(h('button', {
          class: btnClass, type: 'button', dataAddRow: rank, title: `Add ${RANK_NAMES[rank]} ${num + 1}`, text: '+',
        }));
      }
      if (controls.childNodes.length) rankCell.append(controls);
    }
    const cells = (side) => sideCells(state, slotId(rank, num, side), { rank, num, side }, ladder);
    tbody.append(h('tr', { class: rankRowClass(rank, num) }, ...cells('E'), rankCell, ...cells('W')));
  }
  table.replaceChildren(
    h('thead', {}, h('tr', {},
      h('th', { text: 'Cur Rank' }), h('th', { text: 'East' }), h('th', { text: 'Net Wins' }), h('th', { text: 'Rank Change' }),
      h('th', { text: 'Rank' }),
      h('th', { text: 'Cur Rank' }), h('th', { text: 'West' }), h('th', { text: 'Net Wins' }), h('th', { text: 'Rank Change' }))),
    tbody,
  );
}

/**
 * The four cells of one side (or one half of a candidates row): Cur Rank | East/West | Net Wins |
 * Rank Change.
 */
function sideCells(state, id, to, ladder, { extraClass = '', title = null } = {}) {
  const occupants = [...state.occupants(id)].sort(compareSlots);
  const cls = `slot${extraClass}${occupants.length > 1 ? ' multi' : ''}${occupants.length === 0 && DIVISION_OF[to.rank] === 'makuuchi' ? ' empty' : ''}`;
  const stack = (fn) => h('div', { class: 'stack' }, occupants.map((r) => h('div', { class: 'line' }, fn(r))));
  const changeOf = (r) => rankChange({ rank: r.rank, num: r.num, side: r.side }, to, ladder);
  const rikishiStack = stack((r) => chip(r, { kind: changeOf(r).kind }));
  return [
    h('td', { class: `${cls} cur-rank`, dataSlot: id, title }, stack((r) => h('span', { text: `${r.rank}${r.num}${r.side}` }))),
    h('td', { class: `${cls} rikishi`, dataSlot: id, title }, rikishiStack),
    h('td', { class: `${cls} result`, dataSlot: id, title }, stack((r) => h('span', { text: formatNetWins(netScore(r)) }))),
    h('td', { class: `${cls} change-cell`, dataSlot: id, title }, stack((r) => changeSpan(changeOf(r)))),
  ];
}

/**
 * The temporary "↑" row below a rank type. Its left half (blue) holds rikishi whose result
 * would carry them up into that type. On the Sekiwake/Komusubi rows the right half is blank; on
 * the Maegashira row it is a second drop target (red) for Makuuchi rikishi whose result would drop
 * them into Juryo. Empty halves show no text; what the row is is in the cells' tooltips.
 */
function candidatesRow(state, rank, ladder) {
  const upId = candidateSlotId(rank);
  const upTitle = `Promotion candidates for ${RANK_NAMES[rank]}`;
  const left = sideCells(state, upId, { rank, candidates: 'up' }, ladder, {
    extraClass: ' candidates promotion', title: upTitle,
  });
  const rankCell = h('td', { class: 'rank' }, h('span', { class: 'up', title: upTitle, text: '↑' }));
  let right;
  if (rank === 'M') {
    const downTitle = `Demotion candidates for ${RANK_NAMES.J}`;
    rankCell.append(h('span', { class: 'down', title: downTitle, text: '↓' }));
    right = sideCells(state, DEMOTION_SLOT, { rank: 'J', candidates: 'down' }, ladder, {
      extraClass: ' candidates demotion', title: downTitle,
    });
  } else {
    right = [h('td', { class: 'slot candidates promotion', colspan: 4, dataSlot: upId, title: upTitle })];
  }
  return h('tr', { class: 'candidates' }, ...left, rankCell, ...right);
}

/**
 * Results view: one Makuuchi banzuke (a submitted prediction or the announced one) as
 * East | Rank | West, each chip blue when that slot is in `correctSlots` and red otherwise
 * (neutral when `correctSlots` is null: nothing to compare against). `placements` are
 * {slot, key, name, rikishi_id}.
 */
export function renderComparison(table, placements, correctSlots) {
  const bySlot = new Map(placements.map((p) => [p.slot, p]));
  const rowsByRank = {};
  for (const p of placements) {
    const { rank, num } = parseSlot(p.slot);
    rowsByRank[rank] = Math.max(rowsByRank[rank] || 0, num);
  }
  const tbody = h('tbody');
  let lastDivision = null;
  for (const rank of ['Y', 'O', 'S', 'K', 'M']) {
    for (let num = 1; num <= (rowsByRank[rank] || 0); num++) {
      if (DIVISION_OF[rank] !== lastDivision) { tbody.append(divisionRow(rank, 3)); lastDivision = DIVISION_OF[rank]; }
      const cellFor = (side) => {
        const p = bySlot.get(slotId(rank, num, side));
        if (!p) return h('td', { class: 'rikishi empty' });
        const mark = correctSlots && (correctSlots.has(p.slot) ? 'correct' : 'wrong');
        return h('td', { class: 'rikishi' }, chip(p, { draggable: false, mark }));
      };
      tbody.append(h('tr', { class: rankRowClass(rank, num) },
        cellFor('E'), h('td', { class: 'rank', text: `${rank}${num}` }), cellFor('W')));
    }
  }
  table.replaceChildren(
    h('thead', {}, h('tr', {}, h('th', { text: 'East' }), h('th', { text: 'Rank' }), h('th', { text: 'West' }))),
    tbody,
  );
}

/**
 * The "X/42 Makuuchi spots filled" count; once every spot is filled, a second line says whether
 * the order has issues (`orderIssues`: whether guessIssues found any).
 */
export function renderSummary(el, state, orderIssues) {
  const c = state.counts();
  el.textContent = `${c.filled}/${c.spots} Makuuchi spots filled`;
  if (c.filled === c.spots) el.append(h('br'), orderIssues ? 'Order issues detected' : 'No order issues detected');
}

export { parseSlot };
