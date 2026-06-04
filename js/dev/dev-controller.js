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

  // --- Mobile preview shell (?dev&shell) ------------------------------------
  // Mount the iframe-side agents (layout drag + text/style edit) INSTEAD of the
  // in-page panels (and suppress SAVE ALL below — the shell parent owns saving). The
  // picker/editor/layout/media cores still load but stay idle: we simply never call
  // their builders in shell mode.
  const SHELL = new URLSearchParams(location.search).has('shell');
  // Inject a dev-agent core on demand (the renderers' _devLoaded lists stay
  // unchanged) and build it once. Both agents are singletons that self-manage fold
  // changes, so the parent postMessage channel survives crossfades.
  const mountOnce = (() => {
    const done = new Set();
    return (src, build) => {
      if (done.has(src)) return;
      done.add(src);
      if (NS[build]) { NS[build](); return; }
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => NS[build]?.();
      document.body.appendChild(s);
    };
  })();
  // Layout drag agent (dev-agent.js) + text/style edit agent (dev-agent-edit.js).
  // Both mount in shell mode; a parent `mode` message flips which one owns clicks.
  const mountAgents = () => {
    mountOnce('/js/dev/dev-agent.js', 'buildAgent');
    mountOnce('/js/dev/dev-agent-edit.js', 'buildEditAgent');
  };

  // Build the panels for `fold` (picker if it has an image, editor if it has an
  // editor). No-op if already mounted for this fold; tears down the previous fold
  // first otherwise. Builders return null when their target DOM isn't ready.
  const mount = (fold) => {
    if (!NS.devUnlocked) return; // gated by the passphrase (see dev-auth.js)
    if (SHELL) return mountAgents(); // shell mode: the agents replace the in-page panels
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
    if (cfg.media) {
      const media = NS.buildMedia?.(cfg);
      if (media) destroyers.push(media);
    }
  };

  const activeFold = () => document.documentElement.dataset.fold;

  // --- Master save: one button + Cmd/Ctrl+S that flushes EVERY pending edit -----
  // Additive — the per-panel Save buttons stay. It calls each mounted panel's
  // save() (the active fold's picker/editor/layout/media, plus the persistent nav
  // editor) SERIALLY: text/crop/media all read-modify-write the same
  // content/<fold>.json, so parallel saves would clobber each other. Each save()
  // is dirty-aware (untouched panels return nothing) and reports one row per write.
  const collectSavers = () => {
    const list = destroyers.filter((d) => typeof d?.save === 'function');
    if (NS.navEditorHandle && typeof NS.navEditorHandle.save === 'function') list.push(NS.navEditorHandle);
    return list;
  };

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.setAttribute('data-mp-dev', '');
  saveBtn.textContent = 'SAVE ALL';
  saveBtn.title = 'Save every pending dev edit on this fold + the nav (Cmd/Ctrl+S)';
  Object.assign(saveBtn.style, {
    position: 'fixed', left: '50%', bottom: '16px', transform: 'translateX(-50%)', zIndex: '10000',
    font: '12px/1 ui-monospace, SFMono-Regular, Menlo, monospace', cursor: 'pointer',
    color: '#14130f', background: '#f7f5e7', border: '1px solid rgba(20,19,16,0.5)',
    borderRadius: '6px', padding: '8px 16px', letterSpacing: '.1em', fontWeight: '600',
  });

  let saving = false;
  async function saveAll() {
    if (saving || !NS.devUnlocked) return;
    saving = true;
    saveBtn.textContent = 'Saving…';
    const results = [];
    for (const s of collectSavers()) {
      try {
        results.push(...(await s.save()));
      } catch (err) {
        console.warn('[dev-controller] save failed', err);
        results.push({ target: 'unknown', ok: false });
      }
    }
    saving = false;
    if (!results.length) {
      saveBtn.textContent = 'Nothing to save';
    } else {
      const ok = results.filter((r) => r.ok).length;
      saveBtn.textContent = ok === results.length ? `Saved ${ok} ✓` : `Saved ${ok}/${results.length} ⚠`;
      const failed = results.filter((r) => !r.ok).map((r) => r.target);
      if (failed.length) console.warn('[dev-controller] SAVE ALL — failures:', failed);
    }
    setTimeout(() => { saveBtn.textContent = 'SAVE ALL'; }, 1600);
  }
  saveBtn.addEventListener('click', saveAll);

  // Cmd/Ctrl+S → master save (only while unlocked; otherwise leave the browser's
  // own Save shortcut alone).
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      if (SHELL || !NS.devUnlocked) return; // shell mode: the shell parent owns Cmd/Ctrl+S
      e.preventDefault();
      saveAll();
    }
  });

  // Show the button only once unlocked; remove it if the session locks (mirrors
  // the nav toggle's gating). The button lives outside `destroyers`, so a fold
  // change never tears it down.
  let btnShown = false;
  const showSaveBtn = () => { if (SHELL || btnShown) return; btnShown = true; document.body.appendChild(saveBtn); }; // suppressed in shell mode
  const hideSaveBtn = () => { if (btnShown) { saveBtn.remove(); btnShown = false; } };
  if (NS.devUnlocked) showSaveBtn();
  document.addEventListener('dev:unlocked', showSaveBtn);
  document.addEventListener('dev:locked', hideSaveBtn);

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
