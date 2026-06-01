/* ==========================================================================
   Services-fold renderer.
   Reads content/services.json and builds the right-column heading + media slot
   (image now, video-ready — same typed `media` shape as About, built by the
   shared helpers in js/media.js), then renders the `services` array (each entry
   a { label, description }) into the scrollable left-column list.

   Registers the left list as the fold's internally-scrollable region with the
   controller, so scrolling reads the list first and only advances folds at its
   top/bottom edges (see js/folds.js). If the media is a video, also registers
   the fold's play/pause lifecycle.
   ========================================================================== */

(async () => {
  const bodyEl = document.querySelector('[data-services-body]');
  const headingEl = document.querySelector('[data-services-heading]');
  const mediaEl = document.querySelector('[data-services-media]');
  if (!bodyEl || !headingEl || !mediaEl) return;

  let data;
  try {
    data = await fetch('/content/services.json').then((r) => r.json());
  } catch (err) {
    console.error('[services] failed to load services.json', err);
    return;
  }

  window.MemoryParlour.createHeading(headingEl, data.heading, { prefix: 'services' });
  // 'object' = the FAQ-style focal crop (the portrait box always stays filled);
  // media.position / media.zoom reframe which part shows (tunable via ?dev).
  const media = window.MemoryParlour.createMedia(mediaEl, data.media, { prefix: 'services', cropMode: 'object' });
  renderServices(bodyEl, data.services);

  // Hand the left list to the controller as this fold's scrollable region.
  window.MemoryParlour?.registerScrollable?.('services', bodyEl);

  // If the media is a video, let the controller drive its play/pause too.
  if (media && window.MemoryParlour?.registerFold) {
    window.MemoryParlour.registerFold('services', {
      onEnter: media.activate,
      onLeave: media.deactivate,
    });
  }

  // Dev tooling — only under ?dev: the generic cores + controller (shared, fetched
  // once across folds) then this fold's config, which registers devConfigs.services
  // and announces 'dev:rendered'. Loaded after renderServices so the list DOM exists.
  if (new URLSearchParams(location.search).has('dev')) {
    const loaded = (window.MemoryParlour._devLoaded = window.MemoryParlour._devLoaded || new Set());
    for (const src of ['/js/dev/dev-auth.js', '/js/dev/dev-drag.js', '/js/dev/dev-picker.js', '/js/dev/dev-editor.js', '/js/dev/dev-layout.js', '/js/dev/dev-controller.js', '/js/dev/dev-config.services.js']) {
      if (loaded.has(src)) continue; // shared cores are fetched once across all folds
      loaded.add(src);
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      document.body.appendChild(s);
    }
  }

  /**
   * Render the services list. Each entry is a { label, description }; the label
   * becomes an <h2> and the (optional) description a <p>, kept as flat siblings
   * of `.services__list` so the existing CSS (incl. `h2:first-child`) still
   * applies. textContent escapes the copy — no markdown, no innerHTML.
   */
  function renderServices(el, services = []) {
    el.textContent = '';
    for (const svc of services) {
      if (!svc) continue;
      if (svc.label) {
        const h = document.createElement('h2');
        h.textContent = svc.label;
        el.appendChild(h);
      }
      if (svc.description) {
        const p = document.createElement('p');
        p.textContent = svc.description;
        el.appendChild(p);
      }
    }
  }
})();
