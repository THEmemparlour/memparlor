/* ==========================================================================
   Dev tooling config for the About fold (loaded ONLY under ?dev, before the
   generic dev-picker/dev-editor cores). Registers window.MemoryParlour.devConfigs.about.

   The media is reframed like the FAQ image — the 'object' focal crop (always fills
   the contained box; position pans the focal point, zoom ≥ cover tightens). The
   text is the eyebrow + title heading plus the poem (one line per element), so the
   editor adapter works in poem lines (reorder/add/delete) the way FAQ works in items.
   ========================================================================== */

(() => {
  'use strict';
  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  const configs = (NS.devConfigs = NS.devConfigs || {});

  const buildPoemLine = (text) => {
    const p = document.createElement('p');
    p.className = 'about__poem-line';
    p.textContent = text;
    return p;
  };

  configs.about = {
    id: 'about',
    layout: { selectors: ['.about__heading', '.about__poem'], breakpoint: 'desktop', liveStyleId: 'about-dev-layout' },
    image: {
      selector: '[data-about-media] .about__media-el',
      mode: 'object', // focal crop — always fills the window, no gaps (like FAQ)
      minZoom: 1, // never below cover
    },
    editor: {
      rootSelector: '[data-about-root]',
      selectSelectors: '.about__eyebrow, .about__title, .about__poem-line',
      classFor: {
        'about__eyebrow': '.about__eyebrow',
        'about__title': '.about__title',
        'about__poem-line': '.about__poem-line',
      },
      cssSelectors: ['.about__eyebrow', '.about__title', '.about__poem-line'],
      liveStyleId: 'about-dev-overrides',

      scrape() {
        const headingEl = document.querySelector('[data-about-heading]');
        const poemEl = document.querySelector('[data-about-poem]');
        const heading = {
          eyebrow: (headingEl?.querySelector('.about__eyebrow')?.textContent || '').trim(),
          title: (headingEl?.querySelector('.about__title')?.textContent || '').trim(),
        };
        const poem = [...poemEl.querySelectorAll('.about__poem-line')].map((p) => p.textContent.trim());
        return { fold: 'about', heading, poem };
      },

      renderStructure(api) {
        const poemEl = document.querySelector('[data-about-poem]');
        const sel = api.selected;
        const line = sel && sel.classList.contains('about__poem-line') ? sel : null;

        if (line) {
          api.group('Poem line', [
            ['↑', 'Move line up', () => api.reorder(line, -1)],
            ['↓', 'Move line down', () => api.reorder(line, 1)],
            ['＋', 'Add line below', () => {
              const p = buildPoemLine('New line.');
              api.insertAfter(p, line);
              api.select(p);
              api.enterEdit(p);
            }],
            ['✕', 'Delete line', () => {
              if (poemEl.querySelectorAll('.about__poem-line').length <= 1) return;
              if (api.selected === line) api.clearSelection();
              line.remove();
              api.refresh();
            }],
          ]);
        }

        api.group('Poem', [
          ['＋ line', 'Add line at end', () => {
            const p = buildPoemLine('New line.');
            poemEl.appendChild(p);
            api.select(p);
            api.enterEdit(p);
          }],
        ]);
      },
    },
  };

  // Config registered + DOM rendered → let the controller mount/rebuild for this fold.
  document.dispatchEvent(new CustomEvent('dev:rendered', { detail: { fold: 'about' } }));
})();
