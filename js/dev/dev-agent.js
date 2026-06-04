/* ==========================================================================
   Dev-only MOBILE layout agent — runs INSIDE the ?dev preview-shell iframe
   (loaded ONLY under ?dev&shell, injected + mounted once by dev-controller.js).
   Registers window.MemoryParlour.buildAgent().

   This is the guts of dev-layout.js — the same block geometry, drag affordances,
   live <style> preview, seed-from-saved, and save — but:
     · hardcoded to the MOBILE breakpoint (@media max-width:768px), persisting to
       the fold's own css/folds/<fold>.layout.mobile.css via POST /__dev/layout-mobile;
     · NO local panel — the controls (block <select>, readout, reset, save) live in
       the PARENT shell. The agent talks to the parent over postMessage (spec §6),
       drawing only the in-frame move-overlay + width handle and reporting metrics.

   Because the shell sizes the iframe to a phone width, window.innerWidth ≤ 768 is
   always true in here, so the real mobile cascade is active and the measured
   coordinates are TRUE mobile values — no separate width gate needed.

   Singleton (not per-fold): the parent channel + affordances are built once and
   survive crossfades; the per-fold block state is rebuilt on each fold:change.
   ========================================================================== */

(() => {
  'use strict';
  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  if (NS.buildAgent) return; // define the builder once (the controller may retry the mount)

  const BP = 'mobile';
  const MEDIA = 'max-width: 768px'; // complement of the desktop tool's min-width:769px

  // The parent shell window (null if somehow not framed — then the agent still
  // drags locally but posts nowhere, which is harmless).
  const PARENT = window.parent !== window ? window.parent : null;
  const ORIGIN = location.origin;
  const post = (type, payload) => { if (PARENT) PARENT.postMessage({ type, ...payload }, ORIGIN); };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const round = (n) => Math.round(n * 10) / 10; // 0.1% precision (matches dev-layout.js)
  const pct = (v) => `${round(v)}%`;

  NS.buildAgent = (cfg) => {
    if (NS.__agentBuilt) return NS.__agentHandle || null; // mount exactly once
    NS.__agentBuilt = true;

    // Mode gate: this layout agent owns clicks/drag/save only in the parent's
    // "layout" mode (the default). In "text" mode the edit agent (dev-agent-edit.js)
    // takes over, so we go inert. Flipped by the parent's `mode` message.
    let active = true;

    // --- Per-fold state (rebuilt on every fold change by syncFold) ------------
    let foldId = '';
    let selectors = [];
    let found = []; // [{ sel, el }] — configured blocks actually present in the DOM
    let layout = { [BP]: {} }; // { mobile: { '<selector>': { left, top, width } } }
    let curSel = '';

    const elFor = (sel) => found.find((f) => f.sel === sel)?.el || null;
    const opRectOf = (el) =>
      (el.offsetParent || el.parentElement || document.documentElement).getBoundingClientRect();

    // Geometry of a block as % of its offsetParent — from the stored value if any,
    // else measured from its current on-screen rect (identical math to dev-layout.js).
    const measure = (sel) => {
      const stored = layout[BP][sel];
      if (stored) {
        return { left: parseFloat(stored.left), top: parseFloat(stored.top), width: parseFloat(stored.width) };
      }
      const el = elFor(sel);
      if (!el) return { left: 0, top: 0, width: 0 };
      const op = opRectOf(el);
      const r = el.getBoundingClientRect();
      return {
        left: clamp(((r.left - op.left) / op.width) * 100, 0, 100),
        top: clamp(((r.top - op.top) / op.height) * 100, 0, 100),
        width: clamp((r.width / op.width) * 100, 0, 100),
      };
    };
    const store = (sel, m) => {
      layout[BP][sel] = { left: pct(m.left), top: pct(m.top), width: pct(m.width) };
    };

    // --- Live <style> in the IFRAME head (mirrors the server's mobile output) -
    const liveStyle = document.createElement('style');
    liveStyle.setAttribute('data-mp-dev', '');
    document.head.appendChild(liveStyle);
    const renderLive = () => {
      const rules = Object.entries(layout[BP]).map(([sel, v]) =>
        // Same rule body the server writes: neutralise any natural transform/anchor
        // so left/top/width fully govern, and let inner text fill the widened block.
        `  ${sel} {\n` +
        `    position: absolute;\n` +
        `    left: ${v.left};\n` +
        `    top: ${v.top};\n` +
        `    width: ${v.width};\n` +
        `    max-width: none;\n` +
        `    right: auto;\n` +
        `    bottom: auto;\n` +
        `    transform: none;\n` +
        `  }\n\n` +
        `  ${sel} * { max-width: none !important; }`);
      liveStyle.textContent = rules.length
        ? `@media (${MEDIA}) {\n${rules.join('\n\n')}\n}\n`
        : '';
    };

    // --- In-frame affordances: move-overlay + right-edge width handle ---------
    const overlay = document.createElement('div');
    overlay.setAttribute('data-mp-dev', '');
    Object.assign(overlay.style, {
      position: 'fixed', zIndex: '9998', boxSizing: 'border-box', display: 'none',
      border: '1px dashed #4aa3ff', background: 'rgba(74,163,255,0.08)',
      cursor: 'move', touchAction: 'none',
    });
    const widthHandle = document.createElement('div');
    widthHandle.setAttribute('data-mp-dev', '');
    Object.assign(widthHandle.style, {
      position: 'fixed', zIndex: '9999', display: 'none', width: '12px', height: '28px',
      background: '#4aa3ff', borderRadius: '3px', cursor: 'ew-resize', touchAction: 'none',
    });
    document.body.append(overlay, widthHandle);

    const placeAffordances = () => {
      const el = elFor(curSel);
      if (!el) { overlay.style.display = 'none'; widthHandle.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      Object.assign(overlay.style, {
        display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      });
      Object.assign(widthHandle.style, {
        display: 'block', left: `${r.right - 6}px`, top: `${r.top + r.height / 2 - 14}px`,
      });
    };

    // Report the selected block's live values to the parent readout (rounded).
    const emitMetrics = () => {
      if (!curSel) return;
      const m = measure(curSel);
      post('metrics', { selector: curSel, left: round(m.left), top: round(m.top), width: round(m.width) });
    };

    const refresh = () => { renderLive(); placeAffordances(); emitMetrics(); };

    // Select a block (frame click, or echo of the parent's `select`). Unknown
    // selectors are ignored; '' deselects.
    const selectBlock = (sel, { echo = true } = {}) => {
      if (sel && !selectors.includes(sel)) return;
      curSel = sel || '';
      placeAffordances();
      if (echo) post('selected', { selector: curSel });
      emitMetrics();
    };

    // --- Drag (move via overlay, width via handle) — same math as dev-layout --
    let drag = null; // { mode, startX, startY, base:{left,top,width}, op }
    const beginDrag = (mode, e, target) => {
      if (!active || !curSel) return;
      drag = { mode, startX: e.clientX, startY: e.clientY, base: measure(curSel), op: opRectOf(elFor(curSel)) };
      target.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!drag) return;
      const dx = ((e.clientX - drag.startX) / drag.op.width) * 100;
      const dy = ((e.clientY - drag.startY) / drag.op.height) * 100;
      const m = { ...drag.base };
      if (drag.mode === 'move') {
        m.left = clamp(drag.base.left + dx, 0, 100);
        m.top = clamp(drag.base.top + dy, 0, 100);
      } else {
        m.width = clamp(drag.base.width + dx, 5, 100);
      }
      store(curSel, m); // first move creates the entry (a pure click never stores)
      refresh();
    };
    const endDrag = (e) => {
      if (!drag) return;
      (drag.mode === 'move' ? overlay : widthHandle).releasePointerCapture?.(e.pointerId);
      drag = null;
    };
    overlay.addEventListener('pointerdown', (e) => beginDrag('move', e, overlay));
    widthHandle.addEventListener('pointerdown', (e) => { e.stopPropagation(); beginDrag('width', e, widthHandle); });
    overlay.addEventListener('pointermove', onMove);
    widthHandle.addEventListener('pointermove', onMove);
    for (const t of [overlay, widthHandle]) {
      t.addEventListener('pointerup', endDrag);
      t.addEventListener('pointercancel', endDrag);
    }

    // Click a block in the frame to select it (the parent <select> is the alt path).
    // Capture-phase so we see it first; we don't stop it, so nav/links still work.
    const onDocClick = (e) => {
      if (!active) return; // inert in text mode — let the edit agent own clicks
      if (e.target.closest('[data-mp-dev]')) return; // ignore our own affordances
      for (const { sel, el } of found) {
        if (el.contains(e.target)) { selectBlock(sel); return; }
      }
    };
    document.addEventListener('click', onDocClick, true);

    // Keep affordances glued to the block through internal scroll / frame resize.
    const onScroll = () => { if (curSel && !drag) placeAffordances(); };
    const onResize = () => { if (curSel && !drag) { placeAffordances(); emitMetrics(); } };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    // --- Seed from the fold's OWN mobile file (unambiguous: one breakpoint) ---
    // Read css/folds/<fold>.layout.mobile.css by href and descend into its @media
    // block, so a re-save preserves prior work. The file has exactly one breakpoint,
    // so (unlike a shared file) there is nothing to mis-merge.
    const seedFromSaved = () => {
      const want = `/css/folds/${foldId}.layout.mobile.css`;
      for (const sheet of document.styleSheets) {
        if (!sheet.href || !sheet.href.endsWith(want)) continue;
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        if (!rules) continue;
        for (const rule of rules) {
          const inner = rule.cssRules; // CSSMediaRule → its nested style rules
          if (!inner) continue;
          for (const r of inner) {
            const sel = r.selectorText && r.selectorText.trim();
            if (!sel || !selectors.includes(sel)) continue;
            const { left, top, width } = r.style;
            if (left && top && width) layout[BP][sel] = { left, top, width };
          }
        }
      }
    };

    // --- Save → POST /__dev/layout-mobile ------------------------------------
    const save = async () => {
      let ok = false;
      try {
        const res = await fetch('/__dev/layout-mobile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Dev-Key': NS.devAuth?.key?.() || '' },
          body: JSON.stringify({ fold: foldId, layout }),
        });
        ok = res.ok;
        if (ok) NS.reloadDevStylesheet?.(`/css/folds/${foldId}.layout.mobile.css`); // reflect the save in-session
      } catch { ok = false; }
      post('saved', { ok });
    };

    // --- Resolve / re-resolve the active fold's blocks -----------------------
    const syncFold = (id, { initial = false } = {}) => {
      const c = NS.devConfigs && NS.devConfigs[id];
      const sels = (c && c.layout && c.layout.selectors) || [];
      foldId = id;
      selectors = sels;
      found = sels
        .map((sel) => ({ sel, el: document.querySelector(sel) }))
        .filter(({ el }) => el);
      layout = { [BP]: {} };
      curSel = '';
      seedFromSaved();
      renderLive();
      placeAffordances(); // nothing selected yet → hides
      post(initial ? 'ready' : 'fold', { fold: foldId, blocks: found.map((f) => f.sel) });
    };

    // Flip the mode gate; going inert drops the selection + hides the affordances so
    // they don't sit over the frame while the edit agent is in charge.
    const setActive = (on) => {
      if (active === on) return;
      active = on;
      if (!active) {
        drag = null;
        curSel = '';
        overlay.style.display = 'none';
        widthHandle.style.display = 'none';
      }
    };

    // --- Parent → agent messages (spec §6) -----------------------------------
    const onMessage = (e) => {
      if (e.origin !== ORIGIN || e.source !== PARENT) return; // same-origin + our parent only
      const msg = e.data || {};
      switch (msg.type) {
        case 'mode':
          setActive(msg.mode !== 'text'); // active in 'layout' (default); inert in 'text'
          break;
        case 'select':
          selectBlock(msg.selector);
          break;
        case 'reset':
          if (msg.selector && layout[BP][msg.selector]) {
            delete layout[BP][msg.selector]; // back to normal flow; a Save then drops its rule
            if (curSel === msg.selector) refresh(); // re-measure the natural position for the readout
            else renderLive();
          }
          break;
        case 'goto':
          // fold:goto bypasses the dev gesture lock in folds.js, so this navigates.
          if (msg.fold) document.dispatchEvent(new CustomEvent('fold:goto', { detail: { fold: msg.fold } }));
          break;
        case 'save':
          save();
          break;
      }
    };
    window.addEventListener('message', onMessage);

    // Cmd/Ctrl+S inside the frame saves too, so you needn't click back to the panel.
    const onKeyDown = (e) => {
      if (!active) return; // text mode: the edit agent owns Cmd/Ctrl+S
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKeyDown);

    // --- Fold lifecycle ------------------------------------------------------
    // The frame navigates between folds; re-resolve blocks + reseed each time and
    // tell the parent to repopulate. fold:change fires as the crossfade starts, by
    // which point the (pre-rendered) target fold is already in the DOM.
    document.addEventListener('fold:change', (e) => syncFold(e.detail.fold));
    // Covers the startup race where a fold's async renderer/config registers late.
    document.addEventListener('dev:rendered', (e) => {
      const active = document.documentElement.dataset.fold || '';
      if (e.detail.fold === active && e.detail.fold !== foldId) syncFold(e.detail.fold, { initial: !foldId });
    });

    // Initial mount: resolve the active fold now if its config is already registered
    // (else a dev:rendered / fold:change above will drive the first sync).
    const activeFold = document.documentElement.dataset.fold || (cfg && cfg.id) || '';
    if (activeFold && NS.devConfigs && NS.devConfigs[activeFold]) syncFold(activeFold, { initial: true });

    const handle = {
      destroy() {
        window.removeEventListener('message', onMessage);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('click', onDocClick, true);
        overlay.remove();
        widthHandle.remove();
        liveStyle.remove();
        NS.__agentBuilt = false;
        NS.__agentHandle = null;
      },
    };
    NS.__agentHandle = handle;
    return handle;
  };
})();
