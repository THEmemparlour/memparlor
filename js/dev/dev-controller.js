/* ==========================================================================
   Dev overlay controller — single owner of the mounted dev panels (loaded ONLY
   under ?dev). The site is a single-page app: all folds are pre-rendered and
   navigation just crossfades between them, so the picker/editor cores can't keep
   building once on load. This controller builds the ACTIVE fold's panels and
   tears them down on fold change, so exactly one picker + one editor exist at a
   time and they always match the fold you're looking at.

   Triggers (in increasing specificity):
     · 'fold:change'  (folds.js)        — drives every post-load navigation.
     · 'dev:rendered' (dev-config.*.js) — covers the startup race where a fold's
                                          async renderer finishes after this loads.
     · initial mount of the active fold — if its config already registered.
   ========================================================================== */

(() => {
  'use strict';

  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  if (NS.devController) return; // guarded singleton
  NS.devController = true;

  let mountedFold = null;
  let destroyers = []; // teardown handles for the currently-mounted fold

  const teardown = () => {
    for (const d of destroyers) {
      try { d?.destroy?.(); } catch (err) { console.warn('[dev-controller] teardown failed', err); }
    }
    destroyers = [];
    mountedFold = null;
  };

  // Build the panels for `fold` (picker if it has an image, editor if it has an
  // editor). No-op if already mounted for this fold; tears down the previous fold
  // first otherwise. Builders return null when their target DOM isn't ready.
  const mount = (fold) => {
    if (!NS.devUnlocked) return; // gated by the passphrase (see dev-auth.js)
    if (!fold || fold === mountedFold) return;
    const cfg = NS.devConfigs && NS.devConfigs[fold];
    if (!cfg) return; // config not registered yet — a later trigger will retry
    teardown();
    mountedFold = fold;
    if (cfg.image) {
      const picker = NS.buildPicker?.(cfg);
      if (picker) destroyers.push(picker);
    }
    if (cfg.editor) {
      const editor = NS.buildEditor?.(cfg);
      if (editor) destroyers.push(editor);
    }
    if (cfg.layout) {
      const layout = NS.buildLayout?.(cfg);
      if (layout) destroyers.push(layout);
    }
  };

  const activeFold = () => document.documentElement.dataset.fold;

  // Post-load navigation: the target fold was pre-rendered at load, so its DOM
  // already exists when we rebuild.
  document.addEventListener('fold:change', (e) => mount(e.detail.fold));

  // A fold's config just registered (and its DOM is rendered) — mount if active.
  document.addEventListener('dev:rendered', (e) => {
    if (e.detail.fold === activeFold()) mount(e.detail.fold);
  });

  // The passphrase was just accepted — mount the active fold now (gate lifted).
  document.addEventListener('dev:unlocked', () => mount(activeFold()));

  // If unlock + the active fold's config already happened before this controller loaded.
  mount(activeFold());
})();
