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

  // Dock a freshly-built dev panel into a NON-OVERLAPPING vertical stack on one
  // side ('left' | 'right'). Unlike the old hardcoded tops (e.g. media at 334px,
  // which a taller layout panel would collide with), this measures REAL heights, so
  // a panel's content size can never cause overlap. Panels are matched by a
  // `data-dock` marker: each new one stacks below those already placed on that side
  // this session. Runs once at mount; the panel stays draggable afterward. If the
  // column overflows the viewport the panel is clamped to stay visible — overlap
  // happens only then, i.e. "unless there's no space". Call AFTER the panel is in
  // the DOM (so it can be measured) and before/after makeDraggable (order-agnostic).
  NS.dockPanel = (panel, side = 'left') => {
    if (!panel) return;
    const GAP = 10;   // vertical gap between stacked panels
    const TOP0 = 92;  // first panel sits just below the header band (matches old anchors)
    const EDGE = 16;  // viewport margin (matches the panels' own corner offset)

    panel.style.position = 'fixed';
    panel.style.bottom = 'auto';
    if (side === 'right') { panel.style.right = `${EDGE}px`; panel.style.left = 'auto'; }
    else { panel.style.left = `${EDGE}px`; panel.style.right = 'auto'; }
    panel.dataset.dock = side;

    // Stack below any panels already docked on this side (self excluded).
    let top = TOP0;
    for (const p of document.querySelectorAll(`[data-mp-dev][data-dock="${side}"]`)) {
      if (p === panel) continue;
      top = Math.max(top, p.getBoundingClientRect().bottom + GAP);
    }
    // Keep it on-screen: clamp so the panel's bottom stays in view. This is the only
    // branch that can overlap the panel above — and only when nothing else fits.
    const h = panel.offsetHeight || 0;
    const maxTop = Math.max(TOP0, window.innerHeight - EDGE - h);
    panel.style.top = `${Math.min(top, maxTop)}px`;
  };
})();
