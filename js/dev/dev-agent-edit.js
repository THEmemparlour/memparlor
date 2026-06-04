/* ==========================================================================
   Dev-only MOBILE text + style agent — runs INSIDE the ?dev preview-shell iframe
   (loaded ONLY under ?dev&shell, injected + mounted once by dev-controller.js).
   Registers window.MemoryParlour.buildEditAgent().

   This is the guts of dev-editor.js — the same click/dbl-click selection, inline
   contenteditable, per-fold structure adapter, and curated-CSS inspector — but:
     · NO local panel — the controls (structure buttons, the 8-field inspector, the
       two Save buttons) live in the PARENT shell. The agent draws only the in-frame
       selection outline + inline editor and talks to the parent over postMessage
       (the ed:* messages, alongside the layout agent's own channel).
     · the CSS half is hardcoded to the MOBILE breakpoint: the live <style> preview
       is wrapped in @media (max-width:768px) and Save POSTs to /__dev/css-mobile,
       which writes the fold's OWN css/folds/<fold>.overrides.mobile.css (disjoint
       from the desktop .overrides.css — neither save clobbers the other).
     · the TEXT half is shared: Save text POSTs to the same /__dev/content as the
       desktop editor (content has no per-breakpoint concept — words are shared).

   Because the shell sizes the iframe to a phone width, the real mobile cascade is
   active in here, so declaredBase() reads TRUE mobile values and the preview is real.

   Coexists with the layout agent (dev-agent.js) in the same iframe: a parent `mode`
   message flips each agent's `active` flag so only one owns clicks at a time. The
   edit agent is active only in the parent's "text" mode (default is "layout").

   Singleton (not per-fold): the parent channel + affordances are built once and
   survive crossfades; per-fold block state is rebuilt on each fold:change.
   ========================================================================== */

