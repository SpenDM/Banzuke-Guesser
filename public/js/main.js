import { loadBasho, loadIndex } from './data.js';
import { GuessState } from './state.js';
import { renderGuess, renderPrevious, renderSummary } from './banzuke.js';
import { installDragAndDrop } from './dnd.js';
import { loadGuesses, saveGuesses } from './storage.js';
import { formatDate, todayJST } from './dates.js';
import { SubmitController } from './submit.js';
import { ResultsView } from './results.js';

const $ = (sel) => document.querySelector(sel);

const BANNER = { predict: 'images/atami_banzuke.png', results: 'images/onosato_win.png' };
let results = null;   // the ResultsView of the basho on screen
let view = null;

/** Shows the Predict or Results page; the Results page loads its data the first time it opens. */
function setView(name) {
  view = name;
  for (const el of document.querySelectorAll('[data-view]')) el.hidden = el.dataset.view !== name;
  for (const btn of document.querySelectorAll('[data-view-button]')) btn.classList.toggle('active', btn.dataset.viewButton === name);
  $('.banner-photo').src = BANNER[name];
  if (name === 'results' && results) results.load().catch(showError);
}

/** Results once the banzuke is out (the day after the announcement onwards), Predict before. */
const defaultView = (basho) => (basho.next && todayJST() > basho.next.banzuke_date ? 'results' : 'predict');

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
  new SubmitController(state, basho.next, submitEls);

  results = new ResultsView(basho);
  setView(view || defaultView(basho));
}

async function main() {
  const index = await loadIndex();
  const select = $('#basho-select');
  if (index.basho.length > 1) {
    for (const id of [...index.basho].reverse()) {
      select.append(new Option(`${id.slice(0, 4)}-${id.slice(4)}`, id, id === index.latest, id === index.latest));
    }
    select.hidden = false;
    select.onchange = () => showBasho(select.value).catch(showError);
  }
  for (const btn of document.querySelectorAll('[data-view-button]')) btn.onclick = () => setView(btn.dataset.viewButton);
  await showBasho(index.latest);
}

function showError(err) {
  console.error(err);
  $('#subtitle').textContent = `Could not load data: ${err.message}`;
}

main().catch(showError);
