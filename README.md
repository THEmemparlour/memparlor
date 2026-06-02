# Memory Parlour

A single-page marketing site for **Memory Parlour** — a family-legacy
preservation studio. The whole site is **one viewport tall (100vh)** and divided
into six **folds**. Only one fold is visible at a time; scrolling, swiping,
pressing arrow keys, or clicking a nav item swaps the visible fold with a
crossfade. There is no normal page scroll.

Built as **plain HTML / CSS / JS** — no framework, bundler, or build step. Shared
UI uses native Web Components, content is externalized to JSON and rendered
client-side, and CSS is split into a shared base plus one file per fold. Intended
to deploy as static assets on Cloudflare Workers.

---

## Folds & routes

Fold order is the nav order. Each fold has a clean URL kept in sync via the
History API (no reload).

| Order | Fold       | Route          | Fold id    | Status        |
|-------|------------|----------------|------------|---------------|
| 1     | Home       | `/`            | `home`     | ✅ Built      |
| 2     | About Us   | `/about-us`    | `about`    | ✅ Built      |
| 3     | Services   | `/services`    | `services` | ✅ Built      |
| 4     | Process    | `/process`     | `process`  | ✅ Built      |
| 5     | FAQs       | `/faqs`        | `faqs`     | ✅ Built      |
| 6     | Contact Us | `/contact-us`  | `contact`  | ✅ Built      |

All six folds are built. The per-fold specs they were built from live in
`specdoc/`; they remain the source of truth for content, layout, and scope
(including what each fold explicitly defers — e.g. the real Calendly URL and
final media assets).

---

## Quick start

Requires Node (uses only built-ins — no `npm install` needed).

```bash
npm run dev                          # serves at http://localhost:8080
PORT=9000 npm run dev                # pin a specific port
MP_DEV_KEY=your-passphrase npm run dev  # require a passphrase for the ?dev tools
```

If the port is busy the dev server walks up to the next free one and prints the
final URL — **watch the console for the actual port**.

**`?dev` passphrase gate.** The in-page dev tooling (the per-fold picker / text
editor / layout / media panels, the floating **SAVE ALL** button, **and** the
`NAV ✎` nav editor) is **disabled unless `MP_DEV_KEY` is set**. With a key set,
visiting any fold with `?dev` prompts for the passphrase, validates it against the
server (`POST /__dev/auth`), and only then mounts the panels. The phrase is held in
`sessionStorage` (survives fold navigation and reloads in that tab; re-prompts after
the tab closes) and sent as the `X-Dev-Key` header on every Save, which the write
endpoints (`/__dev/{crop,content,css,layout,media,upload}`) all require. If
`MP_DEV_KEY` is unset, the server prints a warning and the tools stay **off** — no
prompt, no panels (the same as the deployed static site, which has no dev server at
all). A wrong/cancelled passphrase also leaves the normal site with working
navigation.

The dev server (`server/dev-server.js`) serves static files from the repo root
and falls back to `index.html` for clean routes (e.g. `/about-us`) so deep links
work. It mirrors what the future Worker/SSR layer will do; it is not a production
server.

**Media upload to Cloudflare R2 (local authoring).** Production media lives on
Cloudflare R2 and each fold's `content/<fold>.json` stores the **public
custom-domain URL** in `media.src`. The `?dev` media panel uploads a file through
the local dev server, which signs an S3-compatible PUT to R2 (hand-rolled SigV4,
Node built-ins only — see `server/r2.js`) and writes the returned URL back into the
fold JSON; you then commit + push and Workers Builds deploys. A URL can also be
pasted directly. This is **local-only**: the credentials live in env vars (never
committed) and there is no upload endpoint on the deployed site. Set all five to
enable `POST /__dev/upload` (the server warns and 503s the endpoint otherwise):

```bash
MP_DEV_KEY=your-passphrase \
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
R2_BUCKET=… R2_PUBLIC_BASE_URL=https://media.example.com \
npm run dev
# R2_MAX_UPLOAD_MB (default 50) caps the upload size.
```

`npm run test:r2` checks the SigV4 signing math against AWS's published test
vector (offline, no creds); with the `R2_*` vars set it also runs a live PUT +
public-fetch smoke test.

---

## Project structure

