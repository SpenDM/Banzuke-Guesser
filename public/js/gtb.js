// Guess the Banzuke (GTB) hand-off. The GTB entry form lives on another site, so this page can't
// fill it in directly: the "Open GTB form" link (under "Submit Guess to GTB") carries the
// prediction in the URL fragment (#bg=..., never sent to their server), and the "Fill GTB Form"
// bookmarklet, clicked while on the entry form, reads it back and sets the dropdowns. The user
// then checks and sends the entry.

export const GTB_URL = 'https://sumodb.sumogames.de/gtb/GTBEntry.aspx';

/** The entry-form link for Makuuchi placements ({slot, name}); a shared slot keeps its first name. */
export function gtbLink(placements) {
  const picks = {};
  for (const { slot, name } of placements) picks[slot] ??= name;
  return `${GTB_URL}#bg=${encodeURIComponent(JSON.stringify(picks))}`;
}

/**
 * Fills the GTB entry form in `doc` from a `#bg=` fragment and reports the outcome through
 * `notify`. Each dropdown is identified by its first option ("Sekiwake W2" → S2W) and set to the
 * option naming the predicted rikishi, or "None" when the prediction leaves that slot empty.
 * Returns {filled, missing} (missing: "S2W Name" for rikishi with no matching option).
 *
 * Runs as a bookmarklet on the GTB page (see bookmarkletHref), so it must stay self-contained:
 * no imports or references to anything outside the function.
 */
export function fillGtbForm(doc, hash, notify) {
  const m = /[#&]bg=([^&]*)/.exec(hash || '');
  if (!m) {
    notify('No Sumo Ranker picks found. Open this page with the "Open GTB form" link under "Submit Guess to GTB" on Sumo Ranker, then click this bookmark again.');
    return null;
  }
  let picks;
  try { picks = JSON.parse(decodeURIComponent(m[1])); } catch (e) {
    notify('The Sumo Ranker picks in this page\'s address are damaged. Open it again from Sumo Ranker.');
    return null;
  }
  const RANKS = { Yokozuna: 'Y', Ozeki: 'O', Sekiwake: 'S', Komusubi: 'K', Maegashira: 'M' };
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const filled = [];
  const missing = [];
  for (const select of doc.querySelectorAll('select')) {
    const options = [...select.options];
    const label = /^(\w+) ([EW])(\d*)$/.exec((options[0]?.text || '').trim());
    if (!label || !RANKS[label[1]]) continue;
    const slot = `${RANKS[label[1]]}${label[3] || 1}${label[2]}`;
    const name = picks[slot];
    let option;
    if (name) {
      const want = norm(name);
      // The shikona itself, or failing that the shikona followed by extra detail ("Name (Y1e)").
      option = options.find((o) => norm(o.text) === want)
        || options.find((o) => { const t = norm(o.text); return t.startsWith(want) && !/[a-z]/.test(t[want.length]); });
    } else {
      option = options.find((o) => norm(o.text) === 'none');
    }
    if (select.style) select.style.outline = option || !name ? '' : '3px solid red';
    if (!option) { if (name) missing.push(`${slot} ${name}`); continue; }
    select.selectedIndex = options.indexOf(option);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    if (name) filled.push(slot);
  }
  notify(missing.length
    ? `Filled ${filled.length} slots. Couldn't find these rikishi in the dropdowns (outlined in red), please set them by hand:\n${missing.join('\n')}`
    : `Filled ${filled.length} slots from Sumo Ranker. Check them over, then enter your shikona and e-mail and send the entry.`);
  return { filled, missing };
}

/** The bookmarklet's URL: fillGtbForm run against the current page. */
export function bookmarkletHref() {
  return `javascript:${encodeURIComponent(`(${fillGtbForm})(document,location.hash,(m)=>alert(m));void 0`)}`;
}
