// Results view: my prediction next to the announced banzuke, my score, the leaderboard and any
// other user's prediction on click. Everything is scored in the browser (score.js) from the
// banzuke file and the submissions the API returns once the banzuke is published.
import { loadBanzuke } from './data.js';
import { renderComparison } from './banzuke.js';
import { matchingSlots, rankSubmissions, scoreGuess } from './score.js';
import { DIVISION_OF, parseSlot } from './rank.js';
import { formatDate } from './dates.js';
import { loadSubmission } from './storage.js';
import { fitTables } from './fit.js';
import { api } from './auth.js';

const $ = (sel) => document.querySelector(sel);

async function fetchSubmissions(roundId) {
  const res = await api(`/api/submissions?basho=${roundId}`);
  if (!res.ok) throw new Error(`submissions: HTTP ${res.status}`);
  return res.json();
}

const divisionOf = (slot) => DIVISION_OF[parseSlot(slot).rank];
/** A submission's whole prediction: Makuuchi plus Juryo when it was saved. */
const allPlacements = (s) => [...s.placements, ...(s.juryo || [])];

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('data')) el.dataset[k.slice(4).toLowerCase()] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children);
  return el;
};

/**
 * Loads and renders the round `basho.next` of the given results file into the [data-view=results]
 * section. Called when the view is opened; cached per round.
 */
export class ResultsView {
  constructor(basho) {
    this.basho = basho;
    this.round = basho.next;
    this.loaded = null;
    this.order = 'total';
    $('#leaderboard').onclick = (e) => {
      const sort = e.target.closest('button[data-order]');
      if (sort) { this.sortLeaderboard(sort.dataset.order); return; }
      const btn = e.target.closest('button[data-shikona]');
      if (btn) this.showOther(btn.dataset.shikona);
    };
  }

  load() {
    this.loaded ||= this.render().then(fitTables).catch((err) => { this.loaded = null; throw err; });
    return this.loaded;
  }

  async render() {
    const round = this.round;
    $('#actual-title').textContent = round ? `${round.name} Banzuke` : 'Banzuke';
    $('#my-title').textContent = 'My Prediction';
    if (!round) { this.empty('No upcoming tournament in the schedule.'); return; }

    const [actual, api] = await Promise.all([
      loadBanzuke(round.id),
      fetchSubmissions(round.id).catch((err) => ({ error: err })),
    ]);
    // My own submission: what the server has, else the local copy (the server may be unreachable).
    const mine = api.me || loadSubmission(round.id);
    if (mine) $('#my-title').textContent = `${mine.shikona}'s Prediction`;

    if (!actual) {
      this.empty(`The ${round.name} banzuke hasn't been announced yet (expected ${formatDate(round.banzuke_date)}).`);
      if (mine) renderComparison($('#my-banzuke'), allPlacements(mine), null);
      return;
    }
    // Every division the banzuke file has (older files: Makuuchi only); only Makuuchi is scored.
    const actualRows = actual.rikishi.map((r) => ({ slot: `${r.rank}${r.num}${r.side}`, key: r.key, name: r.name, rikishi_id: r.rikishi_id }));
    this.actual = actualRows;
    this.actualMakuuchi = actualRows.filter((r) => divisionOf(r.slot) === 'makuuchi');
    this.actualJuryo = actualRows.filter((r) => divisionOf(r.slot) === 'juryo');
    // `prediction` keeps the placements list: the score's own `placements` (a count) replaces it.
    const scored = (api.submissions || []).map((s) => ({ ...s, prediction: allPlacements(s), ...this.score(s) }));
    this.scored = scored;
    this.ranked = rankSubmissions(scored);
    this.mine = mine;
    this.apiError = api.error;

    const myScore = mine ? this.score(mine) : null;
    $('#actual-empty').hidden = true;
    if (mine) {
      renderComparison($('#my-banzuke'), allPlacements(mine), myScore.marks);
      // Juryo is only marked on the announced banzuke when the prediction included it.
      const judged = (slot) => divisionOf(slot) === 'makuuchi' || (divisionOf(slot) === 'juryo' && !!mine.juryo?.length);
      renderComparison($('#actual-banzuke'), actualRows, myScore.marks, { judged });
      $('#my-empty').hidden = true;
    } else {
      $('#my-banzuke').replaceChildren();
      renderComparison($('#actual-banzuke'), actualRows, null);
      $('#my-empty').textContent = "You didn't submit a prediction for this tournament.";
      $('#my-empty').hidden = false;
    }
    this.renderScore(mine, myScore, api);
    this.renderLeaderboard();
    $('#other-title').textContent = 'Community Prediction';
    $('#other-banzuke').replaceChildren();
    $('#other-hint').hidden = false;
  }

