/* ==========================================================================
   Dev-only drag helper — makes a floating ?dev panel movable by its title bar
   (loaded ONLY under ?dev, before the picker/editor cores so both can use it).
   Registers window.MemoryParlour.makeDraggable.

   The panels are anchored to a viewport corner via right/bottom; on the first
   drag we measure the current rect and switch the panel to left/top so dragging
   controls a single axis pair. Position is intentionally NOT persisted — panels
   return to their default corner on each load. Only the title bar is the grab
   handle, so the buttons/inputs inside the panel keep working normally.
   ========================================================================== */

(() => {
  'use strict';
  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  if (NS.makeDraggable) return;

  const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

  NS.makeDraggable = (panel, handle) => {
    if (!panel || !handle) return;
    handle.style.cursor = 'move';
    handle.style.touchAction = 'none'; // let us own the pointer instead of scrolling

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;

    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      const r = panel.getBoundingClientRect();
      // Pin to left/top (dropping the right/bottom anchor) so we drive one pair.
      baseLeft = r.left;
      baseTop = r.top;
      panel.style.left = `${r.left}px`;
      panel.style.top = `${r.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      startX = e.clientX;
      startY = e.clientY;
      handle.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
      panel.style.left = `${clamp(baseLeft + e.clientX - startX, 0, maxLeft)}px`;
      panel.style.top = `${clamp(baseTop + e.clientY - startY, 0, maxTop)}px`;
    });

    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture?.(e.pointerId);
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };
})();
