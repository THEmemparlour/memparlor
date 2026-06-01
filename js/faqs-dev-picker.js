/* ==========================================================================
   Dev-only focal-point + zoom picker (loaded ONLY under ?dev — see js/faqs.js).
   A small control panel (right side, so it doesn't cover the left image):
     · DRAG on the image     → pan the focal point   (media.position)
     · POSITION D-pad ▲▼◀▶   → nudge the focal point  (Shift = ×10 step)
     · ARROW KEYS ↑↓←→       → same as the D-pad      (Shift = ×10 step)
     · center button         → reset position to 50% 50%
     · ZOOM − / +            → scale the image        (Shift = coarse step)
     · Save to faqs.json     → POST the values to the dev server, which writes
                               them into content/faqs.json (media.position/zoom)
   The focal point also drives the knockout logo fill (§2.2). Save is a dev-server
   convenience; on the deployed static site (no endpoint) it just reports failure.

   Vanilla JS, no build step, nothing shipped to normal visitors (they never
   request this file). True stripping waits for the SSR pass.
   ========================================================================== */

(() => {
  'use strict';

  const img = document.querySelector('[data-faqs-media] .faqs__media-el');
  if (!img) {
    console.warn('[faqs-dev] no FAQ image found — picker not started');
    return;
  }

  const ZOOM_MIN = 0.2;
  const ZOOM_MAX = 5;
  const POS_STEP = 1; // % per click (Shift → ×10)
  const POS_STEP_COARSE = 10;
  const ZOOM_STEP = 0.05; // per click (Shift → coarse)
  const ZOOM_STEP_COARSE = 0.25;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  // --- State: seed from the image's current inline styles (set from the JSON) -
  const parsePos = (s) => {
    const m = (s || '').match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : [50, 50];
  };
  const parseZoom = (s) => {
    const m = (s || '').match(/scale\(\s*(-?\d+(?:\.\d+)?)\s*\)/);
    return m ? parseFloat(m[1]) : 1;
  };

  let [posX, posY] = parsePos(img.style.objectPosition || getComputedStyle(img).objectPosition);
  let zoom = parseZoom(img.style.transform);

  // --- Panel ----------------------------------------------------------------
  const panel = document.createElement('div');
  panel.setAttribute('data-faqs-dev', '');
  Object.assign(panel.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '9999',
    width: '188px',
    font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
    background: 'rgba(20,19,16,0.92)',
    color: '#f7f5e7',
    padding: '10px',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    userSelect: 'none',
  });

  const label = (text) => {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.opacity = '0.6';
    el.style.letterSpacing = '0.08em';
    return el;
  };

  const mkBtn = (text, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (title) b.title = title;
    Object.assign(b.style, {
      font: 'inherit',
      cursor: 'pointer',
      color: '#f7f5e7',
      background: 'rgba(247,245,231,0.12)',
      border: '1px solid rgba(247,245,231,0.25)',
      borderRadius: '4px',
      padding: '5px 0',
      lineHeight: '1',
    });
    b.addEventListener('click', onClick);
    return b;
  };
  const blank = () => document.createElement('span');

  // Position D-pad (▲▼◀▶ + center reset). +y is downward (larger object-position y).
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

  // Zoom − / + with a live value in the middle.
  const stepZoom = (dir, shift) => {
    const s = shift ? ZOOM_STEP_COARSE : ZOOM_STEP;
    zoom = clamp(Number((zoom + dir * s).toFixed(3)), ZOOM_MIN, ZOOM_MAX);
    apply();
  };
  const zoomVal = document.createElement('div');
  Object.assign(zoomVal.style, { textAlign: 'center', alignSelf: 'center' });

  const zoomRow = document.createElement('div');
  Object.assign(zoomRow.style, { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' });
  zoomRow.append(
    mkBtn('−', 'Zoom out (Shift = 0.25)', (e) => stepZoom(-1, e.shiftKey)),
    zoomVal,
    mkBtn('+', 'Zoom in (Shift = 0.25)', (e) => stepZoom(1, e.shiftKey))
  );

  // Readout + copy.
  const readout = document.createElement('div');
  readout.style.whiteSpace = 'pre';

  const snippet = () => `"position": "${Math.round(posX)}% ${Math.round(posY)}%",\n"zoom": ${Number(zoom.toFixed(3))}`;

  // Save → POST to the dev server's crop endpoint, which writes media.position /
  // media.zoom straight into content/faqs.json. Dev server only; on the deployed
  // static site there's no endpoint so this just reports a failure (harmless).
  const saveBtn = mkBtn('Save to faqs.json', 'Write position + zoom to content/faqs.json', async () => {
    saveBtn.textContent = 'Saving…';
    try {
      const res = await fetch('/__dev/crop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fold: 'faqs',
          position: `${Math.round(posX)}% ${Math.round(posY)}%`,
          zoom: Number(zoom.toFixed(3)),
        }),
      });
      saveBtn.textContent = res.ok ? 'Saved ✓' : 'Save failed';
    } catch {
      saveBtn.textContent = 'Save failed';
    }
    setTimeout(() => { saveBtn.textContent = 'Save to faqs.json'; }, 1400);
  });

  panel.append(label('POSITION'), dpad, label('ZOOM'), zoomRow, readout, saveBtn);
  document.body.appendChild(panel);

  // --- Apply + render --------------------------------------------------------
  function apply() {
    const pos = `${Math.round(posX)}% ${Math.round(posY)}%`;
    img.style.objectPosition = pos;
    img.style.transformOrigin = pos;
    img.style.transform = `scale(${zoom})`;
    document.documentElement.style.setProperty('--knockout-pos', pos);
    zoomVal.textContent = `×${zoom.toFixed(2)}`;
    readout.textContent = snippet();
  }

  // --- Pan (drag still supported for quick big moves) ------------------------
  let dragging = false;
  img.style.cursor = 'crosshair';
  const posFromEvent = (e) => {
    const r = img.getBoundingClientRect();
    posX = clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
    posY = clamp(((e.clientY - r.top) / r.height) * 100, 0, 100);
  };
  img.addEventListener('pointerdown', (e) => {
    dragging = true;
    img.setPointerCapture?.(e.pointerId);
    posFromEvent(e);
    apply();
    e.preventDefault();
  });
  img.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    posFromEvent(e);
    apply();
  });
  const stop = () => { dragging = false; };
  img.addEventListener('pointerup', stop);
  img.addEventListener('pointercancel', stop);

  // --- Arrow keys drive the D-pad (Shift = coarse) ---------------------------
  // Gesture nav is locked in dev mode (js/folds.js), so the arrows are ours.
  // Only act while the FAQ fold is showing (it's the only fold this picker maps).
  const ARROWS = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  window.addEventListener('keydown', (e) => {
    if (document.documentElement.dataset.fold !== 'faqs') return;
    // Leave arrows to the text caret / form fields when the editor is editing.
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName))) {
      return;
    }
    const move = ARROWS[e.key];
    if (!move) return;
    e.preventDefault();
    stepPos(move[0], move[1], e.shiftKey);
  });

  apply();
})();
