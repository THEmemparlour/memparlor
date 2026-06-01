/* ==========================================================================
   Dev-only FAQ text + structure + CSS editor (loaded ONLY under ?dev — see
   js/faqs.js). Companion to js/faqs-dev-picker.js (which owns the image crop).

     · SINGLE-CLICK a text element → select it (fills the CSS inspector)
     · DOUBLE-CLICK                → edit its text in place (Enter = commit,
                                     Escape = revert)
     · Structure buttons           → add / remove / reorder FAQ items + answer
                                     paragraphs
     · CSS inspector               → a curated set of text properties, edited on
                                     the element's SHARED class rule, live-previewed
     · Save text   → POST /__dev/content → content/faqs.json (heading + faqs)
     · Save CSS    → POST /__dev/css     → css/folds/faqs.overrides.css

   Edits the live DOM in place (no re-render). Save scrapes the DOM, so structure
   changes need no parallel bookkeeping. Everything injected is tagged
   data-faqs-dev so it's never serialized; only the overrides CSS ships.
   ========================================================================== */

(() => {
  'use strict';

  const headingEl = document.querySelector('[data-faqs-heading]');
  const listEl = document.querySelector('[data-faqs-list]');
  if (!headingEl || !listEl) {
    console.warn('[faqs-dev-editor] FAQ DOM not found — editor not started');
    return;
  }

  // Editable text classes → kind (used for selection + CSS selector mapping).
  const TEXT_SELECTOR = '.faqs__eyebrow, .faqs__title, .faqs__question, .faqs__answer-line';
  const CLASS_FOR = {
    'faqs__eyebrow': '.faqs__eyebrow',
    'faqs__title': '.faqs__title',
    'faqs__question': '.faqs__question',
    'faqs__answer-line': '.faqs__answer-line',
  };

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
  const LIVE_STYLE_ID = 'faqs-dev-overrides';

  // overrides: { '.faqs__question': { 'font-size': '2rem', ... } } — dirty props only.
  const overrides = {};
  let selectedEl = null;

  // --- Injected dev styles (selection highlight; never shipped) --------------
  const devStyle = document.createElement('style');
  devStyle.setAttribute('data-faqs-dev', '');
  devStyle.textContent = `
    .faqs ${TEXT_SELECTOR.split(',').join(', .faqs ')} { cursor: text; }
    .is-dev-selected { outline: 2px solid #4aa3ff !important; outline-offset: 3px; }
    [data-faqs-dev-controls] { display: flex; gap: 4px; }
    [data-faqs-dev-controls] button { font: inherit; cursor: pointer; color: #f7f5e7;
      background: rgba(247,245,231,0.12); border: 1px solid rgba(247,245,231,0.25);
      border-radius: 4px; padding: 3px 7px; line-height: 1; }
  `;
  document.head.appendChild(devStyle);

  // Live-preview stylesheet (after everything else so it wins the cascade).
  const liveStyle = document.createElement('style');
  liveStyle.id = LIVE_STYLE_ID;
  liveStyle.setAttribute('data-faqs-dev', '');
  document.head.appendChild(liveStyle);

  // --- Selection -------------------------------------------------------------
  const selectorFor = (el) => {
    for (const cls of Object.keys(CLASS_FOR)) if (el.classList.contains(cls)) return CLASS_FOR[cls];
    return null;
  };

  function select(el) {
    if (selectedEl === el) return;
    if (selectedEl) selectedEl.classList.remove('is-dev-selected');
    selectedEl = el;
    el.classList.add('is-dev-selected');
    populateInspector(selectorFor(el));
    renderStructure();
    readout.textContent = `selected: ${selectorFor(el)}`;
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

  // Delegated click/dblclick on the fold (survives structure mutations).
  const faqRoot = document.querySelector('[data-faqs-root]') || listEl.parentElement;
  faqRoot.addEventListener('click', (e) => {
    const el = e.target.closest(TEXT_SELECTOR);
    if (!el || !faqRoot.contains(el)) return;
    e.stopPropagation();
    select(el);
  });
  faqRoot.addEventListener('dblclick', (e) => {
    const el = e.target.closest(TEXT_SELECTOR);
    if (!el) return;
    e.stopPropagation();
    select(el);
    enterEdit(el);
  });

  // --- Structure: build helpers (mirror js/faqs.js renderFaqs markup) --------
  function buildAnswerLine(text) {
    const p = document.createElement('p');
    p.className = 'faqs__answer-line';
    p.textContent = text;
    return p;
  }
  function buildItem(question, answerLines) {
    const wrap = document.createElement('div');
    wrap.className = 'faqs__item';
    const q = document.createElement('h3');
    q.className = 'faqs__question';
    q.textContent = question;
    const answer = document.createElement('div');
    answer.className = 'faqs__answer';
    for (const line of answerLines) answer.appendChild(buildAnswerLine(line));
    wrap.append(q, answer);
    return wrap;
  }

  // Context of the current selection for structure ops.
  const currentItem = () => (selectedEl ? selectedEl.closest('.faqs__item') : null);
  const currentLine = () =>
    selectedEl && selectedEl.classList.contains('faqs__answer-line') ? selectedEl : null;

  const moveBefore = (node, ref) => node.parentElement.insertBefore(node, ref); // ref=null → append
  function reorder(node, dir) {
    const sib = dir < 0 ? node.previousElementSibling : node.nextElementSibling;
    if (!sib) return;
    if (dir < 0) moveBefore(node, sib);
    else moveBefore(sib, node);
  }

  function renderStructure() {
    structureBox.textContent = '';
    const item = currentItem();
    const line = currentLine();

    const group = (title, btns) => {
      const wrap = document.createElement('div');
      const label = document.createElement('div');
      label.textContent = title;
      label.style.cssText = 'opacity:.6;margin:6px 0 3px;';
      const row = document.createElement('div');
      row.setAttribute('data-faqs-dev-controls', '');
      for (const [text, title2, fn] of btns) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.title = title2;
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        row.appendChild(b);
      }
      wrap.append(label, row);
      structureBox.appendChild(wrap);
    };

    if (item) {
      group('FAQ item', [
        ['↑', 'Move item up', () => reorder(item, -1)],
        ['↓', 'Move item down', () => reorder(item, 1)],
        ['＋', 'Add item below', () => {
          const it = buildItem('New question?', ['New answer.']);
          moveBefore(it, item.nextElementSibling);
          enterEdit(it.querySelector('.faqs__question'));
          select(it.querySelector('.faqs__question'));
        }],
        ['✕', 'Delete item', () => {
          if (listEl.querySelectorAll('.faqs__item').length <= 1) return;
          if (selectedEl && item.contains(selectedEl)) { selectedEl = null; }
          item.remove();
          renderStructure();
        }],
      ]);
    }
    if (line) {
      const answer = line.parentElement;
      group('Answer line', [
        ['↑', 'Move line up', () => reorder(line, -1)],
        ['↓', 'Move line down', () => reorder(line, 1)],
        ['＋', 'Add line below', () => {
          const p = buildAnswerLine('New answer.');
          moveBefore(p, line.nextElementSibling);
          enterEdit(p);
          select(p);
        }],
        ['✕', 'Delete line', () => {
          if (answer.querySelectorAll('.faqs__answer-line').length <= 1) return;
          if (selectedEl === line) selectedEl = null;
          line.remove();
          renderStructure();
        }],
      ]);
    }
    group('List', [
      ['＋ question', 'Add question at end', () => {
        const it = buildItem('New question?', ['New answer.']);
        listEl.appendChild(it);
        select(it.querySelector('.faqs__question'));
        enterEdit(it.querySelector('.faqs__question'));
      }],
    ]);
  }

  // --- CSS inspector ---------------------------------------------------------
  // Read the DECLARED value of `prop` for `selector` from the stylesheets
  // (preserves clamp()/var(); computed style would bake responsive px). Skips
  // our own live <style> so the baseline reflects faqs.css + persisted overrides.
  function declaredValue(selector, prop) {
    let value = '';
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode && sheet.ownerNode.id === LIVE_STYLE_ID) continue;
      let rules;
      try { rules = sheet.cssRules; } catch { continue; } // cross-origin (fonts)
      if (!rules) continue;
      for (const rule of rules) {
        if (!rule.style || !rule.selectorText) continue;
        const matches = rule.selectorText.split(',').some((s) => s.trim() === selector);
        if (!matches) continue;
        const v = rule.style.getPropertyValue(prop);
        if (v) value = v.trim();
      }
    }
    return value;
  }

  const fieldInputs = new Map(); // prop -> input/select element

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

  function serializeOverrides() {
    const blocks = [];
    for (const selector of Object.values(CLASS_FOR)) {
      const props = overrides[selector];
      if (!props) continue;
      const lines = CSS_PROP_ORDER.filter((p) => p in props).map((p) => `  ${p}: ${props[p]};`);
      if (lines.length) blocks.push(`${selector} {\n${lines.join('\n')}\n}`);
    }
    return blocks.join('\n\n');
  }
  function renderLiveStyle() {
    liveStyle.textContent = serializeOverrides();
  }

  // --- Panel -----------------------------------------------------------------
  const panel = document.createElement('div');
  panel.setAttribute('data-faqs-dev', '');
  Object.assign(panel.style, {
    position: 'fixed', top: '92px', right: '16px', zIndex: '9999', width: '236px',
    maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
    font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
    background: 'rgba(20,19,16,0.92)', color: '#f7f5e7', padding: '10px',
    borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '6px',
  });

  const title = document.createElement('div');
  title.textContent = 'FAQ EDITOR';
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
      border: '1px solid rgba(247,245,231,0.25)', borderRadius: '4px', padding: '2px 4px',
      minWidth: '0',
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
      const label = text;
      b.textContent = 'Saving…';
      try {
        const res = await run();
        b.textContent = res.ok ? 'Saved ✓' : 'Save failed';
      } catch {
        b.textContent = 'Save failed';
      }
      setTimeout(() => { b.textContent = label; }, 1400);
    });
    return b;
  };

  const post = (url, payload) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  // Scrape the live DOM → faqs.json shape (authoritative; survives reorders).
  function scrapeContent() {
    const heading = {
      eyebrow: (headingEl.querySelector('.faqs__eyebrow')?.textContent || '').trim(),
      title: (headingEl.querySelector('.faqs__title')?.textContent || '').trim(),
    };
    const faqs = [...listEl.querySelectorAll('.faqs__item')].map((item) => ({
      question: (item.querySelector('.faqs__question')?.textContent || '').trim(),
      answer: [...item.querySelectorAll('.faqs__answer-line')].map((p) => p.textContent.trim()),
    }));
    return { fold: 'faqs', heading, faqs };
  }

  const saveText = mkSave('Save text', () => post('/__dev/content', scrapeContent()));
  const saveCss = mkSave('Save CSS', () => post('/__dev/css', { fold: 'faqs', overrides }));

  panel.append(title, readout, structureBox, inspectorBox, saveText, saveCss);
  document.body.appendChild(panel);

  renderStructure();
})();
