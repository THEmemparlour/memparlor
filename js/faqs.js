/* ==========================================================================
   FAQs-fold renderer.
   Reads content/faqs.json and builds the three regions: the full-height left
   image (shared createMedia, with the fit/position crop control), the centered
   Q&A list (each answer is an array of paragraphs so deliberate breaks survive),
   and the bottom-right heading (shared createHeading).

   The header logo is the shared default (solid dark ink) on this fold, same as
   everywhere else — no FAQ-specific treatment.

   Dev-only focal-point picker: loaded only under ?dev, so normal visitors never
   fetch it (no build step yet to strip it — see specdoc/faqs-fold.md §0.5).
   ========================================================================== */

(async () => {
  const mediaEl = document.querySelector('[data-faqs-media]');
  const listEl = document.querySelector('[data-faqs-list]');
  const headingEl = document.querySelector('[data-faqs-heading]');
  if (!mediaEl || !listEl || !headingEl) return;

  let data;
  try {
    data = await fetch('/content/faqs.json').then((r) => r.json());
  } catch (err) {
    console.error('[faqs] failed to load faqs.json', err);
    return;
  }

  window.MemoryParlour.createMedia(mediaEl, data.media, { prefix: 'faqs', cropMode: 'object' });
  window.MemoryParlour.createHeading(headingEl, data.heading, { prefix: 'faqs' });
  renderFaqs(listEl, data.faqs);

  // A long Q&A list scrolls inside its own column (the heading stays pinned); hand
  // that region to the controller so wheel/keys scroll it and nav hands off at the
  // top/bottom edges — same pattern as the Services list.
  window.MemoryParlour?.registerScrollable?.('faqs', listEl);

  // Dev tooling — fetched only when ?dev is present: the generic crop picker,
  // text/structure/CSS editor, and controller cores (shared, fetched once across
  // folds) then this fold's config, which registers devConfigs.faqs and announces
  // 'dev:rendered'. Loaded after this render so the FAQ DOM exists.
  if (new URLSearchParams(location.search).has('dev')) {
    const loaded = (window.MemoryParlour._devLoaded = window.MemoryParlour._devLoaded || new Set());
    for (const src of ['/js/dev/dev-auth.js', '/js/dev/dev-drag.js', '/js/dev/dev-picker.js', '/js/dev/dev-editor.js', '/js/dev/dev-layout.js', '/js/dev/dev-controller.js', '/js/dev/dev-config.faqs.js']) {
      if (loaded.has(src)) continue; // shared cores are fetched once across all folds
      loaded.add(src);
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      document.body.appendChild(s);
    }
  }

  // Each Q&A pair: a question heading + answer paragraphs (array preserves the
  // punchy opener → elaboration break exactly, like the About poem / Process lede).
  function renderFaqs(el, faqs = []) {
    el.textContent = '';
    for (const item of faqs) {
      const wrap = document.createElement('div');
      wrap.className = 'faqs__item';

      const q = document.createElement('h3');
      q.className = 'faqs__question';
      q.textContent = item.question || '';
      wrap.appendChild(q);

      const answer = document.createElement('div');
      answer.className = 'faqs__answer';
      for (const line of item.answer || []) {
        const p = document.createElement('p');
        p.className = 'faqs__answer-line';
        p.textContent = line;
        answer.appendChild(p);
      }
      wrap.appendChild(answer);

      el.appendChild(wrap);
    }
  }
})();
