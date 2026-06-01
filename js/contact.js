/* ==========================================================================
   Contact-fold renderer (the sixth / last fold).
   Reads content/contact.json and builds the three regions: the left lede + body
   (italic serif), the right Calendly inline embed (shared createMedia's new
   `calendly` type), and the bottom-right heading (shared createHeading).

   The embed is lazy: createMedia returns { activate, deactivate } and we wire
   them to the controller via registerFold — identical to the About/Process
   videos — so the Calendly script is fetched only on the first enter, not on
   page load. With an empty `url` the embed renders a neutral placeholder and the
   script is never loaded.
   ========================================================================== */

(async () => {
  const ledeEl = document.querySelector('[data-contact-lede]');
  const bodyEl = document.querySelector('[data-contact-body]');
  const mediaEl = document.querySelector('[data-contact-media]');
  const headingEl = document.querySelector('[data-contact-heading]');
  if (!ledeEl || !bodyEl || !mediaEl || !headingEl) return;

  let data;
  try {
    data = await fetch('/content/contact.json').then((r) => r.json());
  } catch (err) {
    console.error('[contact] failed to load contact.json', err);
    return;
  }

  ledeEl.textContent = data.lede || '';
  renderBody(bodyEl, data.body);
  window.MemoryParlour.createHeading(headingEl, data.heading, { prefix: 'contact' });
  const media = window.MemoryParlour.createMedia(mediaEl, data.media, { prefix: 'contact' });

  // Hand the embed's lazy script-injection/init to the fold controller.
  if (media && window.MemoryParlour?.registerFold) {
    window.MemoryParlour.registerFold('contact', {
      onEnter: media.activate,
      onLeave: media.deactivate,
    });
  }

  // Dev tooling — only under ?dev: the generic editor core + controller (shared,
  // fetched once across folds) then this fold's config, which registers
  // devConfigs.contact and announces 'dev:rendered'. No crop picker — Contact's
  // media is the Calendly embed, not an image. async=false preserves order.
  if (new URLSearchParams(location.search).has('dev')) {
    const loaded = (window.MemoryParlour._devLoaded = window.MemoryParlour._devLoaded || new Set());
    for (const src of ['/js/dev/dev-auth.js', '/js/dev/dev-drag.js', '/js/dev/dev-editor.js', '/js/dev/dev-layout.js', '/js/dev/dev-controller.js', '/js/dev/dev-config.contact.js']) {
      if (loaded.has(src)) continue; // shared cores are fetched once across all folds
      loaded.add(src);
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      document.body.appendChild(s);
    }
  }

  // Body — each paragraph its own element (array preserves deliberate breaks).
  function renderBody(el, lines = []) {
    el.textContent = '';
    for (const line of lines) {
      const p = document.createElement('p');
      p.className = 'contact__body-line';
      p.textContent = line;
      el.appendChild(p);
    }
  }
})();
