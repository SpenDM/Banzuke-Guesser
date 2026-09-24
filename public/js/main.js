import { loadBasho, loadIndex, loadSchedule } from './data.js';
import { GuessState } from './state.js';
import { renderGuess, renderPrevious, renderSummary } from './banzuke.js';
import { installDragAndDrop } from './dnd.js';
import { loadGuesses, loadSubmission, loadView, saveGuesses, saveView } from './storage.js';
import { formatDate, todayJST } from './dates.js';
import { SubmitController } from './submit.js';
import { bookmarkletHref, gtbLink } from './gtb.js';
import { RegisterController } from './register.js';
import { ResultsView } from './results.js';
import { reopenDate, rounds } from './rounds.js';
import { installProfilePopup } from './profile.js';

const $ = (sel) => document.querySelector(sel);

const BANNER = { about: 'resources/images/hakuho_shrug.png', predict: 'resources/images/atami_banzuke.png', results: 'resources/images/onosato_win_2.png' };
let results = null;   // the ResultsView of the round picked in the Past Banzuke box
let view = null;
let schedule = [];
let register = null;  // the Register button, shared by every basho shown
let submit = null;    // the Save Guess button of the basho shown

let buffered = false;   // the first view change gets a buffering pause (see setView)

function sizeAboutImages() {
  for (const section of document.querySelectorAll('.about-section')) {
    const text = section.querySelector('.about-text');
    const img = section.querySelector('.about-media img');
    // Images may be up to 1.5× their text's height, unless they set their own ratio (data-height).
    if (text && img) img.style.maxHeight = `${Math.round(text.offsetHeight * Number(img.dataset.height || 1.5))}px`;
  }
}

/** Shows the Predict or Results page (each with its own sidebar boxes); Results loads its data on first open. */
function setView(name) {
  const isChange = view !== null && view !== name;
  view = name;
  saveView(name);
  for (const el of document.querySelectorAll('[data-view]')) {
    // The header's basho select is only shown when there is more than one results file.
    el.hidden = el.dataset.view !== name || (el.id === 'basho-select' && el.options.length < 2);
  }
  for (const btn of document.querySelectorAll('[data-view-button]')) btn.classList.toggle('active', btn.dataset.viewButton === name);
  setBanner(BANNER[name]);
  if (name === 'about') sizeAboutImages();
  const ready = name === 'results' && results ? results.load().catch(showError) : Promise.resolve();
  // The first view change reveals a page that still has async work to do (Results fetches
  // submissions, then re-renders and hides sections), so its panels would otherwise flash in
  // half-built. Mirror the initial page-load pause (html.loading body): hold the content area
  // invisible until that work has painted, then fade it in. Only #app is buffered, so the header
  // and its banner animation stay visible throughout the transition.
  if (isChange && !buffered) {
    buffered = true;
    bufferContent(ready);
  }
}

/** Holds #app invisible until `ready` resolves and the fresh content has painted, then fades it in. */
function bufferContent(ready) {
  const app = $('#app');
  app.classList.add('buffering');
  ready.finally(() => requestAnimationFrame(() => requestAnimationFrame(() => app.classList.remove('buffering'))));
}

/** Warms the browser cache with both banner photos so the first slide animation doesn't flash
    while the incoming image is still being fetched. */
function preloadBanners() {
  for (const src of Object.values(BANNER)) { const img = new Image(); img.src = src; }
}

