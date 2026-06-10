/* ==========================================================================
   Mobile fold headings (≤768px) — sticky top bars + auto-hiding nav.
   Each fold's heading sits in flow at the START of its fold, scrolls up with
   the content, then pins to the viewport top (native position:sticky) and
   condenses into a compact bar (`.is-stuck`, styled in css/folds/headings.css).
   The next fold's heading pushes the pinned one off-screen (push handoff).

   Native sticky only sticks within the element's DOM parent, but the headings
   live in nested wrappers (.about__bottom, .services__col, …) that the desktop
   layouts place near each fold's bottom. So on mobile every .fold-heading is
   reparented to be the FIRST CHILD of its <section class="fold"> — giving
   sticky the whole fold as its range — and restored to its original slot when
   the viewport returns to desktop. The renderers (js/about.js etc.) look the
   element up by data attribute, so moving the node is transparent to them.

   The fixed <site-nav> auto-hides on mobile: sustained downward scroll hides
   it (html[data-nav-hidden] → translateY(-100%), css/base.css), sustained
   upward scroll reveals it — with hysteresis so touch jitter can't flicker
   it. While visible, a pinned heading sticks BELOW it (top: --nav-h,
   measured from the rendered bar — it can run taller than the --header-h
   token); while hidden, the heading slides up to top: 0. The nav never hides
   while the hamburger menu is open or at the very top of the page.
   ========================================================================== */

(() => {
  const mq = window.matchMedia('(max-width: 768px)');
  const html = document.documentElement;
  const navEl = document.querySelector('site-nav');

  // --- Reparenting -----------------------------------------------------------
  // Remember each heading's original slot so desktop gets it back exactly.
  const slots = []; // { el, parent, next, section }
  document.querySelectorAll('.fold[data-fold] .fold-heading').forEach((el) => {
    slots.push({
      el,
      parent: el.parentNode,
      next: el.nextSibling,
      section: el.closest('.fold'),
    });
  });

  const toMobile = () => slots.forEach(({ el, section }) => section.prepend(el));
  const toDesktop = () =>
    slots.forEach(({ el, parent, next }) => parent.insertBefore(el, next));

  // --- Scroll handling (rAF-throttled): nav auto-hide + stuck detection ------
  // Touch scrolling jitters (finger tremor, fractional scrollY, momentum
  // micro-corrections), so the nav toggles on accumulated travel in one
  // direction — not frame-to-frame deltas. A direction reversal resets the
  // accumulator; only sustained travel past the threshold flips the nav.
  // Revealing is more eager than hiding: "scroll up a little" should bring
  // the nav back, while a stray wobble mid-read shouldn't take it away.
  const HIDE_AFTER = 24; // px of accumulated downward travel
  const SHOW_AFTER = 12; // px of accumulated upward travel
  let lastY = 0;
  let travel = 0; // signed: + down, − up; resets on direction change
  let navH = 0;
  let ticking = false;

  const measureNav = () => {
    navH = navEl?.offsetHeight || 0;
    html.style.setProperty('--nav-h', `${navH}px`);
  };

  const update = () => {
    ticking = false;
    const y = Math.max(0, window.scrollY); // clamp iOS rubber-band bounce

    // Teleports (deep-link jump, popstate, scroll restoration) are not a scroll
    // direction — resync without toggling the nav.
    const delta = y - lastY;
    const teleport = Math.abs(delta) > window.innerHeight;
    lastY = y;

    // Accumulate travel while the direction holds; a reversal starts over.
    if (teleport) travel = 0;
    else if (delta > 0) travel = travel > 0 ? travel + delta : delta;
    else if (delta < 0) travel = travel < 0 ? travel + delta : delta;

    // Nav: hide after sustained downward travel, reveal after sustained upward
    // travel; always shown at the very top; never hidden while the hamburger
    // menu is open.
    if (navEl?.classList.contains('is-open') || y < 8) {
      html.removeAttribute('data-nav-hidden');
    } else if (travel > HIDE_AFTER) {
      html.setAttribute('data-nav-hidden', '');
    } else if (travel < -SHOW_AFTER) {
      html.removeAttribute('data-nav-hidden');
    }

    // Stuck detection: a heading is pinned once its top edge reaches the nav's
    // RENDERED bottom edge, read per-frame. A static 0-or-navH offset flips the
    // instant data-nav-hidden toggles, but the heading's `top` takes 280ms to
    // follow — the mismatch flapped is-stuck (and its height change) on every
    // nav flip. The nav slide and the heading top share the same 280ms ease,
    // so this threshold tracks the animation exactly. +2 tolerates subpixel
    // skew between the two transitions; "above the threshold" also covers
    // being pushed off by the next fold.
    const navBottom = navEl ? Math.max(0, navEl.getBoundingClientRect().bottom) : 0;
    for (const { el } of slots) {
      el.classList.toggle('is-stuck', el.getBoundingClientRect().top <= navBottom + 2);
    }
  };

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  const onResize = () => {
    measureNav();
    onScroll();
  };

  // The nav renders async (site.json fetch) and reflows on font load — re-measure
  // whenever its box changes. Hiding is a transform, so this never re-fires then.
  if (navEl && 'ResizeObserver' in window) {
    new ResizeObserver(() => {
      if (mq.matches) onResize();
    }).observe(navEl);
  }

  // --- Mode switching ---------------------------------------------------------
  const enter = () => {
    toMobile();
    measureNav();
    lastY = Math.max(0, window.scrollY);
    travel = 0;
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    update();
  };

  const leave = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    html.removeAttribute('data-nav-hidden');
    slots.forEach(({ el }) => el.classList.remove('is-stuck'));
    toDesktop();
  };

  mq.addEventListener('change', (e) => (e.matches ? enter() : leave()));
  if (mq.matches) enter();
})();
