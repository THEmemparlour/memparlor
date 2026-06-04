# Spec — Mobile layout authoring via a preview shell

Status: proposed · Scope: dev tooling only (never ships to the live site)

## 1. Summary

Add a `?dev`-only **preview shell** that lets us author the **mobile** block
layout of any fold by dragging, the same way the desktop layout tool already
works — but without the dev panel fighting the ~390px canvas for space.

The shell is a thin **parent page** that hosts the live site inside an
**`<iframe>` rendered at a phone width**. Because an iframe carries its own
viewport, the real `@media (max-width: 768px)` cascade fires inside it, so what
we drag is the true mobile layout. The dragging happens **inside the frame**;
the **controls live in the parent**, in the desktop space beside the phone — so
they never crowd the canvas.

This spec covers **mobile** + the **layout (positioning) tool only**. It is
purely additive: no existing desktop authoring code changes behaviour.

> **Update — text + style added.** The shell now also has a **Text & Style** mode
> (content words + structure, plus mobile-only text styling), built as a second
> in-frame agent + parent panel section. The original layout tool below is
> unchanged. See **§14 Addendum** for the text/style design; §12's "mobile text +
> spacing" deferral is now implemented.

## 2. Goals / non-goals

### Goals
- Author per-fold **mobile** block position/width by direct manipulation.
- Preview the **true** mobile render (real media queries), not a scaled mock.
- Keep the controls out of the mobile viewport so dragging is comfortable.
- Persist to a mobile layout stylesheet that the live site loads, mirroring the
  desktop layout pipeline.
- Touch the **minimum** amount of existing code; refactor nothing that works.

### Non-goals (explicitly deferred — see §12)
- Editing **text / curated CSS** on mobile (the overrides pipeline).
- The **focal-point picker** and **media manager** on mobile.
- Moving **desktop** authoring into the shell (a "unified" shell).
- Any breakpoint other than the existing binary `768px` split.
- A multi-device matrix, or showing desktop + mobile frames side by side.

## 3. Background — why a frame, not a scaled box

The layout tool measures a block's on-screen rect and stores it as a viewport-
relative `%`. For **mobile** values to be correct, the block must be laid out at
≤768px **and** the `@media (max-width: 768px)` rules must actually be active.

- **CSS media queries key off the real viewport, not a `<div>`'s width.** A
  390px box (or a `transform: scale()` mock) on a 1440px desktop page still has a
  1440px viewport, so the mobile cascade never fires — you'd drag the *desktop*
  layout squeezed into a phone shape and save wrong coordinates.
- **An `<iframe>` has its own viewport.** A 390px-wide iframe evaluates
  `max-width: 768px` as true inside it, even though the outer page is wide. This
  is the only way to get a correct mobile preview *and* keep the panel outside
  the 390px canvas (the panel runs in the parent).

The squeeze this solves: a fixed ~190–212px panel inside a ~390px viewport
leaves almost no draggable canvas, and most of what remains sits under the panel.

## 4. Architecture decision

**Mobile-only shell. Layout tool only. Drag in the iframe; controls in the
parent. Mobile layout persists to its own stylesheet via a sibling endpoint.**

### 4.1 Why mobile-only (not unified)
Desktop authoring has **no** squeeze — the panel floats over a wide canvas
today. Wrapping desktop in the shell would mean refactoring working code for zero
benefit. The shell is therefore additive and mobile-only; the desktop in-page
tooling is left exactly as-is.

### 4.2 Why a separate mobile stylesheet (the clobber problem)
`saveLayout` **overwrites** the whole `<fold>.layout.css` from the submitted
payload. If a mobile save posted `{ mobile: … }` to the existing endpoint, the
server would rewrite the file with only the mobile block and **wipe the desktop
block** (and vice-versa). To avoid this without a server-side merge layer and
without touching the desktop path, mobile layout is written to a **separate
file** the mobile tool owns exclusively:

- Desktop tool → `css/folds/<fold>.layout.css` (unchanged: `@media (min-width: 769px)`).
- Mobile shell → `css/folds/<fold>.layout.mobile.css` (`@media (max-width: 768px)`).

Disjoint media queries, disjoint files, no merge, no clobber. This also sidesteps
the existing breakpoint-blind `seedFromSaved` quirk in `dev-layout.js`: each tool
seeds from its own single-breakpoint file, so there is nothing to mis-merge.

### 4.3 Alternatives considered