```
index.html                 Single page: <site-nav> + six fold <section>s. Links
                           base.css + each fold's .css / .overrides.css / .layout.css.
css/
  base.css                 Design tokens (:root), reset, fonts, header styles,
                           the fold layout + crossfade framework, responsive
                           defaults, reduced-motion.
  folds/
    home.css               Home-only: headline type + hero positioning/overlap.
    about.css              About-only: video block, poem, heading band.
    services.css           Services-only: two-column scroll layout + media slot.
    process.css            Process-only: lede/steps + bottom-bleeding video band.
    faqs.css               FAQs-only: 3-region layout (left image | Q&A | heading).
    contact.css            Contact-only: text | embed | heading 3-region layout.
    <fold>.overrides.css   One per fold: curated text-CSS saved by the ?dev editor,
                           loaded after <fold>.css so it wins the cascade. Auto-generated.
    <fold>.layout.css      One per fold: desktop-only block position/width saved by
                           the ?dev layout tool (wrapped in a min-width:769px @media).
                           Auto-generated.
    site.overrides.css     Nav/header text-CSS saved by the ?dev NAV editor (after
                           base.css). Auto-generated.
js/
  nav.js                   <site-nav> Web Component (logo + nav, active state); also
                           lazy-loads the dev NAV editor config under ?dev.
  folds.js                 Fold controller: input handling, crossfade, URL sync,
                           end-clamping, fold lifecycle + scrollable hooks, and the
                           ?dev gesture-nav lock.
  media.js                 Shared renderers: createMedia + createHeading, used by
                           every fold (home/about/services/process/faqs/contact) on
                           window.MemoryParlour.
  home.js                  Home renderer (segmented headline + shared hero media).
  about.js                 About renderer (video + poem + heading).
  services.js              Services renderer (heading + media + {label,description}
                           list — plain text, no markdown).
  process.js               Process renderer (lede + numbered steps + video band).
  faqs.js                  FAQs renderer (left image + Q&A + heading).
  contact.js               Contact renderer (lede + body + lazy Calendly embed).
  dev/                     ?dev-only authoring suite, lazy-loaded by each fold
                           renderer (and nav.js) only when ?dev is present — never
                           shipped to the live site:
    dev-auth.js              Passphrase flow (POST /__dev/auth) + dev:unlocked/locked.
    dev-controller.js        Mounts the active fold's panels on enter, tears them down
                             on leave; owns the SAVE ALL button (Cmd/Ctrl+S).
    dev-drag.js              Makes the dev panels draggable.
    dev-picker.js            Generic image focal-point + zoom picker (media.position/zoom).
    dev-editor.js            Generic text / structure / curated-CSS editor.
    dev-layout.js            Generic free block position/width tool (desktop only).
    dev-media.js             Generic media manager: upload to R2 or paste a URL, preview, save.
    dev-config.<fold>.js     Per-fold registration of which panels + selectors to use.
    dev-config.site.js       Nav/header registration + the floating NAV toggle.
content/
  site.json                Shared logo + nav (single source of truth for routes).
  home.json                Home fold content.
  about.json               About fold content (introduces the video media type).
  services.json            Services fold content (heading + media + services list).
  process.json             Process fold content (lede + steps + video).
  faqs.json                FAQs fold content (heading + media w/ crop + Q&A pairs).
  contact.json             Contact fold content (lede + body + calendly media).
assets/
  images/                  Placeholder hero + poster images (home/about/services/
                           process/faqs).
  icons/                   (empty — no icons/favicon committed yet)
server/
  dev-server.js            Zero-dependency static server with SPA fallback, plus dev-only
                           POST /__dev/{auth,crop,content,css,layout,media,upload}
                           endpoints (the ?dev tools' Save + media upload).
  r2.js                    Hand-rolled AWS SigV4 → Cloudflare R2 PUT (Node built-ins
                           only); used by POST /__dev/upload.
  r2.test.js               Offline SigV4 test-vector check (npm run test:r2); also a
                           live PUT smoke test when the R2_* env is set.
specdoc/                    Per-fold specifications: home, about, services, process,
                           faqs, contact.
```

---

## Architecture

### The shared shell (built once, used by every fold)

- **`<site-nav>`** (`js/nav.js`) — a native custom element rendered in the light
  DOM (so `base.css` styles it). It reads `content/site.json` and builds the logo
  block (tagline / wordmark / established) and the nav links. Collapses to a
  hamburger overlay on narrow widths.
- **Fold controller** (`js/folds.js`) — owns *which fold is active*. It handles
  all navigation input, the crossfade, URL sync, end-clamping, and fold
  lifecycle hooks. The route table is derived from `site.json`'s `nav` array, so
  order and paths have a single source of truth.

### Component communication contract

Components are decoupled and talk via DOM `CustomEvent`s on `document`, plus one
mirrored attribute. **Preserve this contract when adding folds.**

