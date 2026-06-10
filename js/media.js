/* ==========================================================================
   Shared media + heading renderers.
   The About / Services / Process folds all render the same two pieces — a typed
   media object (image-or-video, with lazy `src`, poster, autoplay/loop/mute, and
   an optional mute control) and a heading block (eyebrow + title). These helpers
   hold that logic once, parameterized by the fold's BEM prefix, so the per-fold
   renderers stay thin and the markup/CSS hooks can't drift between folds.

   Attached to window.MemoryParlour (create-or-reuse, like the fold controller),
   so load order relative to folds.js doesn't matter — just before the fold
   renderers that call them.
   ========================================================================== */

(() => {
  'use strict';
  const NS = (window.MemoryParlour = window.MemoryParlour || {});

  // Crop transform shared by the on-load apply (below) and the ?dev picker, so
  // they can never drift. The image base is object-fit:cover; `position` pans the
  // whole image (translate) and `zoom` scales it about the centre. 50/50/1 is the
  // identity (clean cover); zoom < 1 shrinks it so the base shows around.
  NS.cropTransform = (px, py, z) => `translate(${px - 50}%, ${py - 50}%) scale(${z})`;

  // Background video preloading. By default a fold's clip only fetches when that
  // fold is first activated (createMedia's `activate`). To make every clip ready
  // the moment the visitor scrolls to it, we instead kick each video's load in the
  // background once the page has finished its critical load — deferred to idle so
  // the initial paint and above-the-fold assets aren't starved. Each video built
  // below registers its loader here; activation still works (it shares the same
  // `srcAttached` guard, so it just plays what's already buffered).
  const schedulePreload = (load) => {
    const run = () =>
      window.requestIdleCallback
        ? window.requestIdleCallback(load, { timeout: 3000 })
        : setTimeout(load, 200);
    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run, { once: true });
  };
  const parsePos = (s) => {
    const m = (s || '').match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : [50, 50];
  };

  // Apply the opt-in crop control (fit/position/zoom) to a media element, in the
  // same two modes createMedia documents. Shared by the <img> and <video> paths
  // (both are object-fit:cover boxes), so the focal crop works identically whether
  // a fold shows a still or a clip — the ?dev picker just targets `.*__media-el`.
  const applyCrop = (elem, media, cropMode) => {
    if (media.fit) elem.style.objectFit = media.fit;
    const hasPos = typeof media.position === 'string';
    const hasZoom = typeof media.zoom === 'number';
    if (!hasPos && !hasZoom) return;
    const [px, py] = parsePos(media.position || '50% 50%');
    const z = hasZoom ? media.zoom : 1;
    if (cropMode === 'transform') {
      elem.style.transformOrigin = '50% 50%';
      elem.style.transform = NS.cropTransform(px, py, z);
    } else {
      elem.style.objectPosition = `${px}% ${py}%`;
      elem.style.transformOrigin = `${px}% ${py}%`;
      elem.style.transform = `scale(${z})`;
    }
  };

  /**
   * Render a heading block (eyebrow + title) into `el`.
   * The eyebrow is a non-heading element; the title is a real heading (default
   * <h2>) so each fold contributes to the document outline. Class hooks are
   * `${prefix}__eyebrow` and `${prefix}__title`.
   *
   * @param {Element} el  container (cleared before rendering)
   * @param {{eyebrow?:string,title?:string}|null|undefined} heading
   * @param {{prefix:string, as?:string}} opts  `as` = title tag, default 'h2'
   */
  NS.createHeading = (el, heading, { prefix, as = 'h2' } = {}) => {
    el.textContent = '';
    if (!heading) return;

    // The per-fold class (`${prefix}__eyebrow`) is kept as a hook for each fold's
    // position/mobile rules; the shared `fold-eyebrow`/`fold-title` classes carry the
    // single, cross-fold typography (css/folds/headings.css) so the ?dev heading editor
    // can style every fold's heading at once. Home doesn't use this helper, so it's exempt.
    const eyebrow = document.createElement('div');
    eyebrow.className = `${prefix}__eyebrow fold-eyebrow`;
    eyebrow.textContent = heading.eyebrow || '';

    const title = document.createElement(as);
    title.className = `${prefix}__title fold-title`;
    title.textContent = heading.title || '';

    el.append(eyebrow, title);
  };

  /**
   * Build the media element for a fold and, for activation-driven types, return
   * { activate, deactivate } controls (else null). Mirrors the typed `media` model:
   *   - image → renders with the given `imgLoading` (default 'lazy'), plus the
   *     opt-in `fit`/`position`/`zoom` crop control (`position` pans the image,
   *     `zoom` scales it — one transform via NS.cropTransform); returns null.
   *   - video → poster shows immediately; `src` is lazy-attached either by the
   *     background preload (kicked once the page finishes loading, see
   *     schedulePreload) or, if a fold is entered first, by that activation —
   *     whichever wins; the element always starts muted so autoplay isn't blocked;
   *     an optional mute/unmute control is rendered when `showMuteControl`.
   *     Honors the same opt-in `fit`/`position`/`zoom` focal crop as images.
   *   - calendly → inline scheduling embed; the Calendly script is injected and
   *     the widget initialised on first `activate` (guarded), so the third-party
   *     script stays off the initial load. Empty `url` → a neutral placeholder
   *     block (no script). `deactivate` is a no-op (the iframe persists hidden).
   * Class hooks: `${prefix}__media-el`, `${prefix}__mute`, `${prefix}__calendly`,
   * `${prefix}__calendly-placeholder`.
   *
   * @param {Element} el  container (cleared before rendering)
   * @param {object|null|undefined} media  typed media object
   * @param {{prefix:string, imgLoading?:string, cropMode?:'object'|'transform'}} opts
   *   `imgLoading` default 'lazy'; `cropMode` how `position`/`zoom` apply (default
   *   'object' = always-filled focal crop; 'transform' = movable backdrop layer).
   * @returns {{activate:Function, deactivate:Function}|null}
   */
  NS.createMedia = (el, media, { prefix, imgLoading, cropMode = 'object' } = {}) => {
    el.textContent = '';
    if (!media) return null;

    if (media.type === 'image') {
      const img = document.createElement('img');
      img.className = `${prefix}__media-el`;
      img.src = media.src;
      img.alt = media.alt || '';
      img.loading = imgLoading || 'lazy';
      // Crop control (opt-in): only touch styles when the content supplies them.
      // 'object' = focal crop that always fills the box (object-position pans the
      // focal point; zoom tightens toward it). 'transform' = a movable layer
      // (translate pans, zoom scales about centre; may reveal the base behind it).
      applyCrop(img, media, cropMode);
      el.appendChild(img);
      return null;
    }

    // Calendly inline embed. Build the container now; defer the third-party
    // script + widget init to the first activation (see js/contact.js).
    if (media.type === 'calendly') {
      const hasUrl = typeof media.url === 'string' && media.url !== '';

      if (!hasUrl) {
        // No-URL state: a neutral placeholder block, no script ever loaded.
        const placeholder = document.createElement('div');
        placeholder.className = `${prefix}__calendly-placeholder`;
        placeholder.textContent = 'Scheduling opens here.';
        el.appendChild(placeholder);
        return { activate() {}, deactivate() {} };
      }

      const widget = document.createElement('div');
      widget.className = `${prefix}__calendly`;
      el.appendChild(widget);

      const SCRIPT_SRC = 'https://assets.calendly.com/assets/external/widget.js';
      let inited = false;
      const initWidget = () => {
        window.Calendly?.initInlineWidget?.({ url: media.url, parentElement: widget });
      };

      return {
        activate() {
          if (inited) return; // init exactly once on the first enter
          inited = true;
          if (window.Calendly) {
            initWidget();
            return;
          }
          const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
          if (existing) {
            existing.addEventListener('load', initWidget, { once: true });
            return;
          }
          const s = document.createElement('script');
          s.src = SCRIPT_SRC;
          s.async = true;
          s.addEventListener('load', initWidget, { once: true });
          document.head.appendChild(s);
        },
        deactivate() {}, // iframe persists in the hidden fold — nothing to tear down
      };
    }

    if (media.type !== 'video') return null;

    const video = document.createElement('video');
    video.className = `${prefix}__media-el`;
    if (media.poster) video.poster = media.poster;
    video.loop = !!media.loop;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    // Must start muted regardless of the final audio decision — browsers block
    // autoplay for videos with sound. iOS Safari (and some Android WebViews) gate
    // inline muted autoplay on the `muted` *attribute*, not the JS property, so set
    // both: without the attribute the programmatic .play() in activate() is rejected
    // on mobile and the clip never leaves its poster. (We deliberately do NOT set the
    // `autoplay` attribute — playback is driven per-fold by activate()/deactivate();
    // the background preload attaches src to every clip, so an autoplay attribute
    // would start them all off-screen at once.)
    video.muted = true;
    video.setAttribute('muted', '');
    // Native player chrome (play/pause + the unmute the autoplay-muted clip needs).
    // Supersedes the optional showMuteControl toggle below, which stays opt-in/off.
    video.controls = true;
    video.preload = 'none'; // until the background preload / activation flips it to 'auto'
    // Same opt-in focal crop as images (the poster + frames are an object-fit:cover
    // box), so a fold like About can reframe its clip via the shared ?dev picker.
    applyCrop(video, media, cropMode);
    el.appendChild(video);

    // Optional mute/unmute control (small corner overlay). Present only when the
    // video is meant to carry sound the user can enable.
    if (media.showMuteControl) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${prefix}__mute`;
      const sync = () => {
        btn.classList.toggle('is-muted', video.muted);
        btn.setAttribute('aria-label', video.muted ? 'Unmute video' : 'Mute video');
        btn.setAttribute('aria-pressed', String(!video.muted));
      };
      btn.addEventListener('click', () => {
        video.muted = !video.muted; // the tap is the gesture browsers require
        sync();
      });
      sync();
      el.appendChild(btn);
    }

    let srcAttached = false;
    const hasSource = typeof media.src === 'string' && media.src !== '';

    // Attach the source and start buffering (no playback). Idempotent via
    // `srcAttached`, so the background preload below and the on-enter `activate`
    // can race freely — whichever runs first does the fetch, the other no-ops.
    const attachSource = () => {
      if (!hasSource || srcAttached) return;
      video.preload = 'auto'; // override the 'none' default — we want it buffered
      video.src = media.src;
      srcAttached = true;
      video.load();
    };

    // Lazy-load every clip in the background on first visit (see schedulePreload).
    if (hasSource) schedulePreload(attachSource);

    return {
      activate() {
        if (!hasSource) return; // placeholder: poster only
        attachSource(); // no-op if the background preload already fetched it
        const p = video.play();
        if (p?.catch) p.catch(() => {}); // ignore autoplay rejections
      },
      deactivate() {
        if (hasSource) video.pause();
      },
    };
  };
})();
