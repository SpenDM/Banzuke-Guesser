// Drag-and-drop (native HTML5) plus a click-to-select fallback for touch devices.
import { buildLadder, parseSlot, rankChange } from './rank.js';

// A fully transparent 1x1 image used to suppress the browser's own drag ghost. We render our
// own ghost instead (name + rank-change, moved together as one element) so the two can never
// drift apart or fight over stacking order the way a separately-positioned overlay would.
const BLANK_DRAG_IMAGE = new Image();
BLANK_DRAG_IMAGE.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function createGhost() {
  const el = document.createElement('div');
  el.className = 'drag-ghost';
  el.hidden = true;
  el.innerHTML = '<span class="ghost-name"></span><span class="ghost-sep" hidden></span>'
    + '<span class="ghost-change" hidden><span class="ghost-change-main"></span><span class="ghost-change-sub"></span></span>';
  document.body.append(el);
  return {
    el,
    name: el.querySelector('.ghost-name'),
    sep: el.querySelector('.ghost-sep'),
    change: el.querySelector('.ghost-change'),
    changeMain: el.querySelector('.ghost-change-main'),
    changeSub: el.querySelector('.ghost-change-sub'),
  };
}

export function installDragAndDrop(root, state) {
  let selectedKey = null;
  let draggingKey = null;
  const ghost = createGhost();
  const ladder = buildLadder(state.basho.rikishi);

  const positionGhost = (x, y) => {
    ghost.el.style.left = `${x + 14}px`;
    ghost.el.style.top = `${y - 14}px`;
  };

  const updateGhostChange = (slotId) => {
    const from = state.rikishi.get(draggingKey);
    let to;
    try { to = slotId && parseSlot(slotId); } catch { to = null; }
    if (!from || !to) {
      ghost.sep.hidden = true;
      ghost.change.hidden = true;
      return;
    }
    const c = rankChange({ rank: from.rank, num: from.num, side: from.side }, to, ladder);
    ghost.changeMain.textContent = c.main;
    ghost.changeSub.textContent = c.sub ? ` ${c.sub}` : '';
    ghost.change.className = `ghost-change ${c.kind}`;
    ghost.sep.hidden = false;
    ghost.change.hidden = false;
  };

  const highlight = (slot, on) => {
    for (const cell of root.querySelectorAll(`[data-slot="${slot}"]`)) cell.classList.toggle('over', on);
  };
  const clearHighlights = () => {
    for (const cell of root.querySelectorAll('.over')) cell.classList.remove('over');
    root.querySelector('[data-dropzone="previous"]')?.classList.remove('over');
  };
  const select = (key) => {
    selectedKey = key;
    for (const c of root.querySelectorAll('.chip.selected')) c.classList.remove('selected');
    if (key) for (const c of root.querySelectorAll(`.chip[data-key="${key}"]`)) c.classList.add('selected');
    root.classList.toggle('selecting', !!key);
  };

  root.addEventListener('dragstart', (e) => {
    const chip = e.target.closest?.('.chip[draggable="true"]');
    if (!chip) return;
    e.dataTransfer.setData('text/plain', chip.dataset.key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(BLANK_DRAG_IMAGE, 0, 0);
    draggingKey = chip.dataset.key;
    ghost.name.textContent = state.rikishi.get(draggingKey)?.name ?? '';
    ghost.sep.hidden = true;
    ghost.change.hidden = true;
    positionGhost(e.clientX, e.clientY);
    ghost.el.hidden = false;
    chip.classList.add('dragging');
    root.classList.add('drag-active');
    select(null);
  });

  root.addEventListener('dragend', () => {
    for (const c of root.querySelectorAll('.dragging')) c.classList.remove('dragging');
    root.classList.remove('drag-active');
    clearHighlights();
    draggingKey = null;
    ghost.el.hidden = true;
  });

  root.addEventListener('dragover', (e) => {
    const slot = e.target.closest?.('[data-slot]');
    const prev = e.target.closest?.('[data-dropzone="previous"]');
    if (draggingKey) {
      positionGhost(e.clientX, e.clientY);
      updateGhostChange(slot?.dataset.slot);
    }
    if (!slot && !prev) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearHighlights();
    if (slot) highlight(slot.dataset.slot, true);
    else prev.classList.add('over');
  });

  root.addEventListener('dragleave', (e) => {
    const slot = e.target.closest?.('[data-slot]');
    if (slot && !slot.contains(e.relatedTarget)) highlight(slot.dataset.slot, false);
  });

  root.addEventListener('drop', (e) => {
    const key = e.dataTransfer.getData('text/plain');
    if (!key) return;
    const slot = e.target.closest?.('[data-slot]');
    const prev = e.target.closest?.('[data-dropzone="previous"]');
    if (!slot && !prev) return;
    e.preventDefault();
    clearHighlights();
    ghost.el.hidden = true;
    if (slot) state.place(key, slot.dataset.slot);
    else state.remove(key);
  });

  // Double-click a placed chip to send it back to the previous banzuke.
  root.addEventListener('dblclick', (e) => {
    const chip = e.target.closest?.('[data-slot] .chip');
    if (chip) { select(null); state.remove(chip.dataset.key); }
  });

  // Click fallback: tap a chip, then tap a destination slot (or the left table to unplace).
  root.addEventListener('click', (e) => {
    if (e.target.closest?.('button')) return;
    const chip = e.target.closest?.('.chip');
    if (chip && (chip.draggable || chip.closest('[data-slot]'))) {
      select(selectedKey === chip.dataset.key ? null : chip.dataset.key);
      return;
    }
    if (!selectedKey) return;
    const slot = e.target.closest?.('[data-slot]');
    const prev = e.target.closest?.('[data-dropzone="previous"]');
    if (slot) { state.place(selectedKey, slot.dataset.slot); select(null); }
    else if (prev) { state.remove(selectedKey); select(null); }
  });

  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') select(null); });
}
