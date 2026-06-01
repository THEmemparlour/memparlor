/* ==========================================================================
   Dev-only block layout tool — GENERIC core (loaded ONLY under ?dev).
   Registers window.MemoryParlour.buildLayout(cfg), driven by a fold's
   devConfigs[fold].layout: { selectors:[…singleton blocks…], liveStyleId }.

   Lets the dev free-position a whole text block (drag to move) and set its
   wrapping width (drag the right-edge handle). Values are viewport-relative %
   stored under a breakpoint key and emitted inside @media (min-width:769px), so
   ≤768px keeps its normal responsive flow. Save POSTs to /__dev/layout, which
   writes css/folds/<fold>.layout.css.

   The dev controller calls buildLayout on fold-enter and destroy() on fold-leave,
   so exactly one layout tool exists at a time. v1 targets singleton blocks only
   (one per fold → a shared-class rule == per-instance).
   ========================================================================== */

(() => {
  'use strict';

  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  if (NS.buildLayout) return; // define the builder once (every fold re-injects this core)

  const BP = 'desktop'; // the only breakpoint authored now (format is breakpoint-keyed)
  const MEDIA_MIN = 769; // desktop = min-width:769px (complement of the project's max-width:768px)

  NS.buildLayout = (cfg) => {
    if (!cfg || !cfg.layout) return null;

    const foldId = cfg.id;
    const { selectors = [], liveStyleId = `${foldId}-dev-layout` } = cfg.layout;

    // Resolve the positionable blocks present in the DOM (warn + skip any absent).
    const found = selectors
      .map((sel) => ({ sel, el: document.querySelector(sel) }))
      .filter(({ sel, el }) => {
        if (!el) console.warn(`[dev-layout] block (${sel}) not found for fold "${foldId}"`);
        return el;
      });
    if (!found.length) return null;

    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    const round = (n) => Math.round(n * 10) / 10; // 0.1% precision
    const pct = (v) => `${round(v)}%`;
    const elFor = (sel) => found.find((f) => f.sel === sel)?.el || null;
    const opRectOf = (el) =>
      (el.offsetParent || el.parentElement || document.documentElement).getBoundingClientRect();

    // State: { desktop: { '<selector>': { left, top, width } } } — values like '12.3%'.
    const layout = { [BP]: {} };
    let curSel = '';

    // Geometry of a block as % of its offsetParent — from the stored value if any,
    // else measured from its current on-screen rect (which includes any transform).
    const measure = (sel) => {
      const stored = layout[BP][sel];
      if (stored) {
        return { left: parseFloat(stored.left), top: parseFloat(stored.top), width: parseFloat(stored.width) };
      }
      const el = elFor(sel);
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

    // --- Pre-seed from any already-saved rules ---------------------------------
    // Read css/folds/<fold>.layout.css directly (descending into its @media block),
    // so a later Save preserves prior work. Reading the generated file by href —
    // rather than a flat cascade walk or getComputedStyle — avoids picking up a
    // block's NATURAL absolute position (e.g. .home__headline) as if authored.
    const seedFromSaved = () => {
      const want = `/css/folds/${foldId}.layout.css`;
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

    // --- Live <style> (mirrors what the server will write) ---------------------
    const liveStyle = document.createElement('style');
    liveStyle.id = liveStyleId;
    liveStyle.setAttribute('data-mp-dev', '');
    document.head.appendChild(liveStyle);
    const renderLive = () => {
      const rules = Object.entries(layout[BP]).map(([sel, v]) =>
        // Neutralise any natural transform / right / bottom so left/top fully
        // determine the position (matches the rect we measured). The descendant
        // `max-width:none` lets inner text (e.g. `.services__list p` capped at 48ch)
        // actually fill the widened block instead of staying at its own cap.
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
        // !important: the base caps (e.g. `.services__list p`, specificity 0,1,1) are
        // more specific than `${sel} *` (0,1,0), so only !important reliably wins.
        `  ${sel} * { max-width: none !important; }`);
      liveStyle.textContent = rules.length
        ? `@media (min-width: ${MEDIA_MIN}px) {\n${rules.join('\n\n')}\n}\n`
        : '';
    };

    // --- On-element affordances (move overlay + right-edge width handle) --------
    const overlay = document.createElement('div');
    overlay.setAttribute('data-mp-dev', '');
    Object.assign(overlay.style, {
      position: 'fixed', zIndex: '9998', boxSizing: 'border-box', display: 'none',
      border: '1px dashed #4aa3ff', background: 'rgba(74,163,255,0.08)',
      cursor: 'move', touchAction: 'none',
    });
    const handle = document.createElement('div');
    handle.setAttribute('data-mp-dev', '');
    Object.assign(handle.style, {
      position: 'fixed', zIndex: '9999', display: 'none', width: '12px', height: '28px',
      background: '#4aa3ff', borderRadius: '3px', cursor: 'ew-resize', touchAction: 'none',
    });
    document.body.append(overlay, handle);

    const placeAffordances = () => {
      const el = elFor(curSel);
      if (!el) { overlay.style.display = 'none'; handle.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      Object.assign(overlay.style, {
        display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      });
      Object.assign(handle.style, {
        display: 'block', left: `${r.right - 6}px`, top: `${r.top + r.height / 2 - 14}px`,
      });
    };

    const updateReadout = () => {
      if (!curSel) { readout.textContent = 'select a block'; return; }
      const m = measure(curSel);
      readout.textContent = `left ${round(m.left)}%  top ${round(m.top)}%\nwidth ${round(m.width)}%`;
    };

    const refresh = () => { renderLive(); placeAffordances(); updateReadout(); };
    const selectBlock = (sel) => { curSel = sel; refresh(); };

    // --- Drag (move via overlay, width via handle) -----------------------------
    let drag = null; // { mode, startX, startY, base:{left,top,width}, op }
    const beginDrag = (mode, e, target) => {
      if (!curSel) return;
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
      (drag.mode === 'move' ? overlay : handle).releasePointerCapture?.(e.pointerId);
      drag = null;
    };
    overlay.addEventListener('pointerdown', (e) => beginDrag('move', e, overlay));
    handle.addEventListener('pointerdown', (e) => { e.stopPropagation(); beginDrag('width', e, handle); });
    overlay.addEventListener('pointermove', onMove);
    handle.addEventListener('pointermove', onMove);
    for (const t of [overlay, handle]) {
      t.addEventListener('pointerup', endDrag);
      t.addEventListener('pointercancel', endDrag);
    }
    // Keep affordances glued to the block if the layout shifts under it (e.g. an
    // internal scroll). Cheap and only meaningful while a block is selected.
    const onScroll = () => { if (curSel && !drag) placeAffordances(); };
    window.addEventListener('scroll', onScroll, true);

    // --- Panel -----------------------------------------------------------------
    const panel = document.createElement('div');
    panel.setAttribute('data-mp-dev', '');
    Object.assign(panel.style, {
      position: 'fixed', top: '92px', left: '16px', zIndex: '9999', width: '212px',
      font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
      background: 'rgba(20,19,16,0.92)', color: '#f7f5e7', padding: '10px',
      borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px', userSelect: 'none',
    });
    const title = document.createElement('div');
    title.textContent = `${foldId.toUpperCase()} LAYOUT`;
    title.style.cssText = 'opacity:.6;letter-spacing:.08em;';

    const select = document.createElement('select');
    Object.assign(select.style, {
      font: 'inherit', color: '#f7f5e7', background: 'rgba(247,245,231,0.1)',
      border: '1px solid rgba(247,245,231,0.25)', borderRadius: '4px', padding: '3px 4px', minWidth: '0',
    });
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— select block —';
    select.appendChild(opt0);
    for (const { sel } of found) {
      const o = document.createElement('option');
      o.value = sel;
      o.textContent = sel;
      select.appendChild(o);
    }
    select.addEventListener('change', () => selectBlock(select.value));

    const readout = document.createElement('div');
    readout.style.whiteSpace = 'pre';
    readout.textContent = 'select a block';

    const hint = document.createElement('div');
    hint.style.cssText = 'opacity:.55;';
    hint.textContent = 'drag box = move · right handle = width · desktop only';

    const mkBtn = (text, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      Object.assign(b.style, {
        font: 'inherit', cursor: 'pointer', color: '#f7f5e7', marginTop: '2px',
        background: 'rgba(247,245,231,0.15)', border: '1px solid rgba(247,245,231,0.3)',
        borderRadius: '4px', padding: '5px 0',
      });
      b.addEventListener('click', onClick);
      return b;
    };
    const resetBtn = mkBtn('Reset block', () => {
      if (!curSel) return;
      delete layout[BP][curSel]; // back to normal flow; Save then drops its rule
      refresh();
    });
    const saveBtn = mkBtn('Save layout', async () => {
      saveBtn.textContent = 'Saving…';
      try {
        const res = await fetch('/__dev/layout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Dev-Key': NS.devAuth?.key?.() || '' },
          body: JSON.stringify({ fold: foldId, layout }),
        });
        saveBtn.textContent = res.ok ? 'Saved ✓' : 'Save failed';
      } catch {
        saveBtn.textContent = 'Save failed';
      }
      setTimeout(() => { saveBtn.textContent = 'Save layout'; }, 1400);
    });

    panel.append(title, select, readout, hint, resetBtn, saveBtn);
    document.body.appendChild(panel);
    NS.makeDraggable?.(panel, title);

    // --- Init ------------------------------------------------------------------
    seedFromSaved();
    renderLive();

    return {
      destroy() {
        window.removeEventListener('scroll', onScroll, true);
        panel.remove();
        overlay.remove();
        handle.remove();
        liveStyle.remove();
      },
    };
  };
})();
