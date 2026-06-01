/* ==========================================================================
   Dev tooling config for the shared nav/header (loaded ONLY under ?dev, by
   js/nav.js after <site-nav> renders). Registers window.MemoryParlour.devConfigs.site
   and a floating "NAV" toggle that opens the editor for the header.

   The nav is the SHARED shell (not a fold), visible on every page, so it lives
   outside the fold-scoped dev-controller: we build the editor once (on first
   toggle) via NS.buildEditor and show/hide it with the toggle — it persists
   across fold changes. Editable: the three logo text parts + the nav-link labels
   (inline text) and a curated CSS set on those selectors. No image picker (no
   image); no structural editing (routes/paths are preserved). Text saves to
   content/site.json; CSS to css/folds/site.overrides.css.
   ========================================================================== */

(() => {
  'use strict';
  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  const configs = (NS.devConfigs = NS.devConfigs || {});
  if (NS.__navToggleBuilt) return; // injected once by nav.js, but guard anyway
  NS.__navToggleBuilt = true;

  const root = () => document.querySelector('site-nav');
  const text = (sel) => (root()?.querySelector(sel)?.textContent || '').trim();

  configs.site = {
    id: 'site',
    editor: {
      rootSelector: 'site-nav',
      selectSelectors: '.logo__tagline, .logo__wordmark, .logo__est, .site-nav__link',
      classFor: {
        'logo__tagline': '.logo__tagline',
        'logo__wordmark': '.logo__wordmark',
        'logo__est': '.logo__est',
        'site-nav__link': '.site-nav__link',
      },
      cssSelectors: ['.logo__tagline', '.logo__wordmark', '.logo__est', '.site-nav__link'],
      liveStyleId: 'site-dev-overrides',
      captureClicks: true, // intercept nav clicks before <site-nav>'s own navigate handler
      panelStyle: { left: '16px', right: 'auto' }, // dock left, clear of the fold editor panel

      scrape() {
        const logoEl = root()?.querySelector('.logo');
        const logo = {
          tagline: text('.logo__tagline'),
          wordmark: text('.logo__wordmark'),
          established: text('.logo__est'),
          href: logoEl?.getAttribute('href') || '/',
        };
        // Labels are editable; each link's route (path/fold) is passed through
        // unchanged from the DOM — structure editing is intentionally out of scope.
        const nav = [...(root()?.querySelectorAll('.site-nav__link') || [])].map((a) => ({
          label: a.textContent.trim(),
          path: a.getAttribute('href') || '',
          fold: a.dataset.goto || '',
        }));
        return { fold: 'site', logo, nav };
      },

      renderStructure() {}, // no add/remove/reorder — labels-only editing
    },
  };

  // --- Floating "NAV" toggle: build the editor on first open, then show/hide ---
  let handle = null;
  let on = false;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('data-mp-dev', '');
  btn.textContent = 'NAV ✎';
  btn.title = 'Edit the nav bar (logo + links)';
  Object.assign(btn.style, {
    position: 'fixed', left: '16px', bottom: '16px', zIndex: '9999',
    font: '12px/1 ui-monospace, SFMono-Regular, Menlo, monospace', cursor: 'pointer',
    color: '#f7f5e7', background: 'rgba(20,19,16,0.92)',
    border: '1px solid rgba(247,245,231,0.35)', borderRadius: '6px', padding: '7px 10px',
    letterSpacing: '.06em',
  });
  const paint = () => {
    btn.style.background = on ? 'rgba(74,163,255,0.85)' : 'rgba(20,19,16,0.92)';
  };
  btn.addEventListener('click', () => {
    if (!handle) {
      if (!NS.buildEditor) return; // core not ready yet
      handle = NS.buildEditor(configs.site);
      if (!handle) return; // <site-nav> not in the DOM
    }
    on = !on;
    handle.setActive(on);
    paint();
  });

  // The nav editor lives outside the fold-scoped dev-controller, so it must honor
  // the passphrase gate itself: only show the toggle once unlocked, and remove it
  // (closing the editor) if the session is locked. Mirrors the controller's gating.
  let shown = false;
  const showToggle = () => {
    if (shown) return;
    shown = true;
    document.body.appendChild(btn);
  };
  const hideToggle = () => {
    if (on && handle) { on = false; handle.setActive(false); paint(); }
    if (shown) { btn.remove(); shown = false; }
  };

  if (NS.devUnlocked) showToggle(); // unlock may have happened before this loaded
  document.addEventListener('dev:unlocked', showToggle);
  document.addEventListener('dev:locked', hideToggle);
})();