| Option | Why not |
|--------|---------|
| Unified shell (desktop + mobile through frames) | Refactors working desktop authoring + the whole `?dev` bootstrap for no desktop benefit. Most code touched. |
| Same `.layout.css`, merge breakpoints server-side (JSON store) | Cleaner long-term, but adds a JSON source-of-truth + CSS regeneration + a migration step, and is more change than separate files. |
| Same `.layout.css`, each client sends *all* breakpoints | Forces the **desktop** client to seed + send the mobile block too → touches working desktop code. |
| Panels stay inside the iframe | Doesn't solve the squeeze — the panel is back inside the 390px viewport. |

## 5. Components

Four pieces. One is a new parent page, one is a new iframe-side agent, two are
small additive guards in existing dev files.

### 5.1 The shell (parent) — new
Files: `dev-shell.html`, `js/dev/dev-shell.js`, `css/dev-shell.css` (dev-only).

Responsibilities:
- **Auth.** On load, run the existing passphrase flow (reuse `dev-auth.js`'s
  `validate()` against `POST /__dev/auth`). Stay inert if disabled / no server
  (production). On success the key is in `sessionStorage` (`mp:devkey`), which the
  same-origin iframe inherits — so the frame unlocks without a second prompt.
- **Frame.** Render an `<iframe>` whose CSS width is a phone width (default
  **390px**; an optional width preset — 360 / 390 / 414 — is a minor nicety). The
  iframe `src` is `/<route>?dev&shell` (route from `site.json`, default `/`).
- **Fold switcher.** A control listing the six folds; choosing one posts
  `goto` to the agent. Stays in sync with the frame's active fold via `fold`.
- **Layout panel (controls only).** Block `<select>`, a numeric readout
  (`left / top / width %`), `Reset block`, and `Save mobile layout` (+ Cmd/Ctrl+S).
  No canvas here — the drag affordances live in the frame.
- **postMessage host.** Owns the protocol in §6; verifies origin + source.

Operated on a **desktop-width screen** (it needs room for the phone frame plus
the side panel). This matches the existing tooling, which is already desktop-only.

### 5.2 The agent (iframe) — new
File: `js/dev/dev-agent.js` (dev-only). Essentially the guts of `dev-layout.js`
minus its panel UI, hardcoded to the mobile breakpoint and talking to the parent
over postMessage instead of to a local panel.

Responsibilities:
- **Geometry.** Resolve the fold's layout selectors from
  `devConfigs[fold].layout.selectors` (same source the desktop tool uses).
  Measure each block's rect vs its offsetParent → `%`, identical math to
  `dev-layout.js` (`clamp`, 0.1% rounding). Because the iframe viewport is mobile,
  these are true mobile coordinates.
- **Drag affordances *in the frame*.** Draw the move-overlay + right-edge width
  handle over the selected block and handle pointer drag. Pointer events on the
  iframe surface reach the iframe naturally — no cross-frame coordinate
  translation needed.
- **Selection.** Clicking a block in the frame selects it (posts `selected`);
  the parent `<select>` is the alternate selector (receives `select`).
- **Live preview.** Inject a `<style data-mp-dev>` into the **iframe** head that
  mirrors the server output for the mobile file:

  ```css
  @media (max-width: 768px) {
    <selector> {
      position: absolute;
      left: …; top: …; width: …;
      max-width: none; right: auto; bottom: auto; transform: none;
    }
    <selector> * { max-width: none !important; }
  }
  ```
- **Seed from saved.** On load, read `/css/folds/<fold>.layout.mobile.css`
  (its own, mobile-only file) so a re-save preserves prior work. Unambiguous —
  the file has exactly one breakpoint.
- **Save.** On `save`, POST to `/__dev/layout-mobile` with `X-Dev-Key` from
  `NS.devAuth.key()` (shared sessionStorage), then post `saved { ok }`. On success,
  reload its own stylesheet in-session (reuse `NS.reloadDevStylesheet`).
- **Fold sync.** Listen for `fold:change`; post `fold` + the new fold's
  `blocks` (selectors) so the parent repopulates. Receive `goto` → dispatch
  `fold:goto` in the iframe (works under the gesture lock; nav clicks/`fold:goto`
  stay live).

The agent guarantees the **≤768px guardrail for free**: the shell sets the iframe
width, so `window.innerWidth ≤ 768` inside the frame is always true while
authoring — no separate width check is needed.

