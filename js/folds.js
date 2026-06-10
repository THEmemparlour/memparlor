/* ==========================================================================
   Fold controller (continuous-scroll model).
   The six folds are laid out vertically in normal flow; the browser scrolls
   between them natively. This controller no longer owns scrolling — it:
     · turns nav/logo clicks (fold:goto) into a smooth scrollIntoView,
     · runs an IntersectionObserver "scroll-spy" that names the active fold as it
       crosses the viewport centre — mirroring it on <html data-fold>, syncing
       the URL (History API, replace-only), firing 'fold:change', and driving
       each fold's onEnter/onLeave lifecycle hooks,
     · handles deep-links (load on /faqs → jump to that section) and back/forward.

   Route table is sourced from content/site.json (single source of truth), so
   order + paths stay in sync with the header.

   Cross-component contract (events on `document`):
     · listens    'fold:goto'   { detail: { fold } }       — request navigation
     · dispatches 'fold:change' { detail: { fold, path } } — active fold changed
   Also mirrors the active fold on <html data-fold="…"> for the header + ?dev tools.
   ========================================================================== */

(() => {
  // The active section is whichever overlaps this band — thin enough that only one
  // section occupies it at a time except for a brief moment at a boundary. Centred
  // on the viewport's lower one-third line (top trim 62%, bottom trim 28% → a
  // ~10%-thick band spanning 62%–72%, i.e. centred at 67%), so a fold becomes active
  // as it crosses a third of the way up from the bottom rather than the middle.
  const SPY_MARGIN = '-62% 0px -28% 0px';

  let routes = []; // [{ fold, path }] in nav order
  let activeFold = null; // currently-active fold id

  const sections = new Map(); // foldId -> <section>
  document.querySelectorAll('.fold[data-fold]').forEach((el) => {
    sections.set(el.dataset.fold, el);
  });

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // --- Fold lifecycle hooks --------------------------------------------------
  // Folds with activation-driven behaviour (About/Process video play-pause,
  // Contact's lazy Calendly embed) register { onEnter, onLeave } here. The
  // scroll-spy is the single owner of when a fold becomes active and drives them.
  const lifecycles = new Map(); // foldId -> { onEnter?, onLeave? }

  window.MemoryParlour = window.MemoryParlour || {};
  window.MemoryParlour.registerFold = (fold, hooks) => {
    lifecycles.set(fold, hooks);
    // If this fold is already the active one (e.g. deep-loaded /about-us, or a
    // late-arriving async renderer), fire its enter hook now.
    if (fold === activeFold) hooks.onEnter?.();
  };

  // Retained for back-compat: folds used to register an internally-scrollable
  // region for the old step-navigation (Services list, About poem, FAQ list). In
  // the continuous-scroll model those regions just flow with the page, so this is
  // a no-op — kept so the existing callers need no changes.
  window.MemoryParlour.registerScrollable = () => {};

  const indexOfFold = (fold) => routes.findIndex((r) => r.fold === fold);
  const indexOfPath = (path) => routes.findIndex((r) => r.path === path);

  // Single funnel for "the active fold changed". Idempotent: a repeat call for the
  // same fold is a no-op, so the observer can fire freely without thrash.
  function setActive(fold) {
    if (fold === activeFold || !sections.has(fold)) return;
    const prev = activeFold;
    activeFold = fold;
    const route = routes[indexOfFold(fold)];

    document.documentElement.dataset.fold = fold;

    // URL sync — replace (never push) so scrolling never floods the back stack.
    // Keep the query string (e.g. ?dev) across navigation.
    if (route && location.pathname !== route.path) {
      window.history.replaceState({ fold }, '', route.path + location.search);
    }

    // Lifecycle: leave the previous fold, then enter the new one.
    if (prev) lifecycles.get(prev)?.onLeave?.();
    lifecycles.get(fold)?.onEnter?.();

    document.dispatchEvent(
      new CustomEvent('fold:change', { detail: { fold, path: route?.path } })
    );
  }

  // Scroll a fold's section into view. 'smooth' for nav clicks, 'auto' (instant)
  // for deep-links / back-forward. scroll-padding-top (base.css) clears the fixed
  // header; reduced-motion forces instant even for nav clicks.
  function scrollToFold(fold, behavior) {
    const el = sections.get(fold);
    if (!el) return;
    el.scrollIntoView({
      behavior: reducedMotion.matches ? 'auto' : behavior,
      block: 'start',
    });
  }

  // --- Scroll-spy ------------------------------------------------------------
  function observeSpy() {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.dataset.fold);
        }
      },
      { root: null, rootMargin: SPY_MARGIN, threshold: 0 }
    );
    sections.forEach((el) => observer.observe(el));
  }

  function bindEvents() {
    // Nav / logo click → smooth-scroll to the section (no page reload).
    document.addEventListener('fold:goto', (e) => {
      scrollToFold(e.detail.fold, 'smooth');
    });

    // Back / forward → jump to the section for the new path.
    window.addEventListener('popstate', () => {
      const idx = indexOfPath(location.pathname);
      const fold = routes[idx === -1 ? 0 : idx]?.fold;
      if (!fold) return;
      scrollToFold(fold, 'auto');
      setActive(fold);
    });
  }

  async function init() {
    try {
      const site = await fetch('/content/site.json').then((r) => r.json());
      routes = site.nav.map((n) => ({ fold: n.fold, path: n.path }));
    } catch (err) {
      console.error('[folds] failed to load site.json', err);
      return;
    }

    bindEvents();
    observeSpy();

    // Starting fold from the current path (the server serves index.html for any of
    // the six routes; we read location.pathname). Deep-link: jump instantly.
    const startIdx = indexOfPath(location.pathname);
    const startFold = routes[startIdx === -1 ? 0 : startIdx].fold;
    if (startIdx > 0) scrollToFold(startFold, 'auto');

    // Seed active state synchronously so data-fold + fold:change are set before the
    // observer's first (async) callback — covers the nav highlight + ?dev tooling
    // on load. The observer then re-confirms / refines once layout settles.
    setActive(startFold);
  }

  init();
})();
