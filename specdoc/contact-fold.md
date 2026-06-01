# Memory Parlour — Contact Us Fold Spec

> Scope: the **Contact Us** fold (`contact`) — the sixth and final fold, and the
> last remaining stub. This spec is written to match the project's existing
> shell and conventions (see the project README / `specdoc/`). It introduces one
> new thing: a **Calendly inline embed** as a new `media.type`.
>
> Drop this file into `specdoc/` alongside the other fold specs.

---

## 0. Build decisions (resolved)

These supersede any conflicting detail below; the original intent is kept for
context but scoped to what we're building now.

1. **`Story` title — Jost 500, not bold.** Only Jost ≤500 is loaded, and the FAQ
   fold already settled on keeping ≤500 (its `Experience` title is Jost 500). The
   Contact `Story` title matches that — no 700/bold added; true bold waits for the
   design-system pass. See §5.
2. **Typo corrected.** The body copy reads **"possibilities"** (the `"posibalities"`
   spelling was a plain typo, not intentional placeholder copy). See §4 / §8.
3. **Calendly logic follows the video pattern.** `createMedia`'s `calendly` branch
   builds the container and **returns `{activate, deactivate}`** (where `activate`
   injects the script + inits the inline widget once, guarded); `js/contact.js`
   just wires those to `registerFold`, exactly like `about.js`/`process.js` do for
   their videos. The injection does **not** live inline in `registerFold`. See §3.3.

---

## 1. Context

- **Route:** `/contact-us` · **Fold id:** `contact` · sixth (last) in scroll order.
- **Active nav:** `CONTACT US` highlighted (handled automatically by the existing
  `fold:change` → `<site-nav>` flow; no nav changes needed).
- **Header treatment:** default dark-on-cream — the shared default logo, same as
  every fold. Nothing fold-specific to do for the header.
- Fits **one viewport**; no internal page scroll (the embed scrolls within its
  own iframe — see §3.3). Not a `registerScrollable` fold.
- As the **last** fold, scrolling down clamps (no-op); the only fold-nav from
  here is up to FAQs, or a nav/logo click.

---

## 2. Layout — three regions

Mirror how the other built folds structure their `<section data-fold="contact">`:

1. **Left:** a single-line `lede` + a short body paragraph (italic serif).
2. **Right:** the **Calendly inline embed** (the `media` slot).
3. **Bottom-right:** the eyebrow+title heading, built with the shared
   `createHeading` (`window.MemoryParlour.createHeading`).

Per-fold styles go in `css/folds/contact.css`, namespaced `.contact__…`; use the
`:root` tokens, not hard-coded values.

---

## 3. Calendly embed — new `media.type` (the one shared-shell change)

The right-side slot is the same typed `media` object used across folds, rendered
by the shared `createMedia` in `js/media.js`. Today `createMedia` branches on
`type` for `image` / `video`. **This fold adds a `"calendly"` branch.**

> This is the only change outside the fold's own files — `createMedia` in
> `js/media.js` must learn the new type, the same way it already distinguishes
> image from video. (A normal content fold needs no shell change; this one needs
> exactly this one.)

### 3.1 Embed type
- **Inline embed** (widget lives in the page), matching the mockup — not the
  popup/button variants.
- Uses Calendly's standard inline container + their widget script loaded from
  their CDN (`https://assets.calendly.com/assets/external/widget.js`).
- Image/video-only fields on the media object (`poster`, `autoplay`, `fit`,
  `position`, …) are ignored for `type: "calendly"`, just as `image` ignores the
  video fields.

### 3.2 URL & placeholder
- Needs the account-specific Calendly scheduling URL (`media.url`).
- **Empty `url` → render a neutral placeholder block** (the no-URL state); a real
  URL renders the live widget.
- The **"Calandly"** calendar mockup is a marker only — it does **not** appear in
  the build.

### 3.3 Loading & interaction (use the existing lifecycle contract)
- **Lazy-load via `registerFold`, mirroring the video folds (see §0.3).**
  `createMedia`'s `calendly` branch returns `{activate, deactivate}` — `activate`
  injects the Calendly script + inits the inline widget on first call (guarded so
  it runs once, and only when `url` is set); `deactivate` is a no-op. `contact.js`
  wires those straight to the controller, identical to `about.js`/`process.js`:

  ```js
  const media = window.MemoryParlour.createMedia(mediaEl, data.media, { prefix: 'contact' });
  if (media && window.MemoryParlour?.registerFold) {
    window.MemoryParlour.registerFold('contact', {
      onEnter: media.activate,   // inject script + init inline widget once (if url set)
      onLeave: media.deactivate, // no-op: the iframe stays in the hidden fold
    });
  }
  ```

  This keeps the third-party script off the initial page load — it's fetched only
  the first time the Contact fold becomes active.