(() => {
  'use strict';
  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  if (NS.buildEditAgent) return; // define the builder once (the controller may retry the mount)

  const MEDIA = 'max-width: 768px';
  const PARENT = window.parent !== window ? window.parent : null;
  const ORIGIN = location.origin;
  const post = (type, payload) => { if (PARENT) PARENT.postMessage({ type, ...payload }, ORIGIN); };

  // Curated CSS properties — MUST match dev-editor.js's CSS_FIELDS order AND the
  // server whitelist (POST /__dev/css-mobile → validateOverrides' CSS_PROPS).
  const CSS_PROPS = [
    'font-size', 'font-weight', 'font-style', 'color',
    'line-height', 'letter-spacing', 'text-align', 'margin',
  ];

  NS.buildEditAgent = () => {
    if (NS.__editAgentBuilt) return NS.__editAgentHandle || null; // mount exactly once
    NS.__editAgentBuilt = true;

    let active = false; // mode-gated: true only in the parent's "text" mode

    // --- Per-fold state (rebuilt on every fold change by syncFold) ------------
    let foldId = '';
    let ed = null;          // devConfigs[foldId].editor (the per-fold adapter, reused as-is)
    let rootEl = null;
    let editSelectors = '';
    let overrides = {};     // { selector: { prop: value } } — seeded from saved + live edits
    let selectedEl = null;
    let editingEl = null;
    let curSelector = '';   // CSS selector of the current selection (target for ed:field)

    // Structure-button id lifecycle: a fresh actionMap per renderStructure, ids tagged
    // with a render epoch so a stale ed:action (button rendered before a re-render)
    // resolves to nothing rather than firing a closure over a removed node.
    let renderEpoch = 0;
    let actionMap = new Map();
    let pendingGroups = [];

    // --- Injected dev styles (selection outline + text cursor) — per-fold text ---
    const devStyle = document.createElement('style');
    devStyle.setAttribute('data-mp-dev', '');
    document.head.appendChild(devStyle);

    // --- Live <style> preview in the IFRAME head (mirrors the server's mobile CSS) ---
    const liveStyle = document.createElement('style');
    liveStyle.setAttribute('data-mp-dev', '');
    document.head.appendChild(liveStyle);
    const renderLiveStyle = () => {
      // Same canonical selector + prop order the server writes (serializeOverrides
      // with media set), so the preview is byte-faithful to the saved file.
      const blocks = [];
      for (const selector of (ed?.cssSelectors || [])) {
        const props = overrides[selector];
        if (!props) continue;
        const lines = CSS_PROPS.filter((p) => p in props).map((p) => `    ${p}: ${props[p]};`);
        if (lines.length) blocks.push(`  ${selector} {\n${lines.join('\n')}\n  }`);
      }
      liveStyle.textContent = blocks.length ? `@media (${MEDIA}) {\n${blocks.join('\n\n')}\n}\n` : '';
    };

    // --- Selector resolution (config-driven, identical to dev-editor.js) -------
    const selectorFor = (el) => {
      if (!ed) return null;
      if (ed.selectorFor) return ed.selectorFor(el);
      for (const cls of Object.keys(ed.classFor || {})) if (el.classList.contains(cls)) return ed.classFor[cls];
      return null;
    };

    // True for the fold's OWN saved mobile-overrides sheet, BY PATHNAME — so it still
    // matches after NS.reloadDevStylesheet bumps a ?v= cache-buster onto the href.
    const isMobileOverridesSheet = (sheet) => {
      if (!sheet.href) return false;
      try { return new URL(sheet.href, location.href).pathname === `/css/folds/${foldId}.overrides.mobile.css`; }
      catch { return false; }
    };

    // Last declared value of `prop` for `selector`, descending into @media rules that
    // CURRENTLY apply (we're in a ≤768px iframe, so the mobile cascade is the live one;
    // min-width:769px desktop blocks are skipped). Mobile base text styles live inside
    // @media blocks, so a flat scan (like desktop's declaredValue) would miss them.
    const scanRules = (rules, selector, prop, value) => {
      for (const rule of rules) {
        if (rule.media) { // CSSMediaRule — only descend if it applies at this viewport
          let applies = true;
          try { applies = window.matchMedia(rule.media.mediaText).matches; } catch { applies = true; }
          if (applies && rule.cssRules) value = scanRules(rule.cssRules, selector, prop, value);
          continue;
        }
        if (!rule.style || !rule.selectorText) continue;
        if (!rule.selectorText.split(',').some((s) => s.trim() === selector)) continue;
        const v = rule.style.getPropertyValue(prop);
        if (v) value = v.trim();
      }
      return value;
    };

    // The fold's mobile default for a prop, EXCLUDING our live <style> and the saved
    // mobile-overrides file. Used as the dirty-comparison base so seeded overrides
    // round-trip losslessly (re-typing a saved value compares against the fold base,
    // not against itself) — the key divergence from dev-editor.js, which doesn't seed.
    const declaredBase = (selector, prop) => {
      let value = '';
      for (const sheet of document.styleSheets) {
        if (sheet.ownerNode && sheet.ownerNode === liveStyle) continue;
        if (isMobileOverridesSheet(sheet)) continue;
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        if (rules) value = scanRules(rules, selector, prop, value);
      }
      return value;
    };

    // Push the current selection's per-field inspector values to the parent. Sent only
    // on (re)selection — NOT on every keystroke — so it never fights the user's typing.
    const emitValues = (selector) => {
      const values = {};
      for (const prop of CSS_PROPS) {
        const base = declaredBase(selector, prop);
        const override = overrides[selector] && overrides[selector][prop];
        values[prop] = { value: override != null ? override : base, placeholder: base || '—' };
      }
      post('ed:values', { selector, values });
    };

    // --- Selection -------------------------------------------------------------
    const select = (el) => {
      if (selectedEl === el) return;
      if (selectedEl) selectedEl.classList.remove('is-dev-selected');
      selectedEl = el;
      el.classList.add('is-dev-selected');
      const sel = selectorFor(el);
      curSelector = sel || '';
      if (sel) emitValues(sel);
      else post('ed:values', { selector: '', values: {} });
      post('ed:readout', { selector: sel || '(no CSS selector)' });
      renderStructure();
    };

    // --- Inline text editing (ported verbatim from dev-editor.js) --------------
    const enterEdit = (el) => {
      if (editingEl) editingEl.blur();
      editingEl = el;
      const preEditValue = el.textContent;
      try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; }
      if (el.contentEditable !== 'plaintext-only' && el.contentEditable !== 'true') el.contentEditable = 'true';
      el.focus();
      const onKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); el.textContent = preEditValue; el.blur(); }
      };
      const onPaste = (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
      };
      const onBlur = () => {
        el.removeAttribute('contenteditable');
        el.removeEventListener('keydown', onKey);
        el.removeEventListener('paste', onPaste);
        editingEl = null;
      };
      el.addEventListener('keydown', onKey);
      el.addEventListener('paste', onPaste);
      el.addEventListener('blur', onBlur, { once: true });
    };

    // --- Delegated click / dbl-click (document-level; gated by active + rootEl) -
    // All folds are pre-rendered, but only the active fold's rootEl is targeted, so a
    // contains() guard keeps us scoped to the visible fold without rebinding per fold.
    const onClick = (e) => {
      if (!active || !ed || !rootEl) return;
      const el = e.target.closest(ed.selectSelectors);
      if (!el || !rootEl.contains(el)) return;
      e.preventDefault();   // block any link nav (harmless no-op for fold text nodes)
      e.stopPropagation();
      select(el);
    };
    const onDblClick = (e) => {
      if (!active || !ed || !rootEl) return;
      const el = e.target.closest(editSelectors);
      if (!el || !rootEl.contains(el)) return;
      e.preventDefault();
      e.stopPropagation();
      select(el);
      enterEdit(el);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('dblclick', onDblClick);

    // --- Structure adapter bridge ----------------------------------------------
    // The per-fold renderStructure(api) is reused UNCHANGED across all six folds; we
    // only reimplement api.group() to POST the button specs to the parent instead of
    // building an in-page DOM box. Button callbacks still run here, in the frame.
    const moveBefore = (node, ref) => node.parentElement.insertBefore(node, ref);
    const insertAfter = (newNode, refNode) => refNode.parentElement.insertBefore(newNode, refNode.nextSibling);
    const reorder = (node, dir) => {
      const sib = dir < 0 ? node.previousElementSibling : node.nextElementSibling;
      if (!sib) return;
      if (dir < 0) moveBefore(node, sib);
      else moveBefore(sib, node);
    };
    const group = (title, btns) => {
      const buttons = [];
      for (const [label, btnTitle, fn] of btns) { // dev-editor.js api.group takes [text, title, fn] tuples
        const id = `${renderEpoch}:${actionMap.size}`;
        actionMap.set(id, fn);
        buttons.push({ label, title: btnTitle || '', id });
      }
      pendingGroups.push({ title, buttons });
    };
    const api = {
      get selected() { return selectedEl; },
      clearSelection() { selectedEl = null; }, // matches dev-editor.js (outline drops with the node)
      group, reorder, moveBefore, insertAfter, select, enterEdit, refresh: renderStructure,
    };
    function renderStructure() {
      if (!ed || !active) return;
      renderEpoch++;
      actionMap = new Map(); // rebuilt from scratch each render → no stale-callback leak
      pendingGroups = [];
      ed.renderStructure(api);
      post('ed:buttons', { fold: foldId, groups: pendingGroups });
    }

    // --- CSS inspector field change (from the parent) --------------------------
    const onFieldChange = (prop, value) => {
      const selector = curSelector;
      if (!selector) return;
      const base = declaredBase(selector, prop);
      const v = (value || '').trim();
      if (v && v !== base) {
        (overrides[selector] = overrides[selector] || {})[prop] = v;
      } else if (overrides[selector]) {
        delete overrides[selector][prop];
        if (!Object.keys(overrides[selector]).length) delete overrides[selector];
      }
      renderLiveStyle(); // live preview only; the parent input already holds the typed value
    };

    // --- Seed overrides from the fold's OWN saved mobile file (lossless re-save) -
    // Read css/folds/<fold>.overrides.mobile.css and descend into its single @media
    // block so a re-save preserves prior work (dev-editor.js does NOT seed). Matched
    // by pathname so it still works after a ?v= reload.
    const seedFromSaved = () => {
      const allowed = ed?.cssSelectors || [];
      for (const sheet of document.styleSheets) {
        if (!isMobileOverridesSheet(sheet)) continue;
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        if (!rules) continue;
        for (const rule of rules) {
          const inner = rule.cssRules; // CSSMediaRule → its nested style rules
          if (!inner) continue;
          for (const r of inner) {
            const sel = r.selectorText && r.selectorText.trim();
            if (!sel || !allowed.includes(sel)) continue;
            for (const prop of CSS_PROPS) {
              const val = r.style.getPropertyValue(prop);
              if (val) (overrides[sel] = overrides[sel] || {})[prop] = val.trim();
            }
          }
        }
      }
    };

    // --- Saves -----------------------------------------------------------------
    const postReq = (url, payload) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-Key': NS.devAuth?.key?.() || '' },
        body: JSON.stringify(payload),
      });

    // Words → content/<fold>.json (SHARED with desktop; content has no breakpoints).
    const saveText = async () => {
      if (editingEl) editingEl.blur(); // commit any in-progress inline edit first
      let ok = false;
      try { ok = (await postReq('/__dev/content', ed.scrape())).ok; } catch { ok = false; }
      post('ed:save-result', { target: 'text', ok });
    };
    // Style → css/folds/<fold>.overrides.mobile.css (mobile-only; never touches desktop).
    const saveCss = async () => {
      let ok = false;
      try {
        const res = await postReq('/__dev/css-mobile', { fold: foldId, overrides });
        ok = res.ok;
        if (ok) NS.reloadDevStylesheet?.(`/css/folds/${foldId}.overrides.mobile.css`); // reflect in-session
      } catch { ok = false; }
      post('ed:save-result', { target: 'css', ok });
    };

    // --- Mode (active) gate -----------------------------------------------------
    const setActive = (on) => {
      if (active === on) return;
      active = on;
      if (!active) {
        if (editingEl) editingEl.blur();
        if (selectedEl) { selectedEl.classList.remove('is-dev-selected'); selectedEl = null; }
        curSelector = '';
        post('ed:buttons', { fold: foldId, groups: [] }); // clear the parent structure UI
      } else {
        renderStructure(); // (re)populate the fold-level structure buttons
      }
    };

    // --- Resolve / re-resolve the active fold's editor -------------------------
    const syncFold = (id) => {
      if (editingEl) editingEl.blur();
      if (selectedEl) selectedEl.classList.remove('is-dev-selected');
      selectedEl = null;
      curSelector = '';
      foldId = id;
      const cfg = NS.devConfigs && NS.devConfigs[id];
      ed = (cfg && cfg.editor) || null;
      rootEl = ed ? document.querySelector(ed.rootSelector) : null;
      editSelectors = ed ? (ed.editSelectors || ed.selectSelectors) : '';
      overrides = {};
      devStyle.textContent = ed
        ? `${ed.selectSelectors} { cursor: text; }\n` +
          `.is-dev-selected { outline: 2px solid #4aa3ff !important; outline-offset: 3px; }`
        : '';
      if (ed && rootEl) seedFromSaved();
      renderLiveStyle();
      post('ed:fold', { fold: foldId, hasEditor: !!(ed && rootEl) });
      if (active) renderStructure();
    };

    // --- Parent → agent messages -----------------------------------------------
    const onMessage = (e) => {
      if (e.origin !== ORIGIN || e.source !== PARENT) return; // same-origin + our parent only
      const msg = e.data || {};
      switch (msg.type) {
        case 'mode':
          setActive(msg.mode === 'text');
          break;
        case 'ed:action':
          actionMap.get(msg.id)?.(); // stale id (epoch mismatch) → undefined → no-op
          break;
        case 'ed:field':
          onFieldChange(msg.prop, msg.value);
          break;
        case 'ed:save-text':
          saveText();
          break;
        case 'ed:save-css':
          saveCss();
          break;
        case 'ed:save-all':
          (async () => { await saveText(); await saveCss(); })();
          break;
      }
    };
    window.addEventListener('message', onMessage);

    // Cmd/Ctrl+S inside the frame saves both (text + style), but only in text mode so
    // it doesn't fight the layout agent's own Cmd/Ctrl+S (gated on ITS active flag).
    const onKeyDown = (e) => {
      if (!active) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveText();
        saveCss();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // --- Fold lifecycle (mirrors dev-agent.js) ---------------------------------
    document.addEventListener('fold:change', (e) => syncFold(e.detail.fold));
    document.addEventListener('dev:rendered', (e) => {
      const activeFold = document.documentElement.dataset.fold || '';
      if (e.detail.fold === activeFold && e.detail.fold !== foldId) syncFold(e.detail.fold);
    });
    const initialFold = document.documentElement.dataset.fold || '';
    if (initialFold && NS.devConfigs && NS.devConfigs[initialFold]) syncFold(initialFold);

    const handle = {
      destroy() {
        window.removeEventListener('message', onMessage);
        window.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('click', onClick);
        document.removeEventListener('dblclick', onDblClick);
        if (editingEl) editingEl.blur();
        if (selectedEl) selectedEl.classList.remove('is-dev-selected');
        devStyle.remove();
        liveStyle.remove();
        NS.__editAgentBuilt = false;
        NS.__editAgentHandle = null;
      },
    };
    NS.__editAgentHandle = handle;
    return handle;
  };
})();