  /**
   * scoreGuess of a submission's Makuuchi prediction, plus `marks`: the slots to show blue, its
   * correct Makuuchi slots and the Juryo slots it got right (compared, never scored).
   */
  score(s) {
    const score = scoreGuess(s.placements, this.actualMakuuchi);
    const juryo = matchingSlots(s.juryo || [], this.actualJuryo);
    return { ...score, marks: new Set([...score.correctSlots, ...juryo]) };
  }

  empty(message) {
    $('#actual-empty').textContent = message;
    $('#actual-empty').hidden = false;
    $('#my-empty').hidden = true;
    for (const id of ['#my-banzuke', '#actual-banzuke', '#leaderboard', '#other-banzuke']) $(id).replaceChildren();
    $('#my-score').replaceChildren();
    $('#other-hint').hidden = false;
  }

  renderScore(mine, score, api) {
    const dl = $('#my-score');
    if (!score) {
      dl.replaceChildren(h('dd', { class: 'hint', text: 'No prediction submitted.' }));
      return;
    }
    const me = this.ranked.find((r) => r.shikona === mine.shikona);
    const placement = me ? `${me.label} of ${this.ranked.length}` : (api.error ? 'unavailable' : '—');
    dl.replaceChildren(
      h('dt', { text: 'Correct Placements' }), h('dd', { text: String(score.placements) }),
      h('dt', { text: 'Correct Neighbors' }), h('dd', { text: String(score.neighbors) }),
      h('dt', { text: 'Total' }), h('dd', { class: 'total', text: String(score.total) }),
      h('dt', { text: 'Placement' }), h('dd', { text: placement }),
    );
  }

  /** Re-orders the leaderboard by Total Score or GTB Score (LEADERBOARD_ORDERS); positions follow. */
  sortLeaderboard(order) {
    if (order === this.order || !this.scored) return;
    this.order = order;
    this.renderLeaderboard();
    fitTables();
  }

  renderLeaderboard() {
    const table = $('#leaderboard');
    if (this.apiError) {
      table.replaceChildren(h('caption', { text: 'Leaderboard unavailable (could not reach the API).' }));
      return;
    }
    const mine = this.mine;
    const rows = this.order === 'total' ? this.ranked : rankSubmissions(this.scored, this.order);
    // The two score headers are buttons choosing the order; the active one is marked.
    const sortable = (text, order) => h('th', { 'aria-sort': this.order === order ? 'descending' : 'none' },
      h('button', { type: 'button', class: `sort${this.order === order ? ' active' : ''}`, dataOrder: order, text }));
    const head = h('thead', {}, h('tr', {},
      ...['Position', 'Shikona', 'Correct Placements', 'Correct Neighbors'].map((t) => h('th', { text: t })),
      sortable('Total Score', 'total'),
      sortable('GTB Score', 'gtb')));
    const body = h('tbody', {}, ...rows.map((r) => h('tr', { class: mine && r.shikona === mine.shikona ? 'me' : null },
      h('td', { text: r.label }),
      h('td', {}, h('button', { type: 'button', class: 'link', dataShikona: r.shikona, text: r.shikona })),
      h('td', { text: String(r.placements) }),
      h('td', { text: String(r.neighbors) }),
      h('td', { class: this.order === 'total' ? 'total' : null, text: String(r.total) }),
      h('td', { class: this.order === 'gtb' ? 'total' : null, text: String(r.gtb) }),
    )));
    table.replaceChildren(head, body);
    if (!rows.length) table.append(h('caption', { text: 'No predictions were submitted for this tournament.' }));
  }

  showOther(shikona) {
    const s = this.ranked?.find((r) => r.shikona === shikona);
    if (!s) return;
    $('#other-title').textContent = `${s.shikona}'s Prediction — ${s.total} pts (${s.placements} + ${s.neighbors})`;
    $('#other-hint').hidden = true;
    renderComparison($('#other-banzuke'), s.prediction, s.marks);
    fitTables();
    $('#other-banzuke').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
