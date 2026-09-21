// Rikishi profile popup: photo + fact sheet + tournament history, loaded on demand from
// data/profiles/{rikishi_id}.json. Opened by main.js (double-click a name, or single-click a
// placed name in the previous table); covers the opposite banzuke and dismisses on X / click-off / Escape.
import { loadProfile } from './data.js';

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
};

function ageFrom(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

function birthplaceText(bp) {
  if (!bp) return null;
  const parts = [bp.country, bp.province, bp.city].filter(Boolean);
  if (!parts.length) return bp.flag || null;
  return `${bp.flag ? `${bp.flag} ` : ''}${parts.join(' · ')}`;
}

/** True when a history row's rank (minus its East/West side) is the rikishi's highest rank. */
function isHighestRankRow(rank, highest) {
  if (!rank || !highest) return false;
  return rank.replace(/^(East|West)\s+/, '').trim() === highest.trim();
}

function styleDd(style) {
  if (!style) return h('dd', { text: '—' });
  const dd = h('dd', {}, h('strong', { text: style.primary || 'Versatile' }));
  if (style.notes && style.notes.length) dd.append(` — ${style.notes.join(', ')}`);
  return dd;
}

function factsList(p) {
  const dl = h('dl', { class: 'profile-fields' });
  const add = (label, value) => {
    if (value == null || value === '') return;
    dl.append(h('dt', { text: label }), h('dd', { text: String(value) }));
  };
  add('Real name', p.real_name);
  add('Stable', p.stable);
  add('Birthplace', birthplaceText(p.birthplace));
  add('Current rank', p.current_rank);
  add('Highest rank', p.highest_rank);
  add('Age', ageFrom(p.birth_date));
  add('Height', p.height_cm != null ? `${p.height_cm} cm` : null);
  add('Weight', p.weight_kg != null ? `${p.weight_kg} kg` : null);
  dl.append(h('dt', { text: 'Wrestling style' }), styleDd(p.style));
  return dl;
}

function historyTable(p) {
  if (!p.history || !p.history.length) return h('p', { class: 'hint', text: 'No tournament history available.' });
  const head = h('thead', {}, h('tr', {},
    ...['Year', 'Tournament', 'Division', 'Rank', 'Record', 'Achievements'].map((t) => h('th', { text: t }))));
  const body = h('tbody', {}, ...p.history.map((r) => {
    const cls = isHighestRankRow(r.rank, p.highest_rank) ? 'top' : (r.division === 'Makuuchi' ? 'mak' : null);
    return h('tr', { class: cls },
      h('td', { text: r.year }),
      h('td', { text: r.tournament }),
      h('td', { text: r.division }),
      h('td', { text: r.rank }),
      h('td', { text: r.record }),
      h('td', { text: (r.achievements || []).join(', ') }));
  }));
  return h('table', { class: 'profile-history-table' }, head, body);
}

function renderProfile(body, p) {
  const photo = p.photo_url
    ? h('img', { class: 'profile-photo', src: p.photo_url, alt: p.shikona || 'rikishi', loading: 'lazy' })
    : h('div', { class: 'profile-photo profile-photo--missing', text: '—' });
  body.replaceChildren(
    h('div', { class: 'profile-head' },
      photo,
      h('div', { class: 'profile-facts' },
        h('h2', { class: 'profile-name' },
          h('a', { href: p.profile_url, target: '_blank', rel: 'noopener noreferrer', text: p.shikona || 'Rikishi' }),
          p.shikona_ja ? h('span', { class: 'profile-name-ja', text: ` ${p.shikona_ja}` }) : null),
        factsList(p))),
    h('div', { class: 'profile-history' }, h('h3', { text: 'Tournament History' }), historyTable(p)));
}

/** Positions the fixed popup to cover the banzuke panel opposite the clicked chip (else over #app). */
function position(popup, anchorChip) {
  const panel = anchorChip?.closest('section, .panel');
  const others = [...document.querySelectorAll('table.banzuke')]
    .filter((t) => t.offsetParent !== null)
    .map((t) => t.closest('section, .panel'))
    .filter((el) => el && el !== panel);
  const target = others[0] || document.getElementById('app');
  const r = target.getBoundingClientRect();
  const margin = 8;
  const width = Math.min(Math.max(r.width, 320), window.innerWidth - 2 * margin);
  const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
  const top = Math.max(margin, Math.min(r.top, window.innerHeight - 120));
  Object.assign(popup.style, {
    left: `${left}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${window.innerHeight - top - margin}px`,
  });
}

export function installProfilePopup() {
  const backdrop = h('div', { class: 'profile-backdrop', hidden: true });
  const body = h('div', { class: 'profile-body' });
  const popup = h('div', { class: 'panel profile-popup', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rikishi profile', hidden: true },
    h('button', { type: 'button', class: 'profile-close', 'aria-label': 'Close' }, '×'),
    body);
  document.body.append(backdrop, popup);

  let currentId = null;
  let anchor = null;

  const close = () => {
    currentId = null;
    anchor = null;
    popup.hidden = true;
    backdrop.hidden = true;
  };
  const reposition = () => { if (!popup.hidden) position(popup, anchor); };

  popup.querySelector('.profile-close').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', reposition);

  async function open(rikishiId, anchorChip) {
    currentId = rikishiId;
    anchor = anchorChip;
    body.replaceChildren(h('p', { class: 'profile-loading', text: 'Loading…' }));
    popup.hidden = false;
    backdrop.hidden = false;
    position(popup, anchorChip);
    try {
      const profile = await loadProfile(rikishiId);
      if (currentId !== rikishiId) return; // a later open() superseded this one
      renderProfile(body, profile);
    } catch (err) {
      if (currentId !== rikishiId) return;
      body.replaceChildren(h('p', { class: 'profile-error', text: 'Could not load this rikishi’s profile.' }));
    }
    position(popup, anchorChip); // content height changed
  }

  return { open, close };
}
