/* ==========================================================================
   Dev-only text + structure + CSS editor — GENERIC core (loaded ONLY under ?dev).
   Registers window.MemoryParlour.buildEditor(cfg), driven by a fold's
   devConfigs[fold].editor:
     { rootSelector, selectSelectors, editSelectors, classFor, selectorFor,
       cssSelectors, liveStyleId, scrape(), renderStructure(api) }
   The core owns all the shared mechanics (selection, contenteditable lifecycle,
   the curated CSS inspector, declared-value seeding, live preview, the two Save
   buttons). Each fold's config supplies the selectors + a content adapter
   (scrape → JSON, and the fold-specific structure controls).

   The dev controller calls buildEditor on fold-enter and destroy() on fold-leave,
   so exactly one editor exists at a time and switching folds reseats it.

   Edits the live DOM in place (no re-render); Save scrapes the DOM. Injected
   nodes are tagged data-mp-dev and never serialized — only the overrides CSS ships.
   ========================================================================== */

(() => {
  'use strict';

  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  if (NS.buildEditor) return; // define the builder once (every fold re-injects this core)

  // Re-fetch a saved dev stylesheet so the running SPA reflects it. index.html's
  // override/layout <link>s are fetched once at page load; after a Save the file on
  // disk changes but the loaded sheet doesn't, and the live-preview <style> is
  // removed on fold-leave — so without this a fold shows its page-load CSS until a
  // full reload (while the deployed site, a fresh load, shows the save). Bumping a
  // ?v= query forces a fresh fetch; the dev server ignores the query when resolving
  // the file. Shared by the CSS editor + the layout tool.
  NS.reloadDevStylesheet = NS.reloadDevStylesheet || ((href) => {
    const want = new URL(href, location.href).pathname;
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      if (new URL(link.href, location.href).pathname !== want) continue;
      const u = new URL(link.href, location.href);
      u.searchParams.set('v', String(Date.now()));
      link.href = u.href;
      return true;
    }
    return false;
  });

  // Build the editor for a fold's config; returns { destroy } for teardown, or
  // null when the fold has no editor config or its root isn't in the DOM.
  NS.buildEditor = (cfg) => {
    if (!cfg || !cfg.editor) return null;

    const foldId = cfg.id;
    const ed = cfg.editor;
    const rootEl = document.querySelector(ed.rootSelector);
    if (!rootEl) {
      console.warn(`[dev-editor] root (${ed.rootSelector}) not found for fold "${foldId}"`);
      return null;
    }
    const editSelectors = ed.editSelectors || ed.selectSelectors;

    // Curated CSS properties — MUST match the server whitelist (POST /__dev/css).
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
    const CSS_PROP_ORDER = CSS_FIELDS.map((f) => f.prop);

    const overrides = {}; // { selector: { prop: value } } — dirty props only
    let selectedEl = null;

    // --- Shared heading typography (cross-fold) --------------------------------
    // These eyebrow/title selectors are styled by ONE file (headings.overrides.css),
    // so a Save on any fold restyles every fold's heading; all other selectors stay in
    // the fold's own overrides file. Home is exempt — it has no createHeading heading.
    const SHARED = {
      selectors: ['.fold-eyebrow', '.fold-title'],
      fold: 'headings',
      href: '/css/folds/headings.overrides.css',
    };
    const isShared = (sel) => SHARED.selectors.includes(sel);
    // Pre-load any already-saved shared values into `overrides` so a later Save re-emits
    // the full shared diff. Without this, editing headings from a second fold would drop
    // (clobber) what an earlier fold saved — the server rewrites the whole file each Save.
    function seedSharedOverrides() {
      const wantPath = new URL(SHARED.href, location.href).pathname;
      for (const sheet of document.styleSheets) {
        const node = sheet.ownerNode;
        if (!node || !node.href || new URL(node.href, location.href).pathname !== wantPath) continue;
        let rules;
        try { rules = sheet.cssRules; } catch { return; }
        for (const rule of rules || []) {
          if (!rule.style || !rule.selectorText) continue;
          const sel = rule.selectorText.trim();
          if (!isShared(sel)) continue;
          for (const { prop } of CSS_FIELDS) {
            const v = rule.style.getPropertyValue(prop);
            if (v) (overrides[sel] = overrides[sel] || {})[prop] = v.trim();
          }
        }
        return;
      }
    }
    seedSharedOverrides();

    // --- Injected dev styles (never shipped) -----------------------------------
    const devStyle = document.createElement('style');
    devStyle.setAttribute('data-mp-dev', '');
    devStyle.textContent = `
      ${ed.selectSelectors} { cursor: text; }
      .is-dev-selected { outline: 2px solid #4aa3ff !important; outline-offset: 3px; }
      [data-mp-dev-controls] { display: flex; gap: 4px; flex-wrap: wrap; }
      [data-mp-dev-controls] button { font: inherit; cursor: pointer; color: #f7f5e7;
        background: rgba(247,245,231,0.12); border: 1px solid rgba(247,245,231,0.25);
        border-radius: 4px; padding: 3px 7px; line-height: 1; }
    `;
    document.head.appendChild(devStyle);

    const liveStyle = document.createElement('style');
    liveStyle.id = ed.liveStyleId;
    liveStyle.setAttribute('data-mp-dev', '');
    document.head.appendChild(liveStyle);

    // --- Selection -------------------------------------------------------------
    // Map a selected element → the CSS selector the inspector edits. A config may
    // supply selectorFor(el) for tag/context-based selectors (e.g. ".services__list
    // h2", which has no class); otherwise fall back to the classFor class map.
    const selectorFor = (el) => {
      if (ed.selectorFor) return ed.selectorFor(el);
      for (const cls of Object.keys(ed.classFor || {})) if (el.classList.contains(cls)) return ed.classFor[cls];
      return null;
    };

    function select(el) {
      if (selectedEl === el) return;
      if (selectedEl) selectedEl.classList.remove('is-dev-selected');
      selectedEl = el;
      el.classList.add('is-dev-selected');
      const sel = selectorFor(el);
      if (sel) populateInspector(sel);
      renderStructure();
      readout.textContent = sel ? `selected: ${sel}` : 'selected';
    }

    // --- Inline text editing ---------------------------------------------------
    let editingEl = null;
    let preEditValue = '';
    function enterEdit(el) {
      if (editingEl) editingEl.blur();
      editingEl = el;
      preEditValue = el.textContent;
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
    }

    // Delegated click/dblclick (survives structure mutations). Optional capture
    // phase + an `active` gate let a non-fold target (the nav) intercept clicks
    // before the element's own handlers and suppress navigation while editing.
    let active = true;
    const useCapture = !!ed.captureClicks;
    const onRootClick = (e) => {
      if (!active) return;
      const el = e.target.closest(ed.selectSelectors);
      if (!el || !rootEl.contains(el)) return;
      e.preventDefault();   // block link navigation (harmless no-op for fold text nodes)
      e.stopPropagation();  // capture phase: also stops a same-element bubble handler (nav.js)
      select(el);
    };
    const onRootDblClick = (e) => {
      if (!active) return;
      const el = e.target.closest(editSelectors);
      if (!el || !rootEl.contains(el)) return;
      e.preventDefault();
      e.stopPropagation();
      select(el);
      enterEdit(el);
    };
    rootEl.addEventListener('click', onRootClick, useCapture);
    rootEl.addEventListener('dblclick', onRootDblClick, useCapture);

    // --- Structure (delegated to the fold adapter) -----------------------------
    const moveBefore = (node, ref) => node.parentElement.insertBefore(node, ref);
    // Insert a NEW node right after an existing reference node (uses the ref's
    // parent — `node.parentElement` is null for a not-yet-inserted node).
    const insertAfter = (newNode, refNode) => refNode.parentElement.insertBefore(newNode, refNode.nextSibling);
    function reorder(node, dir) {
      const sib = dir < 0 ? node.previousElementSibling : node.nextElementSibling;
      if (!sib) return;
      if (dir < 0) moveBefore(node, sib);
      else moveBefore(sib, node);
    }
    function group(title, btns) {
      const wrap = document.createElement('div');
      const lab = document.createElement('div');
      lab.textContent = title;
      lab.style.cssText = 'opacity:.6;margin:6px 0 3px;';
      const row = document.createElement('div');
      row.setAttribute('data-mp-dev-controls', '');
      for (const [text, title2, fn] of btns) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.title = title2;
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        row.appendChild(b);
      }
      wrap.append(lab, row);
      structureBox.appendChild(wrap);
    }
    const api = {
      get selected() { return selectedEl; },
      clearSelection() { selectedEl = null; },
      group, reorder, moveBefore, insertAfter, select, enterEdit, refresh: renderStructure,
    };
    function renderStructure() {
      structureBox.textContent = '';
      ed.renderStructure(api);
    }

    // --- CSS inspector ---------------------------------------------------------
    // Read the DECLARED value (preserves clamp()/var()); skip our live <style> and
    // cross-origin sheets. Last writer in cascade order wins.
    function declaredValue(selector, prop) {
      let value = '';
      for (const sheet of document.styleSheets) {
        if (sheet.ownerNode && sheet.ownerNode.id === ed.liveStyleId) continue;
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        if (!rules) continue;
        for (const rule of rules) {
          if (!rule.style || !rule.selectorText) continue;
          if (!rule.selectorText.split(',').some((s) => s.trim() === selector)) continue;
          const v = rule.style.getPropertyValue(prop);
          if (v) value = v.trim();
        }
      }
      return value;
    }

    const fieldInputs = new Map();
    function populateInspector(selector) {
      inspectorBox.dataset.selector = selector;
      for (const { prop } of CSS_FIELDS) {
        const input = fieldInputs.get(prop);
        const override = overrides[selector] && overrides[selector][prop];
        input.value = override != null ? override : declaredValue(selector, prop);
        input.placeholder = declaredValue(selector, prop) || '—';
      }
    }
    function onFieldChange(prop, value) {
      const selector = inspectorBox.dataset.selector;
      if (!selector) return;
      const base = declaredValue(selector, prop);
      const v = value.trim();
      if (v && v !== base) {
        (overrides[selector] = overrides[selector] || {})[prop] = v;
      } else if (overrides[selector]) {
        delete overrides[selector][prop];
        if (!Object.keys(overrides[selector]).length) delete overrides[selector];
      }
      renderLiveStyle();
    }
    function renderLiveStyle() {
      const blocks = [];
      for (const selector of ed.cssSelectors) {
        const props = overrides[selector];
        if (!props) continue;
        const lines = CSS_PROP_ORDER.filter((p) => p in props).map((p) => `  ${p}: ${props[p]};`);
        if (lines.length) blocks.push(`${selector} {\n${lines.join('\n')}\n}`);
      }
      liveStyle.textContent = blocks.join('\n\n');
    }

    // --- Panel -----------------------------------------------------------------
    const panel = document.createElement('div');
    panel.setAttribute('data-mp-dev', '');
    Object.assign(panel.style, {
      position: 'fixed', top: '92px', right: '16px', zIndex: '9999', width: '236px',
      maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
      font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
      background: 'rgba(20,19,16,0.92)', color: '#f7f5e7', padding: '10px',
      borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '6px',
    });
    if (ed.panelStyle) Object.assign(panel.style, ed.panelStyle); // e.g. dock the nav panel left

    const title = document.createElement('div');
    title.textContent = `${foldId.toUpperCase()} EDITOR`;
    title.style.cssText = 'opacity:.6;letter-spacing:.08em;';
    const readout = document.createElement('div');
    readout.textContent = 'click text to select · dbl-click to edit';

    const structureBox = document.createElement('div');
    const inspectorBox = document.createElement('div');
    inspectorBox.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:6px;';
    const cssLabel = document.createElement('div');
    cssLabel.textContent = 'CSS (shared class)';
    cssLabel.style.cssText = 'opacity:.6;margin-top:6px;';
    inspectorBox.appendChild(cssLabel);

    for (const field of CSS_FIELDS) {
      const row = document.createElement('label');
      row.style.cssText = 'display:grid;grid-template-columns:84px 1fr;gap:6px;align-items:center;';
      const name = document.createElement('span');
      name.textContent = field.prop;
      name.style.cssText = 'opacity:.8;overflow:hidden;text-overflow:ellipsis;';
      let input;
      if (field.type === 'select') {
        input = document.createElement('select');
        for (const opt of field.options) {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt || '(unset)';
          input.appendChild(o);
        }
      } else {
        input = document.createElement('input');
        input.type = 'text';
      }
      Object.assign(input.style, {
        font: 'inherit', color: '#f7f5e7', background: 'rgba(247,245,231,0.1)',
        border: '1px solid rgba(247,245,231,0.25)', borderRadius: '4px', padding: '2px 4px', minWidth: '0',
      });
      input.addEventListener('input', () => onFieldChange(field.prop, input.value));
      input.addEventListener('change', () => onFieldChange(field.prop, input.value));
      fieldInputs.set(field.prop, input);
      row.append(name, input);
      inspectorBox.appendChild(row);
    }

    const mkSave = (text, run) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      Object.assign(b.style, {
        font: 'inherit', cursor: 'pointer', color: '#f7f5e7', marginTop: '4px',
        background: 'rgba(247,245,231,0.15)', border: '1px solid rgba(247,245,231,0.3)',
        borderRadius: '4px', padding: '5px 0',
      });
      b.addEventListener('click', async () => {
        b.textContent = 'Saving…';
        try {
          const res = await run();
          b.textContent = res.ok ? 'Saved ✓' : 'Save failed';
        } catch {
          b.textContent = 'Save failed';
        }
        setTimeout(() => { b.textContent = text; }, 1400);
      });
      return b;
    };
    const post = (url, payload) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-Key': NS.devAuth?.key?.() || '' },
        body: JSON.stringify(payload),
      });

    // Persist CSS overrides, routing the shared heading selectors to headings.overrides.css
    // and everything else to this fold's own file; reload each sheet that was written.
    // Returns a list of { target, ok } (empty when nothing is dirty).
    const saveOverrides = async () => {
      const local = {};
      const shared = {};
      for (const [sel, props] of Object.entries(overrides)) (isShared(sel) ? shared : local)[sel] = props;
      const out = [];
      if (Object.keys(local).length) {
        const r = await post('/__dev/css', { fold: foldId, overrides: local });
        if (r.ok) NS.reloadDevStylesheet?.(`/css/folds/${foldId}.overrides.css`); // reflect the save in-session
        out.push({ target: `${foldId} · css`, ok: r.ok });
      }
      if (Object.keys(shared).length) {
        const r = await post('/__dev/css', { fold: SHARED.fold, overrides: shared });
        if (r.ok) NS.reloadDevStylesheet?.(SHARED.href); // shared heading file — reflect in-session
        out.push({ target: `${SHARED.fold} · css`, ok: r.ok });
      }
      return out;
    };

    const saveText = mkSave('Save text', () => post('/__dev/content', ed.scrape()));
    const saveCss = mkSave('Save CSS', async () => {
      const out = await saveOverrides();
      return { ok: out.every((r) => r.ok) }; // empty (nothing dirty) → ok
    });

    panel.append(title, readout, structureBox, inspectorBox, saveText, saveCss);
    document.body.appendChild(panel);
    // Fold editors all share one remembered position ('editor') so it persists as
    // you scroll between folds; the persistent nav editor sets its own posKey so
    // dragging it never clobbers the fold editor's spot.
    NS.makeDraggable?.(panel, title, ed.posKey || 'editor');

    renderStructure();

    // Teardown: finalize any in-progress edit, then remove the injected styles,
    // the panel, the delegated listeners, and the selection outline.
    return {
      panel,
      // Master-save hook (the dev-controller SAVE ALL button / Cmd-Ctrl+S):
      // persist this fold's text always (idempotent — identical bytes if nothing
      // changed), and CSS only when something was edited. Saving an empty overrides
      // set would blank the saved overrides file, so skip it when nothing's dirty.
      async save() {
        if (editingEl) editingEl.blur(); // commit any in-progress inline edit first
        const out = [];
        const text = await post('/__dev/content', ed.scrape());
        out.push({ target: `${foldId} · text`, ok: text.ok });
        if (Object.keys(overrides).length) out.push(...(await saveOverrides()));
        return out;
      },
      // Show/hide + gate the editor without tearing it down (used by the nav
      // toggle); keeps unsaved edits + CSS overrides while the panel is hidden.
      setActive(v) {
        active = !!v;
        panel.style.display = active ? 'flex' : 'none';
        if (!active && selectedEl) { selectedEl.classList.remove('is-dev-selected'); selectedEl = null; }
      },
      destroy() {
        if (editingEl) editingEl.blur(); // runs onBlur: drops contenteditable + per-edit listeners
        rootEl.removeEventListener('click', onRootClick, useCapture);
        rootEl.removeEventListener('dblclick', onRootDblClick, useCapture);
        if (selectedEl) selectedEl.classList.remove('is-dev-selected');
        devStyle.remove();
        liveStyle.remove();
        panel.remove();
      },
    };
  };
})();
