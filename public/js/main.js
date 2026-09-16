import { loadBasho, loadIndex } from './data.js';
import { GuessState } from './state.js';
import { renderGuess, renderPrevious, renderSummary } from './banzuke.js';
import { installDragAndDrop } from './dnd.js';
import { loadGuesses, saveGuesses } from './storage.js';

const $ = (sel) => document.querySelector(sel);

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function renderHeader(basho) {
  $('#basho-name').textContent = basho.name;
  const next = basho.next;
  $('#guess-name').textContent = next ? next.name : 'Next';
  $('#subtitle').textContent = next
    ? `Guess the ${next.name} banzuke (announced ${formatDate(next.banzuke_date)}, day 1 ${formatDate(next.start_date)}) from the ${basho.name} results.`
    : `Guess the next banzuke from the ${basho.name} results.`;
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
  await showBasho(index.latest);
}

function showError(err) {
  console.error(err);
  $('#subtitle').textContent = `Could not load data: ${err.message}`;
}

main().catch(showError);
