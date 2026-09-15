// Drag-and-drop (native HTML5) plus a click-to-select fallback for touch devices.

export function installDragAndDrop(root, state) {
  let selectedKey = null;
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
    chip.classList.add('dragging');
    root.classList.add('drag-active');
    select(null);
  });

  root.addEventListener('dragend', () => {
    for (const c of root.querySelectorAll('.dragging')) c.classList.remove('dragging');
    root.classList.remove('drag-active');
    clearHighlights();
  });

  root.addEventListener('dragover', (e) => {
    const slot = e.target.closest?.('[data-slot]');
    const prev = e.target.closest?.('[data-dropzone="previous"]');
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
