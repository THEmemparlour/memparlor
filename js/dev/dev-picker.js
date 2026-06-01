/* ==========================================================================
   Dev-only image crop/zoom picker — GENERIC core (loaded ONLY under ?dev).
   Registers window.MemoryParlour.buildPicker(cfg), driven by a fold's
   devConfigs[fold].image: { selector, mode: 'object' | 'transform', minZoom }
   so one picker serves any fold:
   · 'object'   (FAQ) — focal crop that always fills the window (object-position
                pans the focal point; zoom ≥ cover tightens). No gaps.
   · 'transform'(Home)— movable backdrop (translate pans the whole image, zoom
                scales about centre; zoom-out reveals the base behind it).
   UI is identical either way (position D-pad/arrows + zoom).

   The dev controller calls buildPicker on fold-enter and destroy() on fold-leave,
   so exactly one picker exists at a time and switching folds reframes the panel.

   Controls: drag, ▲▼◀▶ D-pad and arrow keys (Shift = coarse), − / + zoom, and a
   Save button that POSTs { fold, position, zoom } to /__dev/crop.
   ========================================================================== */

(() => {
  'use strict';

  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  if (NS.buildPicker) return; // define the builder once (every fold re-injects this core)

  // Build the picker for a fold's config; returns { destroy } for teardown, or
  // null when the fold has no image config or its image isn't in the DOM yet.
  NS.buildPicker = (cfg) => {
    if (!cfg || !cfg.image) return null;

    const foldId = cfg.id;
    const { selector, mode = 'transform', minZoom = 0.2 } = cfg.image;
    const cropTransform = NS.cropTransform || ((px, py, z) => `translate(${px - 50}%, ${py - 50}%) scale(${z})`);
    const img = document.querySelector(selector);
    if (!img) {
      console.warn(`[dev-picker] no image (${selector}) for fold "${foldId}"`);
      return null;
    }

    const ZOOM_MIN = minZoom;
    const ZOOM_MAX = 5;
    const POS_STEP = 1; // % per click (Shift → ×10)
    const POS_STEP_COARSE = 10;
    const ZOOM_STEP = 0.05; // per click (Shift → coarse)
    const ZOOM_STEP_COARSE = 0.25;
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    const round = (n) => Math.round(n);

    // --- Seed state from the element's current inline styles (set by createMedia) -
    const parsePos = (s) => {
      const m = (s || '').match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/);
      return m ? [parseFloat(m[1]), parseFloat(m[2])] : [50, 50];
    };
    const parseTranslate = (s) => {
      const m = (s || '').match(/translate\(\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%/);
      return m ? [parseFloat(m[1]) + 50, parseFloat(m[2]) + 50] : [50, 50];
    };
    const parseZoom = (s) => {
      const m = (s || '').match(/scale\(\s*(-?\d+(?:\.\d+)?)\s*\)/);
      return m ? parseFloat(m[1]) : 1;
    };

    let posX;
    let posY;
    let zoom = parseZoom(img.style.transform);
    if (mode === 'object') {
      [posX, posY] = parsePos(img.style.objectPosition || getComputedStyle(img).objectPosition);
    } else {
      [posX, posY] = parseTranslate(img.style.transform);
    }

    // --- Panel ----------------------------------------------------------------
    const panel = document.createElement('div');
    panel.setAttribute('data-mp-dev', '');
    Object.assign(panel.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: '9999', width: '188px',
      font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
      background: 'rgba(20,19,16,0.92)', color: '#f7f5e7', padding: '10px',
      borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px', userSelect: 'none',
    });

    const label = (text) => {
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = 'opacity:.6;letter-spacing:.08em;';
      return el;
    };
    const mkBtn = (text, title, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      if (title) b.title = title;
      Object.assign(b.style, {
        font: 'inherit', cursor: 'pointer', color: '#f7f5e7', background: 'rgba(247,245,231,0.12)',
        border: '1px solid rgba(247,245,231,0.25)', borderRadius: '4px', padding: '5px 0', lineHeight: '1',
      });
      b.addEventListener('click', onClick);
      return b;
    };
    const blank = () => document.createElement('span');

    const stepPos = (dx, dy, shift) => {
      const s = shift ? POS_STEP_COARSE : POS_STEP;
      posX = clamp(posX + dx * s, 0, 100);
      posY = clamp(posY + dy * s, 0, 100);
      apply();
    };

    const dpad = document.createElement('div');
    Object.assign(dpad.style, { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' });
    dpad.append(
      blank(), mkBtn('▲', 'Up (Shift = ×10)', (e) => stepPos(0, -1, e.shiftKey)), blank(),
      mkBtn('◀', 'Left (Shift = ×10)', (e) => stepPos(-1, 0, e.shiftKey)),
      mkBtn('◉', 'Center (50% 50%)', () => { posX = 50; posY = 50; apply(); }),
      mkBtn('▶', 'Right (Shift = ×10)', (e) => stepPos(1, 0, e.shiftKey)),
      blank(), mkBtn('▼', 'Down (Shift = ×10)', (e) => stepPos(0, 1, e.shiftKey)), blank()
    );

    const stepZoom = (dir, shift) => {
      const s = shift ? ZOOM_STEP_COARSE : ZOOM_STEP;
      zoom = clamp(Number((zoom + dir * s).toFixed(3)), ZOOM_MIN, ZOOM_MAX);
      apply();
    };
    const zoomVal = document.createElement('div');
    zoomVal.style.cssText = 'text-align:center;align-self:center;';
    const zoomRow = document.createElement('div');
    Object.assign(zoomRow.style, { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' });
    zoomRow.append(
      mkBtn('−', 'Zoom out (Shift = 0.25)', (e) => stepZoom(-1, e.shiftKey)),
      zoomVal,
      mkBtn('+', 'Zoom in (Shift = 0.25)', (e) => stepZoom(1, e.shiftKey))
    );

    const readout = document.createElement('div');
    readout.style.whiteSpace = 'pre';
    const snippet = () =>
      `"position": "${round(posX)}% ${round(posY)}%",\n"zoom": ${Number(zoom.toFixed(3))}`;

    const saveBtn = mkBtn(`Save to ${foldId}.json`, 'Write position + zoom to the fold JSON', async () => {
      saveBtn.textContent = 'Saving…';
      try {
        const res = await fetch('/__dev/crop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Dev-Key': NS.devAuth?.key?.() || '' },
          body: JSON.stringify({
            fold: foldId,
            position: `${round(posX)}% ${round(posY)}%`,
            zoom: Number(zoom.toFixed(3)),
          }),
        });
        saveBtn.textContent = res.ok ? 'Saved ✓' : 'Save failed';
      } catch {
        saveBtn.textContent = 'Save failed';
      }
      setTimeout(() => { saveBtn.textContent = `Save to ${foldId}.json`; }, 1400);
    });

    const panelTitle = label(`${foldId.toUpperCase()} CROP`); // doubles as the drag handle
    panel.append(panelTitle, label('POSITION'), dpad, label('ZOOM'), zoomRow, readout, saveBtn);
    document.body.appendChild(panel);
    NS.makeDraggable?.(panel, panelTitle); // drag the panel by its title bar

    // --- Apply + render --------------------------------------------------------
    function apply() {
      const pos = `${round(posX)}% ${round(posY)}%`;
      if (mode === 'object') {
        // Focal crop: always fills the window; pan the focal point, zoom tightens.
        img.style.objectPosition = pos;
        img.style.transformOrigin = pos;
        img.style.transform = `scale(${zoom})`;
      } else {
        // Movable backdrop: translate the whole image, scale about centre.
        img.style.transformOrigin = '50% 50%';
        img.style.transform = cropTransform(round(posX), round(posY), zoom);
      }
      zoomVal.textContent = `×${zoom.toFixed(2)}`;
      readout.textContent = snippet();
    }

    // --- Drag ------------------------------------------------------------------
    let dragging = false;
    img.style.cursor = 'crosshair';
    const posFromEvent = (e) => {
      const r = img.getBoundingClientRect();
      posX = clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
      posY = clamp(((e.clientY - r.top) / r.height) * 100, 0, 100);
    };
    const onImgPointerDown = (e) => {
      dragging = true;
      img.setPointerCapture?.(e.pointerId);
      posFromEvent(e);
      apply();
      e.preventDefault();
    };
    const onImgPointerMove = (e) => { if (dragging) { posFromEvent(e); apply(); } };
    const stop = () => { dragging = false; };
    img.addEventListener('pointerdown', onImgPointerDown);
    img.addEventListener('pointermove', onImgPointerMove);
    img.addEventListener('pointerup', stop);
    img.addEventListener('pointercancel', stop);

    // --- Arrow keys (Shift = coarse) — only on this fold, not while editing ----
    const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const onWinKeyDown = (e) => {
      if (document.documentElement.dataset.fold !== foldId) return;
      const ae = document.activeElement;
      if (ae && (ae.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName))) return;
      const move = ARROWS[e.key];
      if (!move) return;
      e.preventDefault();
      stepPos(move[0], move[1], e.shiftKey);
    };
    window.addEventListener('keydown', onWinKeyDown);

    apply();

    // Teardown: remove the panel + every listener this build added, and reset the
    // image's dev-only cursor. The crop transform/objectPosition are left in place
    // (that's the live crop being authored, possibly saved).
    return {
      destroy() {
        panel.remove();
        window.removeEventListener('keydown', onWinKeyDown);
        img.removeEventListener('pointerdown', onImgPointerDown);
        img.removeEventListener('pointermove', onImgPointerMove);
        img.removeEventListener('pointerup', stop);
        img.removeEventListener('pointercancel', stop);
        img.style.cursor = '';
      },
    };
  };
})();