- **Scroll interaction:** the widget is an iframe, so it captures wheel/touch
  while the pointer is over it (the controller won't advance from inside it).
  Since this is the last fold (down clamps), the only consequence is that going
  back up to FAQs is done by scrolling over the non-widget area or via nav.
  Documented, not a problem.

---

## 4. Content model — `content/contact.json`

Consistent with the other fold JSON files (typed `media`, `heading` eyebrow/title,
body text as a paragraph array):

```json
{
  "lede": "Begin Preserving Your Legacy.",
  "body": [
    "Book a call with us where we will discuss the possibilities and the ways to preserve your history for generations to come."
  ],
  "media": {
    "type": "calendly",
    "url": ""
  },
  "heading": { "eyebrow": "Tell us your", "title": "Story" }
}
```

- `body` is a paragraph array (one paragraph for now), matching the convention
  used elsewhere for multi-line/multi-paragraph copy.
- `media.type: "calendly"` with an empty `url` → placeholder until the link is added.
- **Copy note:** the body reads "possibilities" — the original `"posibalities"`
  was a typo and has been corrected (see §0.2). All other copy stays as supplied
  until real content lands.

---

## 5. Typography (placeholder families, per the design-system pass)

Weights are limited to what's currently loaded — Cormorant ≤600, Jost ≤500. No
700/bold is added in this pass (see §0.1); true bold waits for the design-system
pass.

| Element            | Family (placeholder)        | Treatment            |
|--------------------|-----------------------------|----------------------|
| Lede               | Cormorant Garamond *italic* | single line, left    |
| Body paragraph     | Cormorant Garamond *italic* | left                 |
| `Story` title      | Jost 500                    | large, right-aligned |
| `Tell us your`     | Jost regular                | small, right-aligned |

Heading is rendered via shared `createHeading`, so it inherits the same eyebrow+
title treatment as About/Services/Process/FAQs (whose titles are likewise Jost 500).

---

## 6. CSS — `css/folds/contact.css`

Per-fold styles only (`.contact__…`); base/header/fold-framework/tokens stay in
`base.css`:

- Three-region layout: text (left) | Calendly embed (right) | heading (bottom-right).
- Embed container sized to fit the right region within 100vh (the widget scrolls
  internally if taller); placeholder-block styling for the empty-`url` state.
- Lede + body italic-serif type treatment.

Link it in `index.html`'s `<head>` alongside the other fold stylesheets.

---

## 7. Build steps (follows the README's "Adding a new fold")

1. **Content** — add `content/contact.json` (§4).
2. **Markup** — replace the empty `<section class="fold" data-fold="contact">`
   stub in `index.html` with its region containers (mirror the other folds).
3. **Styles** — add `css/folds/contact.css` and link it in `<head>`.
4. **Renderer** — add `js/contact.js` (fetch JSON; render lede + body; use
   `createHeading` for the heading and `createMedia` for the calendly slot); add
   a `<script defer>` for it before `</body>`.
5. **Lifecycle** — `registerFold('contact', …)` for the lazy Calendly init (§3.3).
6. **Shared shell** — extend `createMedia` in `js/media.js` with the `"calendly"`
   branch (§3). This is the only file outside the fold touched.

No `js/folds.js` or `js/nav.js` change is needed — the `contact` route already
exists in `site.json`, so navigation, active-state, and URL sync work as-is.

---

## 8. Deferred / out of scope
- **Real Calendly URL** — supplied later; placeholder block until then.
- **Third-party consent / cookie handling** for the embed — not in scope now.
- **Real design system** — fonts, colors, spacing tokens.
- **Mobile polish** — sensible defaults only (stack text / embed / heading; the
  embed gets a sensible mobile height).
- *Note:* the Stream/R2 hosting question that applies to our own large videos does
  **not** apply here — Calendly is third-party-hosted.

---

## 9. Assumptions (confirmed)
- Inline Calendly embed (not popup), placeholder until the URL is provided.
- Typo **corrected** to "possibilities" (see §0.2).
- `Story` title is **Jost 500**, not bold (see §0.1).
- Default dark-on-cream header here (shared default logo, same as every fold).
