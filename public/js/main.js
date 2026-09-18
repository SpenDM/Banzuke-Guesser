import { loadBasho, loadIndex, loadSchedule } from './data.js';
import { GuessState } from './state.js';
import { renderGuess, renderPrevious, renderSummary } from './banzuke.js';
import { installDragAndDrop } from './dnd.js';
import { loadGuesses, loadSubmission, saveGuesses } from './storage.js';
import { formatDate, todayJST } from './dates.js';
import { SubmitController } from './submit.js';
import { ResultsView } from './results.js';
import { reopenDate, rounds } from './rounds.js';

const $ = (sel) => document.querySelector(sel);

const BANNER = { predict: 'images/atami_banzuke.png', results: 'images/onosato_win.png' };
let results = null;   // the ResultsView of the round picked in the Past Banzuke box
let view = null;
let schedule = [];

/** Shows the Predict or Results page (each with its own sidebar boxes); Results loads its data on first open. */
function setView(name) {
  view = name;
  for (const el of document.querySelectorAll('[data-view]')) {
    // The header's basho select is only shown when there is more than one results file.
    el.hidden = el.dataset.view !== name || (el.id === 'basho-select' && el.options.length < 2);
  }
  for (const btn of document.querySelectorAll('[data-view-button]')) btn.classList.toggle('active', btn.dataset.viewButton === name);
  setBanner(BANNER[name]);
  if (name === 'results' && results) results.load().catch(showError);
}

/** Swaps the banner photo: the old image slides down out of the banner, then the new one slides up into it. */
function setBanner(src) {
  const img = $('.banner-photo');
  if (img.getAttribute('src') === src) return;
  img.classList.add('banner-photo--sliding');
  img.addEventListener('transitionend', function onSlideOut() {
    img.removeEventListener('transitionend', onSlideOut);
    img.classList.add('banner-photo--jump');
    img.src = src;
    void img.offsetHeight; // force a reflow so the jump to the start position isn't animated
    img.classList.remove('banner-photo--jump');
    img.classList.remove('banner-photo--sliding'); // animates back to translateY(0), i.e. slides up
  }, { once: true });
}

/**
 * Results when the user submitted a prediction for the current round and the banzuke is out
 * (the day after the announcement onwards); Predict otherwise.
 */
const defaultView = (basho) => (
  basho.next && loadSubmission(basho.next.id) && todayJST() > basho.next.banzuke_date ? 'results' : 'predict'
);

/** The round being predicted, with the day submissions reopen (after the tournament ends). */
function roundOf(basho) {
  if (!basho.next) return null;
  const t = schedule.find((x) => x.id === basho.next.id);
  return { ...basho.next, reopens: reopenDate(t?.end_date) };
}

function renderHeader(basho) {
  $('#basho-name').textContent = basho.name;
  const next = basho.next;
  $('#guess-name').textContent = next ? next.name : 'Next';
  $('#subtitle').textContent = next
    ? `Predict the ${next.name} Banzuke! Official announcement: ${formatDate(next.banzuke_date)}`
    : `Predict the next Banzuke from the ${basho.name} results.`;
  $('#source').textContent = `Data: ${basho.source}, fetched ${basho.fetched_at.slice(0, 10)}`;
}

async function showBasho(id) {
  const basho = await loadBasho(id);
  const state = new GuessState(basho);
  state.load(loadGuesses(basho.id));
  const app = $('#app');
  const prevTable = $('#previous');
  const guessTable = $('#guess');
  const summary = $('#summary');

  const render = () => {
    renderPrevious(prevTable, state);
    renderGuess(guessTable, state);
    renderSummary(summary, state);
  };
  state.addEventListener('change', render);
  state.addEventListener('change', () => saveGuesses(basho.id, state.toJSON()));
  renderHeader(basho);
  render();

  installDragAndDrop(app, state);
  app.addEventListener('click', (e) => {
    const addBtn = e.target.closest('button[data-add-row]');
    if (addBtn) { state.addRow(addBtn.dataset.addRow); return; }
    const removeBtn = e.target.closest('button[data-remove-row]');
    if (removeBtn) state.removeRow(removeBtn.dataset.removeRow);
  });
  $('#apply-ideal').onclick = () => state.applyIdealPromotions();
  $('#reset').onclick = () => {
    if (state.guesses.size === 0 || confirm('Clear all guesses?')) state.reset();
  };

  const submitEls = {
    button: $('#submit'), note: $('#submitted-note'), box: $('#shikona-box'),
    form: $('#shikona-form'), input: $('#shikona'), error: $('#shikona-error'),
  };
  // A fresh button per basho, so the previous basho's listeners don't linger.
  submitEls.button.replaceWith(submitEls.button.cloneNode(true));
  submitEls.button = $('#submit');
  submitEls.form.replaceWith(submitEls.form.cloneNode(true));
  submitEls.form = $('#shikona-form');
  submitEls.input = $('#shikona');
  submitEls.error = $('#shikona-error');
  new SubmitController(state, roundOf(basho), submitEls);
  return basho;
}

/** The Results page for one round (identified by its results file). */
async function showResults(fileId) {
  results = new ResultsView(await loadBasho(fileId));
  if (view === 'results') await results.load();
}

/**
 * The Past Banzuke box: a year select filtering a tournament select over every round this app
 * has data for, newest first. With a single round there is nothing to browse yet.
 */
function installPastBanzuke(index) {
  const all = rounds(index.basho);
  const yearSel = $('#past-year');
  const bashoSel = $('#past-basho');
  if (all.length < 2) {
    $('#past-none').hidden = false;
    return;
  }
  for (const year of [...new Set(all.map((r) => r.year))]) yearSel.append(new Option(year, year));
  const fillBasho = () => {
    bashoSel.replaceChildren(...all.filter((r) => r.year === yearSel.value).map((r) => new Option(r.name, r.fileId)));
  };
  yearSel.onchange = () => { fillBasho(); bashoSel.onchange(); };
  bashoSel.onchange = () => showResults(bashoSel.value).catch(showError);
  fillBasho();
  yearSel.hidden = bashoSel.hidden = false;
}

async function main() {
  const [index, sched] = await Promise.all([loadIndex(), loadSchedule().catch(() => [])]);
  schedule = sched;
  const select = $('#basho-select');
  if (index.basho.length > 1) {
    for (const id of [...index.basho].reverse()) {
      select.append(new Option(`${id.slice(0, 4)}-${id.slice(4)}`, id, id === index.latest, id === index.latest));
    }
    select.onchange = () => showBasho(select.value).catch(showError);
  }
  for (const btn of document.querySelectorAll('[data-view-button]')) btn.onclick = () => setView(btn.dataset.viewButton);
  installPastBanzuke(index);
  const basho = await showBasho(index.latest);
  results = new ResultsView(basho);
  setView(defaultView(basho));
}

function showError(err) {
  console.error(err);
  $('#subtitle').textContent = `Could not load data: ${err.message}`;
}

main().catch(showError);
