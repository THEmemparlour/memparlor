/* ==========================================================================
   Home-fold renderer.
   Reads content/home.json and builds the data-driven segmented headline
   (upright/italic split) plus the full-fold hero image.

   Headline rule: consecutive `text` segments join with a single space;
   `{ "break": true }` starts a new line.

   The hero is a full-fold cover layer behind the headline; its visible crop is
   driven by media.position / media.zoom via the shared createMedia helper
   (object-fit:cover + object-position + scale), tunable with the ?dev picker.
   ========================================================================== */

(async () => {
  const headlineEl = document.querySelector('[data-home-headline]');
  const mediaEl = document.querySelector('[data-home-media]');
  if (!headlineEl || !mediaEl) return;

  let data;
  try {
    data = await fetch('/content/home.json').then((r) => r.json());
  } catch (err) {
    console.error('[home] failed to load home.json', err);
    return;
  }

  renderHeadline(headlineEl, data.headline);
  // Full-fold hero via the shared renderer; 'transform' = movable backdrop layer.
  window.MemoryParlour.createMedia(mediaEl, data.media, { prefix: 'home', imgLoading: 'eager', cropMode: 'transform' });

  // Dev tooling — only under ?dev: home config (registers devConfigs.home) then
  // the generic picker + editor cores. async=false preserves order.
  if (new URLSearchParams(location.search).has('dev')) {
    const loaded = (window.MemoryParlour._devLoaded = window.MemoryParlour._devLoaded || new Set());
    for (const src of ['/js/dev/dev-auth.js', '/js/dev/dev-drag.js', '/js/dev/dev-picker.js', '/js/dev/dev-editor.js', '/js/dev/dev-layout.js', '/js/dev/dev-controller.js', '/js/dev/dev-config.home.js']) {
      if (loaded.has(src)) continue; // shared cores are fetched once across all folds
      loaded.add(src);
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      document.body.appendChild(s);
    }
  }

  function renderHeadline(el, segments = []) {
    el.textContent = '';
    let lineHasText = false; // track whether to prepend a separating space

    for (const seg of segments) {
      if (seg.break) {
        el.appendChild(document.createElement('br'));
        lineHasText = false;
        continue;
      }
      if (lineHasText) el.appendChild(document.createTextNode(' '));

      const span = document.createElement('span');
      span.className = `home__seg home__seg--${seg.style === 'italic' ? 'italic' : 'upright'}`;
      span.textContent = seg.text;
      el.appendChild(span);
      lineHasText = true;
    }
  }
})();
