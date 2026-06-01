/* ==========================================================================
   Dev tooling config for the Contact fold (loaded ONLY under ?dev, before the
   generic dev-editor core). Registers window.MemoryParlour.devConfigs.contact.

   Contact has NO image — its media is the Calendly embed — so there's no `image`
   config and the crop picker isn't loaded for this fold. The editor covers the
   heading, the single lede line (a string in the JSON, not an array), and the
   body lines (an array).
   ========================================================================== */

(() => {
  'use strict';
  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  const configs = (NS.devConfigs = NS.devConfigs || {});

  const bodyEl = () => document.querySelector('[data-contact-body]');

  const buildBodyLine = (text) => {
    const p = document.createElement('p');
    p.className = 'contact__body-line';
    p.textContent = text;
    return p;
  };

  configs.contact = {
    id: 'contact',
    layout: { selectors: ['.contact__heading', '.contact__lede', '.contact__body'], breakpoint: 'desktop', liveStyleId: 'contact-dev-layout' },
    editor: {
      rootSelector: '[data-contact-root]',
      selectSelectors: '.contact__lede, .contact__body-line, .contact__eyebrow, .contact__title',
      classFor: {
        'contact__lede': '.contact__lede',
        'contact__body-line': '.contact__body-line',
        'contact__eyebrow': '.contact__eyebrow',
        'contact__title': '.contact__title',
      },
      cssSelectors: ['.contact__lede', '.contact__body-line', '.contact__eyebrow', '.contact__title'],
      liveStyleId: 'contact-dev-overrides',

      scrape() {
        const lede = (document.querySelector('[data-contact-lede]')?.textContent || '').trim();
        const body = [...bodyEl().querySelectorAll('.contact__body-line')]
          .map((p) => p.textContent.trim())
          .filter(Boolean);
        const headingEl = document.querySelector('[data-contact-heading]');
        const heading = {
          eyebrow: (headingEl?.querySelector('.contact__eyebrow')?.textContent || '').trim(),
          title: (headingEl?.querySelector('.contact__title')?.textContent || '').trim(),
        };
        return { fold: 'contact', lede, body, heading };
      },

      renderStructure(api) {
        const sel = api.selected;
        const line = sel && sel.classList.contains('contact__body-line') ? sel : null;

        if (line) {
          api.group('Body line', [
            ['↑', 'Move up', () => api.reorder(line, -1)],
            ['↓', 'Move down', () => api.reorder(line, 1)],
            ['＋', 'Add line after', () => {
              const p = buildBodyLine('New line.');
              api.insertAfter(p, line);
              api.select(p);
              api.enterEdit(p);
            }],
            ['✕', 'Delete line', () => {
              if (bodyEl().querySelectorAll('.contact__body-line').length <= 1) return;
              if (api.selected === line) api.clearSelection();
              line.remove();
              api.refresh();
            }],
          ]);
        }

        api.group('Body', [
          ['＋ line', 'Add body line at end', () => {
            const p = buildBodyLine('New line.');
            bodyEl().appendChild(p);
            api.select(p);
            api.enterEdit(p);
          }],
        ]);
      },
    },
  };

  // Config registered + DOM rendered → let the controller mount/rebuild for this fold.
  document.dispatchEvent(new CustomEvent('dev:rendered', { detail: { fold: 'contact' } }));
})();
