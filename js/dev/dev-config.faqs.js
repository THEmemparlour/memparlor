/* ==========================================================================
   Dev tooling config for the FAQs fold (loaded ONLY under ?dev, before the
   generic dev-picker/dev-editor cores). Registers window.MemoryParlour.devConfigs.faqs.
   This is a faithful transcription of the original FAQ-specific tooling, so FAQ
   behaviour is unchanged.
   ========================================================================== */

(() => {
  'use strict';
  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  const configs = (NS.devConfigs = NS.devConfigs || {});

  const buildAnswerLine = (text) => {
    const p = document.createElement('p');
    p.className = 'faqs__answer-line';
    p.textContent = text;
    return p;
  };
  const buildItem = (question, answerLines) => {
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
  };

  configs.faqs = {
    id: 'faqs',
    layout: { selectors: ['.faqs__heading', '.faqs__list'], breakpoint: 'desktop', liveStyleId: 'faqs-dev-layout' },
    image: {
      selector: '[data-faqs-media] .faqs__media-el',
      mode: 'object', // focal crop — always fills the window, no gaps
      minZoom: 1, // never below cover
    },
    media: { selector: '[data-faqs-media] .faqs__media-el', kind: 'image' },
    editor: {
      rootSelector: '[data-faqs-root]',
      selectSelectors: '.faqs__eyebrow, .faqs__title, .faqs__question, .faqs__answer-line',
      classFor: {
        'faqs__eyebrow': '.fold-eyebrow', // shared cross-fold heading typography
        'faqs__title': '.fold-title',     // (see css/folds/headings.css)
        'faqs__question': '.faqs__question',
        'faqs__answer-line': '.faqs__answer-line',
      },
      cssSelectors: ['.fold-eyebrow', '.fold-title', '.faqs__question', '.faqs__answer-line'],
      liveStyleId: 'faqs-dev-overrides',

      scrape() {
        const headingEl = document.querySelector('[data-faqs-heading]');
        const listEl = document.querySelector('[data-faqs-list]');
        const heading = {
          eyebrow: (headingEl?.querySelector('.faqs__eyebrow')?.textContent || '').trim(),
          title: (headingEl?.querySelector('.faqs__title')?.textContent || '').trim(),
        };
        const faqs = [...listEl.querySelectorAll('.faqs__item')].map((item) => ({
          question: (item.querySelector('.faqs__question')?.textContent || '').trim(),
          answer: [...item.querySelectorAll('.faqs__answer-line')].map((p) => p.textContent.trim()),
        }));
        return { fold: 'faqs', heading, faqs };
      },

      renderStructure(api) {
        const listEl = document.querySelector('[data-faqs-list]');
        const sel = api.selected;
        const item = sel ? sel.closest('.faqs__item') : null;
        const line = sel && sel.classList.contains('faqs__answer-line') ? sel : null;

        if (item) {
          api.group('FAQ item', [
            ['↑', 'Move item up', () => api.reorder(item, -1)],
            ['↓', 'Move item down', () => api.reorder(item, 1)],
            ['＋', 'Add item below', () => {
              const it = buildItem('New question?', ['New answer.']);
              api.insertAfter(it, item);
              api.select(it.querySelector('.faqs__question'));
              api.enterEdit(it.querySelector('.faqs__question'));
            }],
            ['✕', 'Delete item', () => {
              if (listEl.querySelectorAll('.faqs__item').length <= 1) return;
              if (api.selected && item.contains(api.selected)) api.clearSelection();
              item.remove();
              api.refresh();
            }],
          ]);
        }
        if (line) {
          const answer = line.parentElement;
          api.group('Answer line', [
            ['↑', 'Move line up', () => api.reorder(line, -1)],
            ['↓', 'Move line down', () => api.reorder(line, 1)],
            ['＋', 'Add line below', () => {
              const p = buildAnswerLine('New answer.');
              api.insertAfter(p, line);
              api.select(p);
              api.enterEdit(p);
            }],
            ['✕', 'Delete line', () => {
              if (answer.querySelectorAll('.faqs__answer-line').length <= 1) return;
              if (api.selected === line) api.clearSelection();
              line.remove();
              api.refresh();
            }],
          ]);
        }
        api.group('List', [
          ['＋ question', 'Add question at end', () => {
            const it = buildItem('New question?', ['New answer.']);
            listEl.appendChild(it);
            api.select(it.querySelector('.faqs__question'));
            api.enterEdit(it.querySelector('.faqs__question'));
          }],
        ]);
      },
    },
  };

  // Config registered + DOM rendered → let the controller mount/rebuild for this fold.
  document.dispatchEvent(new CustomEvent('dev:rendered', { detail: { fold: 'faqs' } }));
})();