| Signal | Type | Direction | Payload |
|--------|------|-----------|---------|
| `fold:goto` | event on `document` | nav/logo → controller | `{ fold }` — request navigation |
| `fold:change` | event on `document` | controller → anyone | `{ fold, path }` — active fold changed |
| `<html data-fold="…">` | attribute | controller → anyone | mirrors the active fold id (read on first render) |
| `registerScrollable(fold, el)` | JS call on `window.MemoryParlour` | fold → controller | registers an internally-scrollable region so nav hands off at its top/bottom edges |

`<site-nav>` dispatches `fold:goto` on click and listens to `fold:change` to move
its active highlight. The controller is the only thing that decides when a fold
becomes active.

### Fold lifecycle hooks (for folds with active-only behaviour)

Some folds have behaviour that should only run while they're on screen — e.g. the
About fold's video must lazy-load, play on enter, and pause on leave. Rather than
each fold listening to events and guessing, the controller drives it:

```js
window.MemoryParlour.registerFold('about', {
  onEnter() { /* lazy-load + play */ },
  onLeave() { /* pause */ },
});
```

The controller calls `onLeave` for the fold being left and `onEnter` for the one
being entered. Registering also fires `onEnter` immediately if that fold is
already active (covers deep-links + async renderers that finish after init).

### Navigation input

All handled in `js/folds.js`:

- **Wheel / trackpad** — one gesture advances exactly one fold. The handler is
  **timestamp-based**: it steps on the leading edge of a gesture, then re-arms
  only when the burst ends (a gap since the last event, magnitude decaying to
  near-zero, *or* a 1 s safety ceiling). This swallows trackpad momentum tails
  without skipping folds, and — critically — can never get permanently stuck even
  under continuous/overlapping scrolling.
- **Touch** — a vertical swipe past a threshold advances one fold.
- **Keyboard** — ↑ / PageUp and ↓ / PageDown move one fold (accessibility).
- **Nav / logo click** — jumps directly to a fold (via `fold:goto`).
- **Ends clamp** — no wrap-around (up on Home / down on Contact Us does nothing).
- **`prefers-reduced-motion`** — crossfade becomes an instant swap (CSS).

### Routing

Clean paths via the History API. Changing folds updates the URL without a reload;
on load the controller reads `location.pathname` to pick the starting fold;
`popstate` (back/forward) re-selects without pushing a new entry. Server-side
handling of these paths arrives with the SSR pass — for now the dev server's
`index.html` fallback covers deep links.

---

## Content model

Content is data-driven JSON, fetched and rendered client-side. Header data lives
in `site.json` (shared); each fold has its own file.

**`content/site.json`** — logo + nav (also the route table):

```json
{
  "logo": { "tagline": "…", "wordmark": "MEMORY PARLOUR", "established": "EST. 2024", "href": "/" },
  "nav": [ { "label": "HOME", "path": "/", "fold": "home" }, … ]
}
```

**`content/home.json`** — the headline is modeled as styled segments so the
upright/italic split is data-driven; `media` is a typed object:

```json
{
  "headline": [
    { "text": "PRESERVE", "style": "upright" },
    { "text": "YOUR", "style": "italic" },
    { "break": true },
    …
  ],
  "media": { "type": "image", "src": "…", "alt": "…" }
}
```

Renderer rule: consecutive `text` segments join with a space; `{ "break": true }`
inserts a line break.

**`content/about.json`** — the `media` object **extends** the Home shape with
video fields (an `image` type ignores them; a `video` type uses them):

```json
{
  "media": {
    "type": "video",
    "src": "",                 // empty → show poster as a static placeholder
    "poster": "…",
    "autoplay": true, "loop": true,
    "muted": true,             // always starts muted (browsers block sound autoplay)
    "showMuteControl": false   // true → render a mute/unmute toggle overlay
  },
  "poem": ["line 1", "line 2", …],   // array preserves deliberate line breaks
  "heading": { "eyebrow": "Knowing", "title": "The Memory Parlour" }
}
```

**`content/services.json`** — heading + typed `media` (same shape as About) + a
`services` array. Each entry is a `{ label, description }` rendered to a flat
`<h2>` + `<p>` pair in the scrollable left list (no markdown, no external file):

```json
{
  "heading": { "eyebrow": "What we", "title": "Preserve" },
  "media": { "type": "image", "src": "…", … },
  "services": [
    { "label": "Stories:", "description": "Childhood memories, family folklore…" }
  ]
}
```

**`content/process.json`** — heading + a two-line `lede` + ordered `steps` (the
"1.", "2.", … numbering is derived from array order, not stored) + a typed video
`media` for the bottom band:

```json
{
  "heading": { "eyebrow": "How we", "title": "Preserve" },
  "lede": ["line 1", "line 2"],                 // array preserves the line break
  "steps": [ { "title": "Listening", "description": "…" }, … ],
  "media": { "type": "video", "src": "", "poster": "…", … }
}
```

**`content/faqs.json`** — heading + an image `media` with the **crop control**
(`fit`/`position`, see below) + an array of Q&A pairs whose `answer` is itself an
array of paragraphs (so the punchy opener → elaboration break is preserved):

```json
{
  "heading": { "eyebrow": "The", "title": "Experience" },
  "media": {
    "type": "image", "src": "…", "alt": "…",
    "fit": "cover",            // optional → object-fit (applied only when present)
    "position": "center"       // optional → object-position (the visible crop)
  },
  "faqs": [
    { "question": "…", "answer": ["punchy line", "elaboration…"] }, …
  ]
}
```

A dev-only focal-point picker for tuning `position` loads only under the `?dev`
query flag. (The header logo stays the shared default solid dark ink on this fold,
same as everywhere else.)

**`media` crop control (`fit`/`position`/`zoom`)** — `createMedia` applies
`object-fit`/`object-position` (and a `transform: scale()` from `zoom`, origin
tied to `position`) from these fields **only when present**, so it's opt-in and
doesn't override a fold's own CSS. `zoom` is a numeric multiplier (`1` = none;
`>1` magnifies into the focal point, `<1` shrinks within the frame). It's wired on
**every fold** that has media (home now uses the shared `createMedia` too) — tune
`position`+`zoom` live with the `?dev` picker (drag, a ▲▼◀▶ D-pad, or the **arrow
keys** to pan; − / + buttons to zoom; a **Save** button that writes back to
`content/<fold>.json` via the dev server's `POST /__dev/crop`). Home applies the
crop as a movable backdrop layer (`cropMode: 'transform'`); the other folds use the
always-filled focal crop (`cropMode: 'object'`). While `?dev` is set, `js/folds.js`
disables gesture navigation (scroll/swipe/arrows) so the arrows pan instead of
changing folds — nav-bar clicks still work.

`?dev` also loads a generalized **in-page authoring suite** (`js/dev/`, lazy-loaded
by each fold renderer and `nav.js` only under `?dev`). The same generic cores run on
**every fold**, driven by a per-fold `dev-config.<fold>.js` registration:

- **Text / structure editor** (`dev-editor.js`) — click text to select, double-click
  to edit; add/remove/reorder list items (Q&A, services, steps, poem / headline
  segments); edit a curated set of text CSS on the shared class rule with live
  preview. **Save text** → `POST /__dev/content` (writes the fold's content keys,
  preserving `media`); **Save CSS** → `POST /__dev/css` (writes
  `css/folds/<fold>.overrides.css`, linked after `<fold>.css`).
- **Focal-point picker** (`dev-picker.js`) — the crop control above (`POST /__dev/crop`).
- **Layout tool** (`dev-layout.js`, desktop only) — free block position/width →
  `POST /__dev/layout` (writes `css/folds/<fold>.layout.css`, wrapped in a
  `min-width:769px` media query so the mobile flow is untouched).
- **Media manager** (`dev-media.js`) — upload a file (streamed to R2) or paste a URL,
  preview live, then `POST /__dev/media` to write `media.{src,alt,poster}`.

A single floating **SAVE ALL** button (and `Cmd/Ctrl+S`) flushes every pending edit
on the active fold plus the nav, saving **serially** so the writers can't clobber
the shared `content/<fold>.json`. The shared nav/header has its own editor via
`dev-config.site.js` + a floating **NAV** toggle, mounted outside the fold
controller so it persists across folds. Every write requires the `X-Dev-Key` header,
and a server-side validator whitelists each selector/field before writing.

**`content/contact.json`** — a single-line `lede` + a `body` paragraph array + a
`calendly` media embed + heading:

```json
{
  "lede": "Begin Preserving Your Legacy.",
  "body": ["paragraph 1", … ],            // array, same convention as elsewhere
  "media": { "type": "calendly", "url": "" },   // empty url → placeholder block
  "heading": { "eyebrow": "Tell us your", "title": "Story" }
}
```

The `calendly` type is the third `media` variant (alongside `image`/`video`).
`createMedia` builds the inline-embed container and returns `{activate, deactivate}`;
`contact.js` wires those to `registerFold`, so the Calendly CDN script is injected
and the widget initialised **on first enter** (once) — not on page load. An empty
`url` renders a neutral placeholder and never loads the script.

---

## Styling conventions

- **Tokens first.** Colors, type families, and layout values are CSS custom
  properties in `:root` (`css/base.css`). They are **placeholders** — the real
  design system (final fonts, exact colors, spacing scale) is a later pass. Use
  the tokens; don't hard-code values.
- **Base vs. per-fold.** Anything shared (header, fold framework, tokens, reset)
  lives in `base.css`. Fold-specific styling lives in `css/folds/<fold>.css` and
  is namespaced with a `.<fold>__…` BEM-ish prefix.
- **Fonts (placeholders):** display serif **Cormorant Garamond** (wordmark,
  headlines, poem — needs a true italic) and label sans **Jost** (tagline, nav,
  established, About heading). Loaded from Google Fonts.

---

## Adding a new fold

The shell is built to make this incremental. All six current folds are built, but
the same recipe applies to any future fold (using `services` as the example):

1. **Content** — add `content/services.json`.
2. **Markup** — in `index.html`, replace the empty
   `<section class="fold" data-fold="services">` stub with its skeleton
   containers (mirror how `home`/`about` are structured).
3. **Styles** — add `css/folds/services.css` and link it in `index.html`'s
   `<head>` (alongside the other fold stylesheets).
4. **Renderer** — add `js/services.js` (fetch the JSON, populate the DOM) and add
   a `<script defer>` for it before `</body>`.
5. **Lifecycle (only if needed)** — if the fold has active-only behaviour (video,
   autoplay, animation), call `window.MemoryParlour.registerFold(...)`.
6. **Dev tooling (optional)** — to get the `?dev` editor / picker / layout / media
   panels on the new fold: link `css/folds/services.overrides.css` and
   `css/folds/services.layout.css` in `index.html`, add a server-side `FOLDS.services`
   entry (validator + selector whitelists) in `server/dev-server.js`, write
   `js/dev/dev-config.services.js`, and lazy-load the `js/dev/` cores from the
   renderer under `?dev` (copy the block any existing fold renderer uses).

No change to `js/folds.js` or `js/nav.js` is needed for a normal content fold —
the route already exists in `site.json`, and the nav/active-state/URL sync all
work automatically. Touch `folds.js` only to extend shared navigation behaviour.

---

## Deferred / roadmap

- **Worker SSR + per-route meta/OG injection** — render folds server-side and
  inject metadata per route.
- **Deploy config** (`wrangler.jsonc`) — Cloudflare Workers deployment.
- **Real design system** — final fonts, exact colors, spacing tokens.
- **Final media assets** — the hero image, the About/Process videos, and the FAQ
  image are still placeholders (the About/Process videos are poster-only with an
  empty `src`). The R2 upload path is now wired (see *Media upload to Cloudflare
  R2* above), so dropping the real assets in is a content task; very large videos
  may still point at Cloudflare Stream.
- **Real Calendly URL** — the Contact embed shows a placeholder until
  `contact.json`'s `media.url` is set; the live widget then lazy-loads on first
  enter. Third-party consent/cookie handling for the embed is also out of scope
  for now.
- **Mobile polish** — current responsive behaviour is sensible defaults only (the
  `?dev` layout tool is desktop-only; the `mobile` breakpoint is stubbed but not
  yet wired).

---

## Notes for AI agents

- **Read the spec first.** Each fold has a spec in `specdoc/`; it's the source of
  truth for content, layout, and scope (including what's explicitly deferred).
- **Respect the contracts** above (the `fold:goto` / `fold:change` events, the
  `data-fold` mirror, and `registerFold`). They keep folds decoupled.
- **No build step / no dependencies.** Don't introduce a framework or bundler.
  Keep using native Web Components, plain modules loaded with `<script defer>`,
  and Node built-ins for tooling. All fold content is JSON in `content/` — there
  is no markdown content or parser.
- **Shared rendering** for the media block (image / video / calendly embed,
  lazy-load, mute control, and the opt-in `fit`/`position` crop control) and the
  eyebrow+title heading lives in `js/media.js` (`window.MemoryParlour.createMedia`
  / `createHeading`); reuse it when a new fold needs either, rather than
  re-implementing per fold.
- **Keep the `?dev` tooling in sync.** It lives in `js/dev/` and is lazy-loaded by
  each fold renderer (and `nav.js`) only under `?dev` — it never ships to the live
  site. If you change a fold's content shape, also update that fold's
  `FOLDS.<fold>` validator/selector whitelist in `server/dev-server.js` and its
  `js/dev/dev-config.<fold>.js`, or the editor/save round-trip will reject it.
- **Verify in a browser**, not just by reading code — the dev server plus a
  headless browser screenshot/DOM-dump catches layout and navigation regressions.
- **Use the tokens** in `base.css`; treat colors/fonts as placeholders pending
  the design-system pass.
