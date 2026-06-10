/* ==========================================================================
   Dev tooling config for the Process fold (loaded ONLY under ?dev, before the
   generic dev-picker/dev-editor cores). Registers window.MemoryParlour.devConfigs.process.

   Image: the FAQ-style 'object' focal crop. The video band bleeds off the bottom,
   but it's a fixed object-fit:cover box, so the crop reframes which part shows and
   the box always stays filled (position pans the focal point, zoom ≥ cover).

   Text (JSON, no markdown): the heading + the bold lede lines + the numbered steps
   (title + description). The step number is derived from array order by the
   renderer, so it's never scraped and is re-derived after every structural edit.
   ========================================================================== */

(() => {
  'use strict';
  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  const configs = (NS.devConfigs = NS.devConfigs || {});

  const ledeEl = () => document.querySelector('[data-process-lede]');
  const stepsEl = () => document.querySelector('[data-process-steps]');

  const buildLedeLine = (text) => {
    const p = document.createElement('p');
    p.className = 'process__lede-line';
    p.textContent = text;
    return p;
  };

  const buildStep = (title, description) => {
    const li = document.createElement('li');
    li.className = 'process__step';
    const head = document.createElement('div');
    head.className = 'process__step-head';
    const num = document.createElement('span');
    num.className = 'process__step-num'; // text set by renumber()
    const titleSpan = document.createElement('span');
    titleSpan.className = 'process__step-title';
    titleSpan.textContent = title;
    head.append(num, titleSpan);
    const desc = document.createElement('p');
    desc.className = 'process__step-desc';
    desc.textContent = description;
    li.append(head, desc);
    return li;
  };

  // Re-derive the "1." "2." … prefixes from DOM order (matches the renderer, which
  // numbers by array index rather than storing the number in the data).
  const renumber = () => {
    [...stepsEl().querySelectorAll('.process__step')].forEach((li, i) => {
      const num = li.querySelector('.process__step-num');
      if (num) num.textContent = `${i + 1}.`;
    });
  };

  configs.process = {
    id: 'process',
    layout: { selectors: ['.process__heading', '.process__lede', '.process__steps'], breakpoint: 'desktop', liveStyleId: 'process-dev-layout' },
    image: {
      selector: '[data-process-media] .process__media-el',
      mode: 'object', // focal crop — always fills the (bleeding) box, no gaps
      minZoom: 1, // never below cover
    },
    media: { selector: '[data-process-media] .process__media-el', kind: 'video' },
    editor: {
      rootSelector: '[data-process-root]',
      selectSelectors: '.process__eyebrow, .process__title, .process__lede-line, .process__step-title, .process__step-desc',
      cssSelectors: ['.fold-eyebrow', '.fold-title', '.process__lede-line', '.process__step-head', '.process__step-desc'],
      liveStyleId: 'process-dev-overrides',

      // The step title/description carry their own classes but their styles live on
      // the shared `.process__step-head` / `.process__step-desc` rules. Eyebrow/title map
      // to the shared cross-fold heading rule (css/folds/headings.css).
      selectorFor(el) {
        if (el.classList.contains('process__eyebrow')) return '.fold-eyebrow';
        if (el.classList.contains('process__title')) return '.fold-title';
        if (el.classList.contains('process__lede-line')) return '.process__lede-line';
        if (el.classList.contains('process__step-title')) return '.process__step-head';
        if (el.classList.contains('process__step-desc')) return '.process__step-desc';
        return null;
      },

      scrape() {
        const headingEl = document.querySelector('[data-process-heading]');
        const heading = {
          eyebrow: (headingEl?.querySelector('.process__eyebrow')?.textContent || '').trim(),
          title: (headingEl?.querySelector('.process__title')?.textContent || '').trim(),
        };
        const lede = [...ledeEl().querySelectorAll('.process__lede-line')]
          .map((p) => p.textContent.trim())
          .filter(Boolean);
        const steps = [...stepsEl().querySelectorAll('.process__step')].map((li) => ({
          title: (li.querySelector('.process__step-title')?.textContent || '').trim(),
          description: (li.querySelector('.process__step-desc')?.textContent || '').trim(),
        }));
        return { fold: 'process', heading, lede, steps };
      },

      renderStructure(api) {
        const sel = api.selected;
        const ledeLine = sel && sel.classList.contains('process__lede-line') ? sel : null;
        const step = sel ? sel.closest('.process__step') : null;

        if (ledeLine) {
          api.group('Lede line', [
            ['↑', 'Move up', () => api.reorder(ledeLine, -1)],
            ['↓', 'Move down', () => api.reorder(ledeLine, 1)],
            ['＋', 'Add line after', () => {
              const p = buildLedeLine('New line.');
              api.insertAfter(p, ledeLine);
              api.select(p);
              api.enterEdit(p);
            }],
            ['✕', 'Delete line', () => {
              if (ledeEl().querySelectorAll('.process__lede-line').length <= 1) return;
              if (api.selected === ledeLine) api.clearSelection();
              ledeLine.remove();
              api.refresh();
            }],
          ]);
        }

        if (step) {
          const addStep = (ref) => {
            const s = buildStep('New step', 'New description.');
            if (ref) api.insertAfter(s, ref);
            else stepsEl().appendChild(s);
            renumber();
            api.select(s.querySelector('.process__step-title'));
            api.enterEdit(s.querySelector('.process__step-title'));
          };
          api.group('Step', [
            ['↑', 'Move step up', () => { api.reorder(step, -1); renumber(); api.refresh(); }],
            ['↓', 'Move step down', () => { api.reorder(step, 1); renumber(); api.refresh(); }],
            ['＋', 'Add step below', () => addStep(step)],
            ['✕', 'Delete step', () => {
              if (stepsEl().querySelectorAll('.process__step').length <= 1) return;
              if (api.selected && step.contains(api.selected)) api.clearSelection();
              step.remove();
              renumber();
              api.refresh();
            }],
          ]);
        }

        api.group('Lede', [
          ['＋ line', 'Add lede line at end', () => {
            const p = buildLedeLine('New line.');
            ledeEl().appendChild(p);
            api.select(p);
            api.enterEdit(p);
          }],
        ]);
        api.group('Steps', [
          ['＋ step', 'Add step at end', () => {
            const s = buildStep('New step', 'New description.');
            stepsEl().appendChild(s);
            renumber();
            api.select(s.querySelector('.process__step-title'));
            api.enterEdit(s.querySelector('.process__step-title'));
          }],
        ]);
      },
    },
  };

  // Config registered + DOM rendered → let the controller mount/rebuild for this fold.
  document.dispatchEvent(new CustomEvent('dev:rendered', { detail: { fold: 'process' } }));
})();
