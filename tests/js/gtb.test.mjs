import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { GTB_URL, bookmarkletHref, fillGtbForm, gtbLink } from '../../public/js/gtb.js';

const ROSTER = ['Hoshoryu', 'Onosato', 'Kotoshoho', 'Kotosho', 'Ōhō (Oho)', 'Takayasu'];

// A stand-in for the GTB form's dropdowns: a rank label first, then "None" and the rikishi.
function fakeSelect(label, roster = ROSTER) {
  const options = [label, 'None', ...roster].map((text, i) => ({ text, value: String(i - 1) }));
  return { options, selectedIndex: 0, style: {}, dispatchEvent() { this.changed = true; } };
}
function fakeDoc(labels, roster) {
  const selects = labels.map((l) => fakeSelect(l, roster));
  const doc = { querySelectorAll: () => selects };
  const chosen = (label) => { const s = selects[labels.indexOf(label)]; return s.options[s.selectedIndex].text; };
  return { doc, selects, chosen };
}
const hashFor = (placements) => new URL(gtbLink(placements)).hash;

test('gtbLink encodes slot → name in the fragment, keeping the first name for a shared slot', () => {
  const url = gtbLink([{ slot: 'Y1E', name: 'Hoshoryu' }, { slot: 'Y1E', name: 'Onosato' }, { slot: 'O1W', name: 'Ōhō' }]);
  assert.ok(url.startsWith(`${GTB_URL}#bg=`));
  assert.deepEqual(JSON.parse(decodeURIComponent(new URL(url).hash.slice(4))), { Y1E: 'Hoshoryu', O1W: 'Ōhō' });
});

test('fillGtbForm maps labels to slots, matches shikona, and sets empty slots to None', () => {
  const { doc, selects, chosen } = fakeDoc(['Yokozuna E', 'Yokozuna W', 'Yokozuna E2', 'Sekiwake E2', 'Sekiwake W2', 'Maegashira W9']);
  const hash = hashFor([
    { slot: 'Y1E', name: 'Hoshoryu' }, { slot: 'Y1W', name: 'Kotosho' }, { slot: 'S2W', name: 'Oho' }, { slot: 'M9W', name: 'Takayasu' },
  ]);
  const notes = [];
  const out = fillGtbForm(doc, hash, (m) => notes.push(m));
  assert.deepEqual(out, { filled: ['Y1E', 'Y1W', 'S2W', 'M9W'], missing: [], contact: [] });
  assert.equal(chosen('Yokozuna E'), 'Hoshoryu');
  assert.equal(chosen('Yokozuna W'), 'Kotosho');                  // not the longer Kotoshoho
  assert.equal(chosen('Sekiwake W2'), 'Ōhō (Oho)');               // accents ignored, extra detail allowed
  assert.equal(chosen('Yokozuna E2'), 'None');
  assert.equal(chosen('Sekiwake E2'), 'None');
  assert.ok(selects.every((s) => s.changed));
  assert.match(notes[0], /^Filled 4 slots/);
});

test('fillGtbForm outlines and reports rikishi missing from the dropdowns', () => {
  const { doc, selects, chosen } = fakeDoc(['Ozeki E', 'Ozeki W']);
  const notes = [];
  const out = fillGtbForm(doc, hashFor([{ slot: 'O1E', name: 'Onosato' }, { slot: 'O1W', name: 'Kotozakura' }]), (m) => notes.push(m));
  assert.deepEqual(out, { filled: ['O1E'], missing: ['O1W Kotozakura'], contact: [] });
  assert.equal(chosen('Ozeki W'), 'Ozeki W');                     // left untouched
  assert.equal(selects[1].style.outline, '3px solid red');
  assert.match(notes[0], /O1W Kotozakura/);
});

test('fillGtbForm without picks in the fragment changes nothing', () => {
  const { doc, selects } = fakeDoc(['Yokozuna E']);
  const notes = [];
  assert.equal(fillGtbForm(doc, '', (m) => notes.push(m)), null);
  assert.equal(fillGtbForm(doc, '#bg=%7Bbroken', (m) => notes.push(m)), null);
  assert.equal(selects[0].selectedIndex, 0);
  assert.equal(notes.length, 2);
});

test('the bookmarklet URL runs fillGtbForm standalone against document/location/alert', () => {
  const href = bookmarkletHref();
  assert.ok(href.startsWith('javascript:'));
  const { doc, chosen } = fakeDoc(['Komusubi E']);
  const alerts = [];
  const code = decodeURIComponent(href.slice('javascript:'.length));
  // No imports or outer variables in scope: only what a bookmarklet on the GTB page would see.
  new Function('document', 'location', 'alert', code)(doc, { hash: hashFor([{ slot: 'K1E', name: 'Takayasu' }]) }, (m) => alerts.push(m));
  assert.equal(chosen('Komusubi E'), 'Takayasu');
  assert.equal(alerts.length, 1);
});

// The form's "Your Shikona" (mailsubj) and "E-mail Address" (mailfrom) text fields.
function withContactFields(doc) {
  const inputs = {};
  for (const name of ['mailsubj', 'mailfrom']) inputs[name] = { value: '', events: [], dispatchEvent(e) { this.events.push(e.type); } };
  doc.querySelector = (sel) => inputs[/name="(\w+)"/.exec(sel)?.[1]] || null;
  return inputs;
}

test('gtbLink adds the shikona and e-mail to the fragment only when given', () => {
  const placements = [{ slot: 'Y1E', name: 'Hoshoryu' }];
  assert.equal(gtbLink(placements), gtbLink(placements, {}));
  assert.ok(!gtbLink(placements, { shikona: null, email: undefined }).includes('&'));
  const hash = new URL(gtbLink(placements, { shikona: 'Testzan & co', email: 'a+b@example.com' })).hash;
  assert.match(hash, /&sn=Testzan%20%26%20co&em=a%2Bb%40example\.com$/);
});

test('fillGtbForm fills the shikona and e-mail fields from the fragment', () => {
  const { doc, chosen } = fakeDoc(['Yokozuna E']);
  const inputs = withContactFields(doc);
  const notes = [];
  const hash = new URL(gtbLink([{ slot: 'Y1E', name: 'Hoshoryu' }], { shikona: 'Testzan & co', email: 'a+b@example.com' })).hash;
  const out = fillGtbForm(doc, hash, (m) => notes.push(m));
  assert.equal(chosen('Yokozuna E'), 'Hoshoryu');
  assert.equal(inputs.mailsubj.value, 'Testzan & co');
  assert.equal(inputs.mailfrom.value, 'a+b@example.com');
  assert.deepEqual(inputs.mailsubj.events, ['input', 'change']);
  assert.deepEqual(out.contact, ['shikona', 'email']);
  assert.match(notes[0], /then send the entry\.$/);
});

test('fillGtbForm without an e-mail leaves that field alone and asks for it', () => {
  const { doc } = fakeDoc(['Yokozuna E']);
  const inputs = withContactFields(doc);
  const notes = [];
  const out = fillGtbForm(doc, new URL(gtbLink([], { shikona: 'Testzan' })).hash, (m) => notes.push(m));
  assert.equal(inputs.mailsubj.value, 'Testzan');
  assert.equal(inputs.mailfrom.value, '');
  assert.deepEqual(out.contact, ['shikona']);
  assert.match(notes[0], /enter your e-mail and send the entry\.$/);
});
