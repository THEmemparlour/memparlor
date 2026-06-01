/* ==========================================================================
   Process-fold renderer.
   Reads content/process.json and builds the heading (top-right), the bold-italic
   lede (top-left), the numbered steps (number derived from array order), and the
   lower video band. Registers the video's lifecycle with the fold controller so
   it lazy-loads + plays on activation and pauses on leave.

   JSON only — no markdown for this fold. The heading + video band are built by
   the shared helpers in js/media.js (window.MemoryParlour.createHeading /
   createMedia); this file owns only the lede and the numbered steps.
   ========================================================================== */

(async () => {
  const ledeEl = document.querySelector('[data-process-lede]');
  const stepsEl = document.querySelector('[data-process-steps]');
  const headingEl = document.querySelector('[data-process-heading]');
  const mediaEl = document.querySelector('[data-process-media]');
  if (!ledeEl || !stepsEl || !headingEl || !mediaEl) return;

  let data;
  try {
    data = await fetch('/content/process.json').then((r) => r.json());
  } catch (err) {
    console.error('[process] failed to load process.json', err);
    return;
  }

  renderLede(ledeEl, data.lede);
  renderSteps(stepsEl, data.steps);
  window.MemoryParlour.createHeading(headingEl, data.heading, { prefix: 'process' });
  // 'object' = the FAQ-style focal crop: the bleeding video band stays filled and
  // media.position / media.zoom reframe which part shows (tunable via ?dev).
  const media = window.MemoryParlour.createMedia(mediaEl, data.media, { prefix: 'process', cropMode: 'object' });

  // Hand the video's play/pause + lazy-load to the fold controller.
  if (media && window.MemoryParlour?.registerFold) {
    window.MemoryParlour.registerFold('process', {
      onEnter: media.activate,
      onLeave: media.deactivate,
    });
  }

  // Dev tooling — only under ?dev: the generic cores + controller (shared, fetched
  // once across folds) then this fold's config, which registers devConfigs.process
  // and announces 'dev:rendered'. async=false preserves load order.
  if (new URLSearchParams(location.search).has('dev')) {
    const loaded = (window.MemoryParlour._devLoaded = window.MemoryParlour._devLoaded || new Set());
    for (const src of ['/js/dev/dev-auth.js', '/js/dev/dev-drag.js', '/js/dev/dev-picker.js', '/js/dev/dev-editor.js', '/js/dev/dev-layout.js', '/js/dev/dev-controller.js', '/js/dev/dev-config.process.js']) {
      if (loaded.has(src)) continue; // shared cores are fetched once across all folds
      loaded.add(src);
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      document.body.appendChild(s);
    }
  }

  // Lede — each line its own element so the deliberate two-line break is kept.
  function renderLede(el, lines = []) {
    el.textContent = '';
    for (const line of lines) {
      const p = document.createElement('p');
      p.className = 'process__lede-line';
      p.textContent = line;
      el.appendChild(p);
    }
  }

  // Steps — the number ("1.", "2.", …) is derived from array order, not data.
  function renderSteps(el, steps = []) {
    el.textContent = '';
    steps.forEach((stepData, i) => {
      const li = document.createElement('li');
      li.className = 'process__step';

      const head = document.createElement('div');
      head.className = 'process__step-head';
      const num = document.createElement('span');
      num.className = 'process__step-num';
      num.textContent = `${i + 1}.`;
      const title = document.createElement('span');
      title.className = 'process__step-title';
      title.textContent = stepData.title || '';
      head.append(num, title);

      const desc = document.createElement('p');
      desc.className = 'process__step-desc';
      desc.textContent = stepData.description || '';

      li.append(head, desc);
      el.appendChild(li);
    });
  }

})();
