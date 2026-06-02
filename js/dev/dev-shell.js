/* ==========================================================================
   Dev-only MOBILE layout preview shell — PARENT page (loaded ONLY by
   dev-shell.html; never linked from the live site). Hosts the live site in a
   phone-width <iframe> and drives the in-frame dev-agent.js over postMessage.

   Why a parent page: an <iframe> carries its OWN viewport, so a 390px-wide frame
   makes the real @media (max-width:768px) cascade fire inside it — we author the
   TRUE mobile layout. The drag affordances live in the frame (the agent); the
   controls (this panel) live out here in the desktop space beside the phone, so
   they never crowd the ~390px canvas.

   Auth: dev-auth.js (loaded first by the HTML) runs the passphrase flow once here.
   On success the key is in sessionStorage, which the same-origin iframe inherits —
   so the frame unlocks silently. We build the frame + panel only AFTER unlock (so
   the key is stored before the frame's own auth runs); on lock / no-server
   (production) we stay inert with a short notice.
   ========================================================================== */

(() => {
  'use strict';
  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  if (NS.__devShell) return; // guard (also: only ever loaded by dev-shell.html)
  NS.__devShell = true;

  const ORIGIN = location.origin;
  const WIDTHS = [360, 390, 414]; // phone-width presets (px)
  let frameWidth = 390;
  // Optional deep-link: dev-shell.html?fold=<id> (the layout panel's "Edit mobile
  // view ↗" button passes the fold you were on) → jump there on the first `ready`.
  const wantFold = new URLSearchParams(location.search).get('fold') || '';

  // Live refs (populated by build()).
  let built = false;
  let iframe = null;
  let blockSelect = null;
  let readoutEl = null;
  let statusEl = null;
  let currentFold = '';
  let currentSel = '';
  const foldButtons = new Map(); // fold → button

  const frameWin = () => (iframe ? iframe.contentWindow : null);
  const toAgent = (type, payload = {}) => {
    const w = frameWin();
    if (w) w.postMessage({ type, ...payload }, ORIGIN);
  };

  const setStatus = (text) => { if (statusEl) statusEl.textContent = text; };
  const setReadout = (m) => {
    if (!readoutEl) return;
    readoutEl.textContent = m ? `left ${m.left}%   top ${m.top}%\nwidth ${m.width}%` : 'select a block';
  };
  const highlightFold = (fold) => {
    for (const [f, btn] of foldButtons) btn.classList.toggle('is-active', f === fold);
  };
  const populateBlocks = (blocks) => {
    if (!blockSelect) return;
    blockSelect.textContent = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— select block —';
    blockSelect.appendChild(opt0);
    for (const sel of blocks) {
      const o = document.createElement('option');
      o.value = sel;
      o.textContent = sel;
      blockSelect.appendChild(o);
    }
    blockSelect.value = currentSel && blocks.includes(currentSel) ? currentSel : '';
  };

  // --- postMessage host: agent → parent (spec §6) --------------------------
  // Attached at module load (before the frame exists), so the agent's first `ready`
  // is never missed. Origin- and source-checked.
  window.addEventListener('message', (e) => {
    if (e.origin !== ORIGIN || !iframe || e.source !== iframe.contentWindow) return;
    const msg = e.data || {};
    switch (msg.type) {
      case 'ready':
      case 'fold':
        currentFold = msg.fold || '';
        currentSel = '';
        highlightFold(currentFold);
        populateBlocks(msg.blocks || []);
        setReadout(null);
        setStatus(`Fold: ${currentFold || '—'}`);
        // Honor the ?fold= deep-link once, on the initial ready (the frame starts on home).
        if (msg.type === 'ready' && wantFold && wantFold !== currentFold) toAgent('goto', { fold: wantFold });
        break;
      case 'selected':
        currentSel = msg.selector || '';
        if (blockSelect) blockSelect.value = currentSel;
        if (!currentSel) setReadout(null);
        break;
      case 'metrics':
        if (msg.selector === currentSel) setReadout(msg);
        break;
      case 'saved':
        setStatus(msg.ok ? 'Saved ✓' : 'Save failed');
        break;
    }
  });

  // --- helpers --------------------------------------------------------------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function button(text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shell-btn';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  // --- Build the shell UI (after unlock) -----------------------------------
  async function build() {
    if (built) return;
    built = true;

    // Fold list + order from site.json's nav; fall back to the canonical six.
    let foldList = [];
    try {
      const site = await fetch('/content/site.json').then((r) => r.json());
      foldList = (site.nav || []).map((n) => ({ fold: n.fold, label: n.label })).filter((n) => n.fold);
    } catch { /* fall through to default */ }
    if (!foldList.length) {
      foldList = ['home', 'about', 'services', 'process', 'faqs', 'contact'].map((f) => ({ fold: f, label: f }));
    }

    const root = document.querySelector('[data-shell-root]') || document.body;
    root.textContent = '';

    // Stage: the phone frame.
    const stage = el('div', 'shell-stage');
    iframe = document.createElement('iframe');
    iframe.className = 'shell-frame';
    iframe.style.width = `${frameWidth}px`;
    iframe.setAttribute('title', 'Mobile preview');
    iframe.src = '/?dev&shell';
    stage.appendChild(iframe);

    // Panel: the controls.
    const panel = el('aside', 'shell-panel');
    panel.appendChild(el('div', 'shell-title', 'MOBILE LAYOUT'));

    // Width presets.
    const widthRow = el('div', 'shell-row');
    widthRow.appendChild(el('span', 'shell-label', 'WIDTH'));
    for (const w of WIDTHS) {
      const b = button(String(w), () => {
        frameWidth = w;
        iframe.style.width = `${w}px`;
        for (const c of widthRow.querySelectorAll('button')) c.classList.toggle('is-active', Number(c.textContent) === w);
      });
      if (w === frameWidth) b.classList.add('is-active');
      widthRow.appendChild(b);
    }
    panel.appendChild(widthRow);

    // Fold switcher.
    panel.appendChild(el('div', 'shell-label', 'FOLD'));
    const foldRow = el('div', 'shell-folds');
    for (const { fold, label } of foldList) {
      const b = button(label, () => toAgent('goto', { fold }));
      b.classList.add('shell-fold');
      foldButtons.set(fold, b);
      foldRow.appendChild(b);
    }
    panel.appendChild(foldRow);

    // Block select.
    panel.appendChild(el('div', 'shell-label', 'BLOCK'));
    blockSelect = document.createElement('select');
    blockSelect.className = 'shell-select';
    populateBlocks([]);
    blockSelect.addEventListener('change', () => {
      currentSel = blockSelect.value;
      toAgent('select', { selector: currentSel });
    });
    panel.appendChild(blockSelect);

    // Readout.
    readoutEl = el('div', 'shell-readout');
    setReadout(null);
    panel.appendChild(readoutEl);

    // Actions.
    const actions = el('div', 'shell-row');
    actions.appendChild(button('Reset block', () => { if (currentSel) toAgent('reset', { selector: currentSel }); }));
    const saveBtn = button('Save mobile layout', () => { setStatus('Saving…'); toAgent('save'); });
    saveBtn.classList.add('shell-save');
    actions.appendChild(saveBtn);
    panel.appendChild(actions);

    // Status + hint.
    statusEl = el('div', 'shell-status', 'Loading frame…');
    panel.appendChild(statusEl);
    panel.appendChild(el('div', 'shell-hint',
      'Drag the dashed box in the phone to move · right handle = width · click a block to select. Saves to <fold>.layout.mobile.css.'));

    root.append(stage, panel);

    // Cmd/Ctrl+S while the panel has focus → save (the agent handles it when the
    // frame has focus).
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setStatus('Saving…');
        toAgent('save');
      }
    });
  }

  // --- Inert notice (locked / no dev server) -------------------------------
  function inert(reason) {
    const root = document.querySelector('[data-shell-root]') || document.body;
    root.textContent = '';
    root.appendChild(el('div', 'shell-inert', reason));
  }

  // --- Auth gating ----------------------------------------------------------
  // dev-auth.js (loaded before us) runs the passphrase flow and dispatches these.
  document.addEventListener('dev:unlocked', build);
  document.addEventListener('dev:locked', () =>
    inert('Dev tools unavailable here — wrong passphrase, or no dev server. Run `npm run dev` with MP_DEV_KEY set, then reload.'));
  if (NS.devUnlocked) build(); // unlock may have landed before this listener attached
})();
