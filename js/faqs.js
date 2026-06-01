/* ==========================================================================
   FAQs-fold renderer.
   Reads content/faqs.json and builds the three regions: the full-height left
   image (shared createMedia, with the fit/position crop control), the centered
   Q&A list (each answer is an array of paragraphs so deliberate breaks survive),
   and the bottom-right heading (shared createHeading).

   The header's see-through/knockout logo is pure CSS keyed on
   <html data-fold="faqs"> (see css/folds/faqs.css). The only dynamic input it
   needs is the image URL, which this renderer publishes as the --knockout-image
   custom property and then flips on with the `is-knockout-ready` class — gating
   the transparent text-fill so the logo never renders invisible before the
   image is known (e.g. on a deep-link to /faqs).

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

  window.MemoryParlour.createMedia(mediaEl, data.media, { prefix: 'faqs' });
  window.MemoryParlour.createHeading(headingEl, data.heading, { prefix: 'faqs' });
  renderFaqs(listEl, data.faqs);

  // Feed the knockout logo the same image, then enable the effect.
  if (data.media?.src) {
    document.documentElement.style.setProperty('--knockout-image', `url("${data.media.src}")`);
    document.documentElement.classList.add('is-knockout-ready');
  }

  // Dev tooling — fetched/activated only when ?dev is present: the image crop
  // picker and the text/structure/CSS editor. Both run after this render, so the
  // FAQ DOM they bind to already exists.
  if (new URLSearchParams(location.search).has('dev')) {
    for (const src of ['/js/faqs-dev-picker.js', '/js/faqs-dev-editor.js']) {
      const s = document.createElement('script');
      s.src = src;
      s.defer = true;
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