/** Swaps the banner photo: the old image slides down out of the banner, then the new one slides up into it. */
function setBanner(src) {
  const img = $('.banner-photo');
  if (img.getAttribute('src') === src) return;
  img.classList.add('banner-photo--sliding');
  img.addEventListener('transitionend', async function onSlideOut() {
    img.removeEventListener('transitionend', onSlideOut);
    img.classList.add('banner-photo--jump');
    img.src = src;
    void img.offsetHeight; // force a reflow so the jump to the start position isn't animated
    // The image is now parked below the banner (translateY(100%), clipped by overflow: hidden), so it
    // is out of sight. Wait until the new src is decoded and ready to paint before sliding it up, so on
    // a cold cache (first play) it can't appear mid-slide while it is still loading.
    try { await img.decode(); } catch (e) { /* decode rejects if the src changes again first; ignore */ }
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

/** The page to open on: the one on screen before a refresh, else the default (defaultView). */
function initialView(basho) {
  const reload = performance.getEntriesByType?.('navigation')?.[0]?.type === 'reload';
  const saved = reload && loadView();
  return saved && document.querySelector(`[data-view-button="${saved}"]`) ? saved : defaultView(basho);
}

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
  $('#release-note').textContent = next ? `(Official release: ${formatDate(next.banzuke_date)})` : '';
  $('#subtitle').textContent = next
    ? `Predict the ${next.name} Banzuke!`
    : `Predict the next Banzuke from the ${basho.name} results.`;
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
  // The "GTB Form" link carries the picks for the Fill GTB Form bookmarklet (gtb.js).
  const syncGtbLink = () => { $('#gtb-open').href = gtbLink(state.makuuchiPlacements()); };
  state.addEventListener('change', syncGtbLink);
  renderHeader(basho);
  render();
  syncGtbLink();

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

  const round = roundOf(basho);
  register.setRound(round?.id ?? null);
  submit?.dispose();
  submit = new SubmitController(state, round, { button: $('#submit'), note: $('#submitted-note') }, register);
  return basho;
}

/**
 * Opens the rikishi profile popup on a double-click of any name, or a single click of a name in
 * the previous banzuke once that rikishi has been moved to the prediction (those chips aren't
 * draggable, so a single click is otherwise unused; draggable chips still use click to select).
 */
function installProfileOpeners() {
  const app = $('#app');
  const popup = installProfilePopup();
  const openFor = (chip) => {
    const id = chip?.dataset.rikishiId;
    if (id) popup.open(Number(id), chip);
  };
  app.addEventListener('dblclick', (e) => openFor(e.target.closest('.chip[data-rikishi-id]')));
  app.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip.placed[data-rikishi-id]');
    if (chip && chip.closest('#previous')) openFor(chip);
  });
}

/**
 * "Submit Guess to GTB": the button drops down the auto-fill steps: the Fill GTB Form bookmarklet
 * to drag to the bookmarks bar (a plain click on it only explains that), then the link opening the
 * entry form in a new tab. The form isn't opened on the button click itself because browsers always
 * switch to a tab a page opens, and the bookmarklet has to be dragged from this one first.
 * Clicking the button again, clicking off the box or Escape dismisses it.
 */
function installGtbHandOff() {
  const button = $('#submit-guess');
  const box = $('#gtb-box');
  const hint = $('#gtb-bookmarklet-hint');
  const setOpen = (open) => {
    box.hidden = !open;
    button.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    if (!open) hint.hidden = true;
  };
  button.addEventListener('click', () => setOpen(box.hidden));
  document.addEventListener('click', (e) => {
    if (!box.hidden && !e.target.closest('.gtb-wrap')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

  const bookmarklet = $('#gtb-bookmarklet');
  bookmarklet.href = bookmarkletHref();
  bookmarklet.onclick = (e) => {
    e.preventDefault();
    hint.hidden = false;
  };
}

/** The Register button and popover (register.js), created once for the page. */
function installRegister() {
  register = new RegisterController({
    button: $('#register'), box: $('#register-box'), form: $('#register-form'), input: $('#shikona'),
    error: $('#register-error'), account: $('#account'), out: $('#account-out'), in: $('#account-in'),
    google: $('#google-signin'), emailForm: $('#email-form'), email: $('#email'), password: $('#password'),
    create: $('#email-create'), reset: $('#email-reset'), who: $('#account-who'), signout: $('#signout'),
    accountMsg: $('#account-msg'),
  });
  // Signing in or out (or renaming) changes whose submission the Results page shows.
  let known = JSON.stringify(register.profile);
  register.addEventListener('change', (e) => {
    const profile = JSON.stringify(e.detail.profile);
    if (profile === known || !results) return;
    known = profile;
    results = new ResultsView(results.basho);
    if (view === 'results') results.load().catch(showError);
  });
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
  preloadBanners();
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
  installRegister();
  installProfileOpeners();
  installGtbHandOff();
  const basho = await showBasho(index.latest);
  results = new ResultsView(basho);
  setView(initialView(basho));
  // Who the user is, from the API (a persisted sign-in first): updates the Register button and
  // the submission state once known, without holding up the page.
  register.init();
}

/** Dark-mode toggle: flips the `dark` class on <html>, remembers the choice, and keeps the
 * button's label ("Dark Mode" / "Light Mode") in sync with the current theme. */
function installThemeToggle() {
  const btn = $('#theme-toggle');
  if (!btn) return;
  const sync = () => {
    const dark = document.documentElement.classList.contains('dark');
    btn.innerHTML = dark ? 'Light<br>Mode' : 'Dark<br>Mode';
    btn.setAttribute('aria-pressed', String(dark));
  };
  btn.onclick = () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
    sync();
  };
  sync();
}

function showError(err) {
  console.error(err);
  $('#subtitle').textContent = `Could not load data: ${err.message}`;
}

installThemeToggle();
window.addEventListener('resize', () => { if (view === 'about') sizeAboutImages(); });
main().catch(showError).finally(() => document.documentElement.classList.remove('loading'));
