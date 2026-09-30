// Renders the previous banzuke (left) and the guess banzuke (right).
import {
  RANK_NAMES, RANK_ORDER, DIVISION_OF, DIVISION_NAMES, SANYAKU_TINT, MAX_SANYAKU_ROWS, MIN_SANYAKU_ROWS,
  buildLadder, candidateSlotId, compareSlots, demotionSlotId, parseSlot, rankChange, slotId, slotName,
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
  // sumo.or.jp's notes are Japanese rank labels (新小結, 再入幕, …), which aren't shown.
  if (r.note && !/[\u3000-\u9fff]/.test(r.note)) el.append(h('span', { class: 'tag', text: r.note }));
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
  // Mid-tournament (`remaining` bouts left, see loadLive) a target stays neutral until it is
  // settled: reached, or out of reach even by winning every remaining bout.
  const live = r.remaining != null;
  const settled = (met, need) => (met || !live || r.wins + r.remaining < need ? met : null);
  if (r.kadoban) tag('tag-kadoban', 'KB', `Kadoban Ozeki: a losing record this tournament results in demotion`, settled(!kadobanFailed(r), KACHI_KOSHI));
  if (r.tsunatori) {
    const title = r.tsunatori_needs_yusho
      ? 'Yokozuna run: won the title or was runner-up with 12+ wins as ozeki in the previous basho; since that was a runner-up, only an outright win this tournament completes it (a second straight runner-up doesn’t)'
      : 'Yokozuna run: won the title or was runner-up with 12+ wins as ozeki in the previous basho; a win or a 12+ win runner-up this tournament completes it';
    tag('tag-tsunatori', '→Y', title, live ? null : tsunatoriMet(r)); // no yusho until the tournament ends
  }
  if (r.ozeki_return) tag('tag-ozeki-return', `↪O ${OZEKI_RETURN_WINS}`, `Ozeki demoted due to injury can obtain ozeki re-promotion with ${OZEKI_RETURN_WINS} wins`, settled(ozekiReturnMet(r), OZEKI_RETURN_WINS));
  if (r.ozeki_run != null) {
    const need = ozekiRunNeeded(r);
    tag('tag-ozeki-run', `→O ${need}`, `Ozeki run: ${need} wins this basho reaches the target ${OZEKI_TARGET} wins over three basho at sanyaku typically required for promotion`, settled(ozekiRunMet(r), need));
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
  // Announced by the JSA a few days after the tournament (scraper/juryo.py): already settled.
  if (r.juryo_promotion) tag('tag-juryo-promotion', '→J', 'Confirmed for Juryo promotion', true);
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

// The results table has all of Makushita; the prediction and the announced banzuke only its top
// 15 rows, so their header says so.
const TOP_LABELS = { ...DIVISION_NAMES, makushita: `${DIVISION_NAMES.makushita} (Top 30)` };

function divisionRow(rank, colspan, extra = null, labels = TOP_LABELS) {
  return h('tr', { class: 'division' }, h('td', { colspan }, labels[DIVISION_OF[rank]], extra));
}

/**
 * The guess table's "Include" checkbox in the Juryo and Makushita headers: whether Save Guess
 * includes that division's guesses. Makushita is only saved with Juryo: ticking it ticks Juryo,
 * unticking Juryo unticks it (GuessState.setSaveJuryo / setSaveMakushita).
 */
function includeToggle(state, rank) {
  const juryo = rank === 'J';
  return h('label', {
    class: 'save-juryo',
    title: juryo
      ? 'Save your Juryo guesses along with Makuuchi. They are shown with your saved prediction and compared on the Results page, but not scored or sent to GTB.'
      : 'Save your guesses for the top 30 of Makushita along with Makuuchi and Juryo. They are shown with your saved prediction and compared on the Results page, but not scored or sent to GTB.',
  }, h('input', {
    type: 'checkbox', dataSaveDivision: juryo ? 'juryo' : 'makushita', checked: juryo ? state.saveJuryo : state.saveMakushita,
  }), 'Include');
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
    if (DIVISION_OF[rank] !== lastDivision) { tbody.append(divisionRow(rank, 5, null, DIVISION_NAMES)); lastDivision = DIVISION_OF[rank]; }
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
    if (DIVISION_OF[rank] !== lastDivision) {
      tbody.append(divisionRow(rank, 9, rank === 'J' || rank === 'Ms' ? includeToggle(state, rank) : null));
      lastDivision = DIVISION_OF[rank];
    }
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
 * the Maegashira and Juryo rows it is a second drop target (red) for rikishi whose result would
 * drop them into the division below (Juryo, Makushita). Empty halves show no text; what the row is
 * is in the cells' tooltips.
 */
function candidatesRow(state, rank, ladder) {
  const upId = candidateSlotId(rank);
  const upTitle = `Promotion candidates for ${RANK_NAMES[rank]}`;
  const left = sideCells(state, upId, { rank, candidates: 'up' }, ladder, {
    extraClass: ' candidates promotion', title: upTitle,
  });
  const rankCell = h('td', { class: 'rank' }, h('span', { class: 'up', title: upTitle, text: '↑' }));
  let right;
  const downId = demotionSlotId(rank);
  if (downId) {
    const down = parseSlot(downId);
    const downTitle = `Demotion candidates for ${RANK_NAMES[down.rank]}`;
    rankCell.append(h('span', { class: 'down', title: downTitle, text: '↓' }));
    right = sideCells(state, downId, down, ladder, {
      extraClass: ' candidates demotion', title: downTitle,
    });
  } else {
    right = [h('td', { class: 'slot candidates promotion', colspan: 4, dataSlot: upId, title: upTitle })];
  }
  return h('tr', { class: 'candidates' }, ...left, rankCell, ...right);
}

/**
 * Results view: one banzuke (a submitted prediction, with Juryo and Makushita when saved, or the announced
 * one, down to the top of Makushita) as East | Rank | West, each chip blue when that slot is in
 * `correctSlots` and red otherwise. Chips are neutral when `correctSlots` is null (nothing to
 * compare against) or `judged(slot)` is false (a division the prediction didn't cover).
 * `placements` are {slot, key, name, rikishi_id}.
 */
export function renderComparison(table, placements, correctSlots, { judged = () => true } = {}) {
  const bySlot = new Map(placements.map((p) => [p.slot, p]));
  const rowsByRank = {};
  for (const p of placements) {
    const { rank, num } = parseSlot(p.slot);
    rowsByRank[rank] = Math.max(rowsByRank[rank] || 0, num);
  }
  const tbody = h('tbody');
  let lastDivision = null;
  for (const rank of RANK_ORDER) {
    for (let num = 1; num <= (rowsByRank[rank] || 0); num++) {
      if (DIVISION_OF[rank] !== lastDivision) { tbody.append(divisionRow(rank, 3)); lastDivision = DIVISION_OF[rank]; }
      const cellFor = (side) => {
        const p = bySlot.get(slotId(rank, num, side));
        if (!p) return h('td', { class: 'rikishi empty' });
        const mark = correctSlots && judged(p.slot) && (correctSlots.has(p.slot) ? 'correct' : 'wrong');
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
 * The "X/42 Makuuchi spots filled" count, with "X/28 Juryo spots filled" and "X/30 Makushita spots
 * filled" under it when those are included. With Show Issues on, `ok` (divisionsOk) colours each
 * line: blue for a division with every spot filled and no issues, red otherwise. (Order issues,
 * once every spot is filled, are reported by the Save Guess button when clicked: see
 * SubmitController.onClick.)
 */
export function renderSummary(el, state, ok = null) {
  const c = state.counts();
  const lines = [['makuuchi', `${c.filled}/${c.spots} Makuuchi spots filled`]];
  if (state.saveJuryo) lines.push(['juryo', `${c.juryoFilled}/${c.juryoSpots} Juryo spots filled`]);
  if (state.saveMakushita) lines.push(['makushita', `${c.makushitaFilled}/${c.makushitaSpots} Makushita spots filled`]);
  el.replaceChildren(...lines.flatMap(([division, text], i) => [
    i ? h('br') : null,
    h('span', { class: ok ? (ok[division] ? 'complete' : 'incomplete') : null, text }),
  ]).filter(Boolean));
}

export { parseSlot };
