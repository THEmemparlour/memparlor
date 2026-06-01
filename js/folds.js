/* ==========================================================================
   Fold controller.
   Owns navigation between the six folds: wheel/trackpad (debounced one-fold
   snap), touch swipe, keyboard, nav/logo clicks, crossfade, end-clamping
   (no wrap), and History API URL sync. Respects prefers-reduced-motion.

   Route table is sourced from content/site.json (single source of truth),
   so order + paths stay in sync with the header.

   Cross-component contract (events on `document`):
     · listens   'fold:goto'   { detail: { fold } }  — request navigation
     · dispatches 'fold:change' { detail: { fold, path } } — active fold changed
   Also mirrors the active fold on <html data-fold="…"> for the header.
   ========================================================================== */

(() => {
  const STEP_DELTA = 8; // |deltaY| that counts as scroll intent
  const SETTLE_DELTA = 4; // |deltaY| below which a wheel burst is "settling"
  const NEW_GESTURE_GAP = 60; // ms between wheel events that marks a new gesture
  const MAX_WHEEL_LOCK = 1000; // ms ceiling so the wheel can never get stuck
  const TOUCH_THRESHOLD = 45; // px of vertical swipe to advance
  const FADE_MS = 700; // keep in sync with --fold-fade

  let routes = []; // [{ fold, path }] in nav order
  let current = 0;
  let locked = false; // touch gesture lock

  // Dev mode (?dev): the crop picker owns scroll/swipe/arrow input, so we disable
  // gesture navigation for the session. Nav-bar/logo clicks (fold:goto) and
  // back/forward (popstate) stay live. We lock while a dev session is pending/active;
  // if the passphrase is wrong/cancelled (or we're on production with no dev server),
  // dev-auth.js dispatches 'dev:locked' and we restore normal navigation. On a
  // successful unlock it simply stays locked.
  let navLocked = new URLSearchParams(location.search).has('dev');
  document.addEventListener('dev:locked', () => { navLocked = false; });

  // Wheel state (timestamp-based; no timers that a busy event stream can starve).
  let wheelArmed = true; // ready to accept the next step
  let lastWheelAt = 0;
  let lastWheelStepAt = 0;

  const sections = new Map(); // foldId -> <section>
  document.querySelectorAll('.fold[data-fold]').forEach((el) => {
    sections.set(el.dataset.fold, el);
  });

  // --- Fold lifecycle hooks --------------------------------------------------
  // Folds with activation-driven behaviour (e.g. the About video: lazy-load,
  // play on enter, pause on leave) register { onEnter, onLeave } here. The
  // controller is the single owner of when a fold becomes active, so it drives
  // these rather than each fold listening to events on its own.
  const lifecycles = new Map(); // foldId -> { onEnter?, onLeave? }

  window.MemoryParlour = window.MemoryParlour || {};
  window.MemoryParlour.registerFold = (fold, hooks) => {
    lifecycles.set(fold, hooks);
    // If this fold is already the active one (e.g. deep-loaded /about-us, or a
    // late-arriving async renderer), fire its enter hook now.
    if (routes[current] && routes[current].fold === fold) hooks.onEnter?.();
  };

  // --- Internally-scrollable folds -------------------------------------------
  // Some folds (e.g. Services) hold content taller than the viewport in an
  // overflow region. They register that element here; navigation then scrolls
  // the region first and only advances to the next/previous fold once it's at
  // the corresponding edge (bottom → forward, top → back). Nav clicks still
  // jump directly. A fold that fits one viewport simply never registers one.
  const scrollables = new Map(); // foldId -> scrollable element

  window.MemoryParlour.registerScrollable = (fold, el) => {
    scrollables.set(fold, el);
    // If it's already active, start at the top (covers deep-links + late async).
    if (routes[current] && routes[current].fold === fold) el.scrollTop = 0;
  };

  // Can the region still scroll in this direction? (1 = down, -1 = up.)
  const canScrollInDir = (el, dir) =>
    dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 1;

  // Wheel delta normalized to pixels (lines/pages modes → approx pixels).
  const wheelPixels = (e, el) =>
    e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;

  const activeScrollable = () => scrollables.get(routes[current]?.fold);

  const indexOfFold = (fold) => routes.findIndex((r) => r.fold === fold);
  const indexOfPath = (path) => routes.findIndex((r) => r.path === path);

  function applyActive(idx) {
    routes.forEach((r, i) => {
      sections.get(r.fold)?.classList.toggle('is-active', i === idx);
    });
  }

  /**
   * Move to fold at `idx`. Clamps to [0, last] — no wrap-around (ends clamp).
   * @param {number} idx
   * @param {{ history?: 'push' | 'replace' | 'none' }} [opts]
   */
  function goTo(idx, opts = {}) {
    const clamped = Math.max(0, Math.min(routes.length - 1, idx));
    const route = routes[clamped];
    const prevIdx = current;
    const changed = clamped !== current;
    const prevRoute = routes[current];
    current = clamped;

    applyActive(clamped);
    document.documentElement.dataset.fold = route.fold;

    // Seat an internally-scrollable fold at the edge we're entering from: top
    // when moving forward/into it, bottom when arriving by scrolling back up —
    // so the next gesture continues through the list rather than skipping it.
    // Seat at the list bottom only when arriving by a sequential backward
    // scroll-step (opts.seat === 'edge'), so the next gesture continues through
    // the list. Direct jumps (nav click, logo, fold:goto, popstate) call goTo
    // without `seat` and always land at the top.
    const scrollEl = scrollables.get(route.fold);
    if (scrollEl) {
      scrollEl.scrollTop =
        opts.seat === 'edge' && clamped < prevIdx ? scrollEl.scrollHeight : 0;
    }

    if (changed) {
      if (prevRoute) lifecycles.get(prevRoute.fold)?.onLeave?.();
      lifecycles.get(route.fold)?.onEnter?.();
    }

    const history = opts.history ?? 'push';
    if (history !== 'none' && location.pathname !== route.path) {
      window.history[history === 'replace' ? 'replaceState' : 'pushState'](
        { fold: route.fold },
        '',
        // Keep the query string (e.g. ?dev) across navigation — only the path
        // changes between folds. popstate still matches on location.pathname.
        route.path + location.search
      );
    }

    if (changed || opts.force) {
      document.dispatchEvent(
        new CustomEvent('fold:change', { detail: { fold: route.fold, path: route.path } })
      );
    }
  }

  const step = (dir) => goTo(current + dir, { seat: 'edge' });

  // --- Wheel / trackpad: one gesture = one fold, momentum swallowed ----------
  // A trackpad flick is a dense, decaying stream of wheel events; the momentum
  // tail must not advance a second fold. We step once on the leading edge, then
  // stay "disarmed" until the burst clearly ends. Re-arm when ANY holds:
  //   · a gap since the last wheel event (a new flick or a mouse-wheel notch),
  //   · the magnitude has decayed to near zero (momentum settling), or
  //   · a safety ceiling elapsed since the last step (so it can never stick).
  // All conditions key off event timestamps — nothing a continuous stream can
  // starve — which is what caused the previous idle-timer lock-up.
  function onWheel(e) {
    if (navLocked) return; // dev mode: don't navigate (and don't swallow the event)
    e.preventDefault();
    const now = e.timeStamp;
    const abs = Math.abs(e.deltaY);
    const dir = e.deltaY > 0 ? 1 : -1;

    // Internally-scrollable fold (e.g. Services): consume the scroll inside the
    // region until it hits the edge in this direction. We keep the fold-advance
    // disarmed and refresh the activity timestamps so reaching the edge can't
    // flip the fold on the same flick — a fresh gesture is needed to hand off.
    const scrollEl = activeScrollable();
    if (scrollEl && canScrollInDir(scrollEl, dir)) {
      scrollEl.scrollTop += wheelPixels(e, scrollEl);
      wheelArmed = false;
      lastWheelAt = now;
      lastWheelStepAt = now;
      return;
    }

    const gap = now - lastWheelAt;
    lastWheelAt = now;

    if (gap > NEW_GESTURE_GAP || abs < SETTLE_DELTA || now - lastWheelStepAt > MAX_WHEEL_LOCK) {
      wheelArmed = true;
    }

    if (wheelArmed && abs >= STEP_DELTA) {
      wheelArmed = false;
      lastWheelStepAt = now;
      step(dir);
    }
  }

  // --- Touch: vertical swipe advances one fold -------------------------------
  let touchStartY = null;
  function onTouchStart(e) {
    touchStartY = e.touches[0].clientY;
  }
  function onTouchMove(e) {
    // On an internally-scrollable fold, let the region scroll natively.
    if (activeScrollable()) return;
    // Otherwise block rubber-band / page bounce while a fold is active.
    if (e.cancelable) e.preventDefault();
  }
  function onTouchEnd(e) {
    if (navLocked) return; // dev mode: swipes don't change folds
    if (touchStartY === null) return;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartY = null;
    if (Math.abs(dy) < TOUCH_THRESHOLD || locked) return;
    const dir = dy < 0 ? 1 : -1; // swipe up → next
    // If the fold's region can still scroll this way, native scroll handled it.
    const scrollEl = activeScrollable();
    if (scrollEl && canScrollInDir(scrollEl, dir)) return;
    locked = true;
    step(dir);
    setTimeout(() => {
      locked = false;
    }, FADE_MS);
  }

  // --- Keyboard (accessibility) ----------------------------------------------
  // On an internally-scrollable fold, arrows/page keys scroll the region first
  // and only advance once it's at the edge in that direction.
  function onKeyDown(e) {
    // Dev mode: leave arrow/page keys for the FAQ crop picker (don't navigate or
    // preventDefault here, so the picker's own keydown handler can act on them).
    if (navLocked) return;
    const dir = e.key === 'ArrowDown' || e.key === 'PageDown' ? 1
      : e.key === 'ArrowUp' || e.key === 'PageUp' ? -1
      : 0;
    if (!dir) return;
    e.preventDefault();

    const scrollEl = activeScrollable();
    if (scrollEl && canScrollInDir(scrollEl, dir)) {
      const page = e.key === 'PageDown' || e.key === 'PageUp';
      scrollEl.scrollTop += dir * (page ? scrollEl.clientHeight * 0.9 : 60);
      return;
    }

    // Debounce like wheel/touch: collapse OS key-autorepeat to one fold per
    // crossfade so a held arrow can't race through folds (or flood history).
    if (locked) return;
    locked = true;
    step(dir);
    setTimeout(() => {
      locked = false;
    }, FADE_MS);
  }

  function bindEvents() {
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('keydown', onKeyDown);

    // Nav / logo click requests.
    document.addEventListener('fold:goto', (e) => {
      const idx = indexOfFold(e.detail.fold);
      if (idx !== -1) goTo(idx);
    });

    // Back / forward.
    window.addEventListener('popstate', () => {
      const idx = indexOfPath(location.pathname);
      goTo(idx === -1 ? 0 : idx, { history: 'none' });
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

    // Starting fold from the current path (server fallback serves index.html for
    // any of the six routes; we read location.pathname for now).
    const startIdx = indexOfPath(location.pathname);
    bindEvents();
    goTo(startIdx === -1 ? 0 : startIdx, { history: 'replace', force: true });
  }

  init();
})();