### 5.3 Site-side mount gate — edit (small, additive)
- `js/dev/dev-controller.js`: when `?dev&shell` is present, **inject and mount
  the agent** (`NS.buildAgent(cfg)`) instead of the panels, and **do not show the
  SAVE ALL button**. The picker/editor/layout/media cores still load (the
  renderers' load list is unchanged) but stay idle because the controller never
  calls their builders in shell mode. This is the only change to a fold's
  authoring path, and only under the new `shell` flag.
- `js/dev/dev-config.site.js`: under `?dev&shell`, **skip mounting the floating
  NAV toggle / nav editor** so it doesn't clutter the frame (layout-only scope).

No change to any fold renderer, `nav.js`, or `folds.js`.

## 6. postMessage protocol

Same-origin only. Parent sends with `targetOrigin = location.origin`; both sides
verify `event.origin === location.origin` and the expected `event.source`
(`iframe.contentWindow` on the parent, `window.parent` on the agent). All
messages are `{ type, …payload }`.

### Agent → parent
| `type` | Payload | Meaning |
|--------|---------|---------|
| `ready` | `{ fold, blocks }` | Agent mounted; current fold + its layout selectors. |
| `fold` | `{ fold, blocks }` | Active fold changed inside the frame. |
| `selected` | `{ selector }` | A block was selected (click in frame, or echo of `select`). |
| `metrics` | `{ selector, left, top, width }` | Live values during/after a drag (rounded). |
| `saved` | `{ ok }` | Save round-trip result. |

### Parent → agent
| `type` | Payload | Meaning |
|--------|---------|---------|
| `select` | `{ selector }` | Select this block (from the `<select>`). |
| `reset` | `{ selector }` | Drop this block's rule (back to flow). |
| `goto` | `{ fold }` | Navigate the frame to this fold (`fold:goto`). |
| `save` | `{}` | Persist the current mobile layout. |

## 7. Server changes (`server/dev-server.js`)

Additive, plus one backward-compatible signature tweak. The existing desktop
`POST /__dev/layout` path is byte-for-byte unchanged in behaviour.

1. **Parametrize the two pure helpers** with an optional breakpoint map that
   defaults to the current constant (desktop callers unaffected):
   - `validateLayout(layout, allowedSelectors, breakpoints = LAYOUT_BREAKPOINTS)`
   - `serializeLayout(clean, allowedSelectors, breakpoints = LAYOUT_BREAKPOINTS)`
   (both currently read the module-level `LAYOUT_BREAKPOINTS` directly).
2. **Add the mobile map:** `const MOBILE_BREAKPOINTS = { mobile: 'max-width: 768px' };`
3. **New endpoint** `saveLayoutMobile(req, res)` — a near-copy of `saveLayout`:
   - same `FOLD_RE` + `FOLDS[fold].layoutSelectors` checks, same `X-Dev-Key`
     gate and 100 KB body cap;
   - `validateLayout(layout, cfg.layoutSelectors, MOBILE_BREAKPOINTS)`;
   - write `serializeLayout(clean, cfg.layoutSelectors, MOBILE_BREAKPOINTS)` to
     `css/folds/<fold>.layout.mobile.css`.
4. **Route it** inside the existing authenticated `POST /__dev/` block:
   `if (urlPath === '/__dev/layout-mobile') return saveLayoutMobile(req, res);`

Payload shape: `{ fold, layout: { mobile: { '<selector>': { left, top, width } } } }`
(percent-only values, per-fold selector whitelist — same defence-in-depth as the
existing layout/CSS writers).

## 8. Static assets

- **Create six placeholders** so the live-site `<link>`s never 404 (header-only,
  like the existing auto-generated files): `css/folds/<fold>.layout.mobile.css`
  for home, about, services, process, faqs, contact.
- **`index.html`:** add one `<link>` per fold for `<fold>.layout.mobile.css`,
  loaded **after** the corresponding `<fold>.layout.css`. (Cascade order is
  immaterial since the two target disjoint media queries, but keep it tidy.)

## 9. Auth & deploy safety

- **Single prompt.** The shell authenticates; the iframe inherits the key via
  same-origin `sessionStorage` (`mp:devkey`) and unlocks silently.
- **Every write** still requires the `X-Dev-Key` header; the server validates it
  before reading the body.
- **postMessage** is origin- and source-checked on both ends (§6).
- **Dev-only.** `dev-shell.html`, `js/dev/dev-agent.js`, `js/dev/dev-shell.js`,
  `css/dev-shell.css`, and the `/__dev/layout-mobile` endpoint must be excluded
  from the production deploy, exactly like the rest of `js/dev/` and `/__dev/*`.
  With no dev server (production), the shell's `/__dev/auth` probe returns
  no-server and it stays inert.

## 10. Edge cases & notes

- **Scrollable Services fold.** Its layout selectors include `.services__list`
  (an internally-scrolled region). The agent treats it like any block, same as the
  desktop tool. Authoring an absolutely-positioned scroll region on mobile is the
  author's call; behaviour matches desktop.
- **Folds with multiple selectors.** The `<select>` lists all of the fold's
  `layoutSelectors`; one block is editable at a time (v1 targets singleton blocks,
  same as the desktop tool).
- **`dvh` on real devices.** Authored `top %` is relative to the frame's fixed
  viewport height; real devices vary as the browser chrome shows/hides. This is
  the same fragility the desktop percentage model already has, not new — but it's
  why mobile should lean on flow + targeted positioning rather than pinning every
  block (a reason the text/spacing path is deferred, not folded in here).
- **Reduced motion / crossfade** are unaffected (the frame renders the real site).
- **Desktop `.layout.css`** is never read or written by this feature.

## 11. Acceptance criteria

- [ ] Visiting `dev-shell.html` prompts once; a correct passphrase mounts the
      shell, the frame loads at phone width, and the frame does **not** re-prompt.
- [ ] The frame shows the **mobile** render (hamburger nav present, mobile
      cascade active) — verified by toggling a block and seeing it move within a
      390px viewport, not a squeezed desktop layout.
- [ ] Selecting a block (via the `<select>` or by clicking it in the frame) shows
      the move-overlay + width handle; dragging updates the readout live.
- [ ] `Save mobile layout` writes `css/folds/<fold>.layout.mobile.css` containing
      only an `@media (max-width: 768px)` block; the change survives a reload of
      the live site at ≤768px.
- [ ] Saving mobile does **not** alter `css/folds/<fold>.layout.css`; saving
      desktop (in-page tool) does **not** alter the `.mobile.css` file.
- [ ] Switching folds in the shell repopulates the block list and the readout.
- [ ] The dev panel never overlaps the phone canvas; dragging is comfortable.
- [ ] Without `MP_DEV_KEY` (or on production), the shell stays inert: no prompt,
      no panels, no writes.

## 12. Deferred / future

- ~~**Mobile text + spacing** via a breakpoint-aware overrides pipeline
  (`dev-editor.js` + `serializeOverrides`).~~ **Built — see §14.** (Still deferred:
  per-breakpoint *content* — mobile words differ from desktop. Today the words are
  shared via `content/<fold>.json`.)
- **Picker / media** on mobile through the same parent+agent split.
- **Unified shell**: author desktop through the frame too (one authoring model).
- **Side-by-side** desktop + mobile frames; a wider device-width matrix.
- **Server-side layout merge** (JSON source-of-truth) if we ever want both
  breakpoints in one file.
- **Known latent issue (not addressed here):** `dev-layout.js`'s `seedFromSaved`
  is breakpoint-blind. It's harmless today because each breakpoint lives in its
  own file, but would mis-merge if breakpoints were ever combined into one file.

## 13. Suggested build order

1. Server: parametrize `validateLayout` / `serializeLayout`, add
   `MOBILE_BREAKPOINTS`, `saveLayoutMobile`, and the route.
2. Static: create the six `.layout.mobile.css` placeholders + add the `<link>`s.
3. `dev-agent.js`: port the layout-tool geometry/drag/preview/seed/save, wired to
   the mobile breakpoint, the mobile file, and the postMessage interface.
4. `dev-controller.js` + `dev-config.site.js`: the `shell`-flag guards.
5. Shell: `dev-shell.html` + `dev-shell.js` + `dev-shell.css` (auth, frame, fold
   switcher, controls, protocol host).
6. Verify in a browser against §11 — including a real ≤768px reload to confirm the
   saved mobile layout applies on the live site.

## 14. Addendum — Text + style editing (built)

Adds a **Text & Style** mode to the shell, the flow-friendly half of "mobile polish"
deferred in §12. Same parent-controls / in-frame-manipulation split as the layout
tool, reusing the existing editor machinery. Purely additive — the layout path and
all desktop authoring are byte-for-byte unchanged.

### 14.1 Two saves, two destinations
- **Words (content):** `Save text` → `POST /__dev/content` → `content/<fold>.json`.
  Content has **no per-breakpoint concept**, so editing words in the shell changes
  them on **desktop too** — the button is labelled `Save text (shared w/ desktop)`.
- **Mobile text styling:** `Save mobile style` → `POST /__dev/css-mobile` →
  `css/folds/<fold>.overrides.mobile.css`, wrapped in `@media (max-width:768px)`. It
  never touches the desktop `.overrides.css` (disjoint files + query, like
  layout/layout-mobile — §4.2).

### 14.2 Mode toggle
The parent panel has a `Layout | Text & Style` toggle (default **Layout**, preserving
prior behaviour). Switching posts `mode {mode}` to the frame; **both** agents read it
and flip their own `active` flag (mutually exclusive), so only one owns clicks at a
time. WIDTH + FOLD controls are shared; each mode shows its own controls section.

### 14.3 Components
- **Edit agent (iframe) — new:** `js/dev/dev-agent-edit.js` (`NS.buildEditAgent()`).
  The guts of `dev-editor.js` minus its panel: click→select / dbl-click→inline
  contenteditable, the per-fold structure adapter (each fold's `renderStructure`/
  `scrape` reused **unchanged** — only `api.group()` is reimplemented to POST button
  specs to the parent and invoke the stored callback on `ed:action {id}`), and the
  curated-CSS inspector. The live `<style>` preview is wrapped in
  `@media (max-width:768px)`. Seeds `overrides` from the saved `.overrides.mobile.css`
  so re-saves are lossless. **Base subtlety:** the dirty-comparison base
  (`declaredBase`) reads the mobile cascade **excluding** the live `<style>` and the
  saved `.overrides.mobile.css` sheet (matched by *pathname*, so it survives the `?v=`
  reload), and descends into `@media` rules that apply at the frame's ≤768px viewport
  — needed because mobile base text styles live inside media queries. This diverges
  from `dev-editor.js`, which neither seeds nor media-descends.
- **Parent panel — edit:** `js/dev/dev-shell.js` gains the mode toggle and a Text &
  Style section: a selector readout, a structure-button container (rebuilt from
  `ed:buttons`), the 8-field inspector (`ed:values` populate; `input`/`change` →
  `ed:field`), and the two save buttons. `css/dev-shell.css` styles the section,
  inspector, structure buttons, and the amber `.shell-warn` shared-text button.
- **Controller — edit:** `js/dev/dev-controller.js` mounts BOTH agents in shell mode
  (`mountAgents()`); the layout agent (`dev-agent.js`) gains a symmetric `active`
  gate driven by the same `mode` message. SAVE ALL stays suppressed (parent saves).

### 14.4 Protocol additions (alongside §6; both agents share one frame window)
**Parent → agent:** `mode {mode}` (both) · `ed:action {id}` · `ed:field {prop,value}`
· `ed:save-text {}` · `ed:save-css {}` · `ed:save-all {}` (Cmd/Ctrl+S in text mode).
**Agent → parent:** `ed:fold {fold,hasEditor}` · `ed:buttons {fold,groups:[{title,
buttons:[{label,title,id}]}]}` · `ed:values {selector,values:{<prop>:{value,
placeholder}}}` · `ed:readout {selector}` · `ed:save-result {target,ok}`. Same
origin + source checks on both ends.

### 14.5 Server (`server/dev-server.js`)
`serializeOverrides(clean, allowedSelectors, media = null)` gains an optional media
wrap (default null = the original flat output, desktop `/__dev/css` unchanged).
`saveCssMobile` is a near-copy of `saveCss` with the same `validateOverrides`
whitelist, writing the media-wrapped file; routed at `/__dev/css-mobile` inside the
authed POST block.

### 14.6 Static assets
Six header-only `css/folds/<fold>.overrides.mobile.css` placeholders; six `<link>`s in
`index.html`, each **after** the fold's `.overrides.css` (so they win inside the query).

### 14.7 Extra acceptance criteria
- [ ] Toggling to Text & Style hides the layout overlay; clicking text shows the
      selection outline + populates the inspector + structure buttons.
- [ ] `Save text` updates `content/<fold>.json`; the same words appear on the desktop
      site (shared — accepted).
- [ ] `Save mobile style` writes only `<fold>.overrides.mobile.css` (one
      `@media (max-width:768px)` block); the desktop `.overrides.css` is unchanged.
- [ ] A re-save with no edits is byte-identical (seeding is lossless); the change
      survives a live-site reload at ≤768px and does NOT apply at >768px.
