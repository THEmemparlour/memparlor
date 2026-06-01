/* ==========================================================================
   About-fold renderer.
   Reads content/about.json and builds the video block (typed `media` object),
   the poem, and the bottom-right heading. Registers the video's lifecycle with
   the fold controller so it lazy-loads + plays on activation and pauses on
   leave — the controller owns "when a fold is active".

   The video block + heading are built by the shared helpers in js/media.js
   (window.MemoryParlour.createMedia / createHeading); this file owns only the
   About-specific poem and the fold registration.
   ========================================================================== */

(async () => {
  const mediaEl = document.querySelector('[data-about-media]');
  const poemEl = document.querySelector('[data-about-poem]');
  const headingEl = document.querySelector('[data-about-heading]');
  if (!mediaEl || !poemEl || !headingEl) return;

  let data;
  try {
    data = await fetch('/content/about.json').then((r) => r.json());
  } catch (err) {
    console.error('[about] failed to load about.json', err);
    return;
  }

  renderPoem(poemEl, data.poem);
  window.MemoryParlour.createHeading(headingEl, data.heading, { prefix: 'about' });
  // 'object' = the FAQ-style focal crop: the media-el always fills its contained
  // box, and media.position / media.zoom reframe which part shows (tunable via ?dev).
  const media = window.MemoryParlour.createMedia(mediaEl, data.media, {
    prefix: 'about',
    imgLoading: 'eager',
    cropMode: 'object',
  });

  // Hand the video's play/pause + lazy-load to the fold controller.
  if (media && window.MemoryParlour?.registerFold) {
    window.MemoryParlour.registerFold('about', {
      onEnter: media.activate,
      onLeave: media.deactivate,
    });
  }

  // A long poem scrolls inside its own column (the video + heading stay put); hand
  // that region to the controller so wheel/keys scroll it and nav hands off at the
  // top/bottom edges — same pattern as the Services list and the FAQ Q&A list.
  window.MemoryParlour?.registerScrollable?.('about', poemEl);

  // Dev tooling — only under ?dev: about config (registers devConfigs.about) then
  // the generic picker + editor cores. async=false preserves order.
  if (new URLSearchParams(location.search).has('dev')) {
    const loaded = (window.MemoryParlour._devLoaded = window.MemoryParlour._devLoaded || new Set());
    for (const src of ['/js/dev/dev-auth.js', '/js/dev/dev-drag.js', '/js/dev/dev-picker.js', '/js/dev/dev-editor.js', '/js/dev/dev-layout.js', '/js/dev/dev-controller.js', '/js/dev/dev-config.about.js']) {
      if (loaded.has(src)) continue; // shared cores are fetched once across all folds
      loaded.add(src);
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      document.body.appendChild(s);
    }
  }

  function renderPoem(el, lines = []) {
    el.textContent = '';
    // Each line is kept as its own element so the deliberate breaks (e.g. one
    // sentence split across two lines) are preserved exactly.
    for (const line of lines) {
      const p = document.createElement('p');
      p.className = 'about__poem-line';
      p.textContent = line;
      el.appendChild(p);
    }
  }

})();
