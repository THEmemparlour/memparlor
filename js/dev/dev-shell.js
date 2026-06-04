/* ==========================================================================
   Dev-only MOBILE authoring preview shell — PARENT page (loaded ONLY by
   dev-shell.html; never linked from the live site). Hosts the live site in a
   phone-width <iframe> and drives the in-frame agents over postMessage.

   Two tools, switched by the MODE toggle, both authoring the TRUE mobile render
   (the iframe carries its own ≤768px viewport, so the real @media cascade fires):
     · Layout      — drag blocks to position/size them (dev-agent.js).
     · Text & Style — click text to edit the words + inline structure, and set
                      mobile-only text styling (dev-agent-edit.js).
   The drag/selection affordances live in the frame (the agents); the controls
   (this panel) live out here beside the phone, so they never crowd the ~390px canvas.
   A `mode` message flips which agent owns clicks; the default is Layout.

   Saving: "Save mobile layout" → <fold>.layout.mobile.css; "Save mobile style" →
   <fold>.overrides.mobile.css (both ≤768px, disjoint from their desktop siblings).
   "Save text" writes content/<fold>.json, which is SHARED with desktop (content has
   no per-breakpoint concept) — the button says so.

   Auth: dev-auth.js (loaded first by the HTML) runs the passphrase flow once here.
   On success the key is in sessionStorage, which the same-origin iframe inherits —
   so the frame unlocks silently. We build the frame + panel only AFTER unlock; on
   lock / no-server (production) we stay inert with a short notice.
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

  // CSS inspector fields — MUST match dev-editor.js's CSS_FIELDS + dev-agent-edit.js's
  // CSS_PROPS + the server whitelist. The agent computes the values; we only render.
  const CSS_FIELDS = [
    { prop: 'font-size', type: 'text' },
    { prop: 'font-weight', type: 'select', options: ['', 'normal', '300', '400', '500', '600', '700', 'bold'] },
    { prop: 'font-style', type: 'select', options: ['', 'normal', 'italic', 'oblique'] },
    { prop: 'color', type: 'text' },
    { prop: 'line-height', type: 'text' },
    { prop: 'letter-spacing', type: 'text' },
    { prop: 'text-align', type: 'select', options: ['', 'left', 'center', 'right', 'justify'] },
    { prop: 'margin', type: 'text' },
  ];

  // Live refs (populated by build()).
  let built = false;
  let iframe = null;
  let mode = 'layout';
  let currentFold = '';
  let currentSel = '';
  let editorAvailable = false;
  const foldButtons = new Map(); // fold → button
  const modeButtons = new Map(); // mode → button
  const inspectorInputs = new Map(); // prop → input/select
  // Section + readout/status elements.
  let blockSelect = null;
  let readoutEl = null;       // layout block readout
  let statusEl = null;        // shared status line
  let layoutSection = null;
  let editorSection = null;
  let editorControls = null;
  let editorEmpty = null;
  let editorReadoutEl = null; // selected text selector
  let structureBox = null;

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

  // --- Editor (Text & Style) UI helpers ------------------------------------
  const setEditorReadout = (text) => { if (editorReadoutEl) editorReadoutEl.textContent = text; };
  // Fill the inspector inputs from the agent's per-field { value, placeholder }.
  const populateInspector = (values) => {
    for (const { prop } of CSS_FIELDS) {
      const input = inspectorInputs.get(prop);
      if (!input) continue;
      const entry = values && values[prop];
      input.value = entry ? (entry.value || '') : '';
      if (input.tagName === 'INPUT') input.placeholder = entry ? (entry.placeholder || '') : '';
    }
  };
  // Rebuild the structure-button UI from the agent's posted specs. Each button posts
  // ed:action {id}; the agent invokes the matching (in-frame) callback.
  const renderStructure = (groups) => {
    if (!structureBox) return;
    structureBox.textContent = '';
    for (const g of (groups || [])) {
      const wrap = el('div', 'shell-struct-group');
      if (g.title) wrap.appendChild(el('div', 'shell-struct-title', g.title));
      const row = el('div', 'shell-struct-row');
      for (const b of g.buttons) {
        const btn = button(b.label, () => toAgent('ed:action', { id: b.id }));
        if (b.title) btn.title = b.title;
        row.appendChild(btn);
      }
      wrap.appendChild(row);
      structureBox.appendChild(wrap);
    }
  };

  // Reflect the current mode in the toggle + section visibility.
  const applyMode = () => {
    for (const [m, b] of modeButtons) b.classList.toggle('is-active', m === mode);
    if (layoutSection) layoutSection.classList.toggle('is-hidden', mode !== 'layout');
    if (editorSection) editorSection.classList.toggle('is-hidden', mode !== 'text');
    if (mode === 'text') {
      editorControls.classList.toggle('is-hidden', !editorAvailable);
      editorEmpty.classList.toggle('is-hidden', editorAvailable);
    }
  };
  const setMode = (m) => {
    if (mode === m) return;
    mode = m;
    toAgent('mode', { mode }); // one post reaches BOTH agents in the frame
    applyMode();
  };

  // --- postMessage host: agent → parent ------------------------------------
  // Attached at module load (before the frame exists), so the agents' first messages
  // are never missed. Origin- and source-checked. Both agents share one
  // iframe.contentWindow, so this single guard covers layout + edit messages.
  window.addEventListener('message', (e) => {
    if (e.origin !== ORIGIN || !iframe || e.source !== iframe.contentWindow) return;
    const msg = e.data || {};
    switch (msg.type) {
      // --- Layout agent ---
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
      // --- Edit agent (Text & Style) ---
      case 'ed:fold':
        editorAvailable = !!msg.hasEditor;
        setEditorReadout('click text in the phone to select · dbl-click to edit');
        populateInspector(null);
        renderStructure([]);
        applyMode();
        break;
      case 'ed:buttons':
        renderStructure(msg.groups);
        break;
      case 'ed:values':
        populateInspector(msg.values);
        break;
      case 'ed:readout':
        setEditorReadout(msg.selector ? `selected: ${msg.selector}` : 'click text in the phone to select');
        break;
      case 'ed:save-result':
        setStatus(`${msg.target === 'text' ? 'Text' : 'Mobile style'} ${msg.ok ? 'saved ✓' : 'save failed'}`);
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
    panel.appendChild(el('div', 'shell-title', 'MOBILE AUTHORING'));

    // Mode toggle.
    const modeRow = el('div', 'shell-row');
    for (const [m, label] of [['layout', 'Layout'], ['text', 'Text & Style']]) {
      const b = button(label, () => setMode(m));
      if (m === mode) b.classList.add('is-active');
      modeButtons.set(m, b);
      modeRow.appendChild(b);
    }
    panel.appendChild(modeRow);

    // Width presets (shared across modes).
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

    // Fold switcher (shared across modes).
    panel.appendChild(el('div', 'shell-label', 'FOLD'));
    const foldRow = el('div', 'shell-folds');
    for (const { fold, label } of foldList) {
      const b = button(label, () => toAgent('goto', { fold }));
      b.classList.add('shell-fold');
      foldButtons.set(fold, b);
      foldRow.appendChild(b);
    }
    panel.appendChild(foldRow);

    // --- Layout section ----------------------------------------------------
    layoutSection = el('div', 'shell-section');
    layoutSection.appendChild(el('div', 'shell-label', 'BLOCK'));
    blockSelect = document.createElement('select');
    blockSelect.className = 'shell-select';
    populateBlocks([]);
    blockSelect.addEventListener('change', () => {
      currentSel = blockSelect.value;
      toAgent('select', { selector: currentSel });
    });
    layoutSection.appendChild(blockSelect);

    readoutEl = el('div', 'shell-readout');
    setReadout(null);
    layoutSection.appendChild(readoutEl);

    const layoutActions = el('div', 'shell-row');
    layoutActions.appendChild(button('Reset block', () => { if (currentSel) toAgent('reset', { selector: currentSel }); }));
    const saveLayoutBtn = button('Save mobile layout', () => { setStatus('Saving…'); toAgent('save'); });
    saveLayoutBtn.classList.add('shell-save');
    layoutActions.appendChild(saveLayoutBtn);
    layoutSection.appendChild(layoutActions);
    layoutSection.appendChild(el('div', 'shell-hint',
      'Drag the dashed box in the phone to move · right handle = width · click a block to select. Saves to <fold>.layout.mobile.css.'));
    panel.appendChild(layoutSection);

    // --- Editor (Text & Style) section -------------------------------------
    editorSection = el('div', 'shell-section is-hidden');
    editorControls = el('div', 'shell-editor');

    editorReadoutEl = el('div', 'shell-readout', 'click text in the phone to select · dbl-click to edit');
    editorControls.appendChild(editorReadoutEl);

    editorControls.appendChild(el('div', 'shell-label', 'STRUCTURE'));
    structureBox = el('div', 'shell-structure');
    editorControls.appendChild(structureBox);

    editorControls.appendChild(el('div', 'shell-label', 'TEXT STYLE (mobile only)'));
    const inspector = el('div', 'shell-inspector');
    for (const field of CSS_FIELDS) {
      const row = el('label', 'shell-field');
      row.appendChild(el('span', 'shell-field-name', field.prop));
      let input;
      if (field.type === 'select') {
        input = document.createElement('select');
        input.className = 'shell-select';
        for (const opt of field.options) {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt || '(unset)';
          input.appendChild(o);
        }
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'shell-input';
      }
      const send = () => toAgent('ed:field', { prop: field.prop, value: input.value });
      input.addEventListener('input', send);
      input.addEventListener('change', send);
      inspectorInputs.set(field.prop, input);
      row.appendChild(input);
      inspector.appendChild(row);
    }
    editorControls.appendChild(inspector);

    const editorActions = el('div', 'shell-row');
    const saveTextBtn = button('Save text (shared w/ desktop)', () => { setStatus('Saving text…'); toAgent('ed:save-text'); });
    saveTextBtn.classList.add('shell-warn');
    saveTextBtn.title = 'Words save to content/<fold>.json — they are SHARED with the desktop site (no per-breakpoint text).';
    const saveCssBtn = button('Save mobile style', () => { setStatus('Saving style…'); toAgent('ed:save-css'); });
    saveCssBtn.classList.add('shell-save');
    editorActions.append(saveTextBtn, saveCssBtn);
    editorControls.appendChild(editorActions);
    editorControls.appendChild(el('div', 'shell-hint',
      'Click text in the phone to select · dbl-click to edit the words (Enter commits, Esc cancels). Style edits apply only at ≤768px → <fold>.overrides.mobile.css.'));

    editorEmpty = el('div', 'shell-hint is-hidden', 'This fold has no text editor.');
    editorSection.append(editorControls, editorEmpty);
    panel.appendChild(editorSection);

    // Status + hint (shared).
    statusEl = el('div', 'shell-status', 'Loading frame…');
    panel.appendChild(statusEl);

    root.append(stage, panel);
    applyMode();

    // Cmd/Ctrl+S while the panel has focus → save the active mode (the agents handle
    // it when the frame has focus).
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setStatus('Saving…');
        if (mode === 'text') toAgent('ed:save-all');
        else toAgent('save');
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
