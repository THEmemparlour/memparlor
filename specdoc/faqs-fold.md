# Memory Parlour — FAQs Fold Spec

> Scope: the **FAQs** fold only. Builds on the implemented shell and the media
> model. Introduces a reusable **image `position` (crop) control** plus a
> **dev-only focal-point picker**. (An earlier see-through/knockout logo treatment
> was built then **removed** — the FAQ logo now uses the shared default; see §2.)

---

## 0. Build decisions (resolved)

These supersede any conflicting detail below; the original intent is kept for
context but scoped to what we're building now.

1. **Header logo — shared default (knockout removed).** The FAQ logo is the same
   solid dark-ink logo as every other fold; there is **no** per-fold logo
   treatment. An earlier pass filled the logo letters with the FAQ image via
   `background-clip: text`; that effect was removed in favour of a solid, static,
   consistent logo throughout. See §2.
2. **No per-fold header machinery.** There is no `data-header-theme` and no
   per-fold header CSS. `js/folds.js` and `js/nav.js` need **no** theme code, and
   the FAQ renderer no longer publishes any logo-image custom property. See §2 / §9.
3. **Fonts — keep currently loaded weights (≤600).** Do **not** add 700/bold to
   the font load. Questions use Cormorant italic 600; the `Experience` title uses
   Jost 500. See §7.
4. **`fit`/`position` crop control — FAQ-only for now.** Add it to the shared
   `createMedia` image branch and use it on FAQs. **Leave Home/About/Services/
   Process untouched** (Home also uses its own private renderer). Full rollout to
   every fold is a **dedicated later task**. See §4.
5. **Dev focal-point picker — build now, gated on `?dev`.** Loaded/activated only
   under `?dev`; since there's no build step yet it still lives on the static host
   (just never runs for normal visitors). True stripping waits for the SSR pass.
   It pans (drag **+ a ▲▼◀▶ D-pad**) **and zooms** (**− / + buttons**), and has a
   **Save** button that writes `position`/`zoom` to `content/faqs.json` via a
   dev-server endpoint (`POST /__dev/crop`). See §5.
6. **Zoom — added (reverses the earlier "no zoom" decision).** A numeric `zoom`
   multiplier on the media object, **allowed below `1.0`** (image may shrink and
   reveal the column's cream background). Implemented as `transform: scale()` with
   origin tied to `position`; FAQ-only for now like `fit`/`position`. See §4.
7. **Dev-mode navigation lock.** Whenever `?dev` is set, `js/folds.js` disables
   **gesture** navigation (scroll, swipe, arrow/Page keys) for the session, so the
   picker owns the arrow keys. Nav-bar/logo clicks and back/forward still work, so
   you can move folds deliberately. Read once at load (a "dev session" flag).
   See §5.
8. **In-page FAQ editor (text + structure + CSS).** A second `?dev` tool
   (`js/faqs-dev-editor.js`) lets you edit FAQ text, add/remove/reorder Q&A, and
   tweak a curated set of text CSS on the shared class rule. Text/structure saves
   to `content/faqs.json`; CSS saves to an always-loaded `css/folds/faqs.overrides.css`.
   FAQ-only; plaintext only; class-rule CSS only (no per-instance). See §12.

---

## 1. Context

- **Route:** `/faqs` · **Fold id:** `faqs` · fifth in scroll order.
- **Active nav:** `FAQS` highlighted when active.
- Fits **one viewport** — three Q&A pairs, no overflow, no internal scroll.
- Layout regions:
  - **Left:** full-height image column (bleeds to the left/top/bottom edges).
  - **Center:** the Q&A list.
  - **Bottom-right:** the "The / Experience" heading block.

---

## 2. Header — shared default (no per-fold treatment)

The shared `<site-nav>` is fixed and identical across folds. The FAQ fold uses the
**same default logo as every other fold** — solid dark ink on cream, nav links the
same. There is **no** see-through/knockout effect and **no** per-fold header CSS;
the logo color is static throughout the FAQ page.

> Historical note: an earlier pass filled the logo's three text parts with the
> fold's left image via `background-clip: text` (an approximate, non-pixel-aligned
> fill, fed an image URL through a `--knockout-image` custom property and gated by
> an `is-knockout-ready` class, with a `--knockout-pos` from the dev picker). That
> effect was **removed** in favour of a solid, static, consistent logo; none of
> that machinery exists anymore.

---

## 3. Left image — full-height column

- Full-height column on the **left**, bleeding to the left, top, and bottom edges.
- The displayed image is a **crop of a larger source** — `object-fit: cover`
  fills the column; `object-position` (from `media.position`) picks the visible
  slice.
- The image is used only in the left column (it is no longer mirrored in the logo).

---

## 4. Image `position` control (reusable across all folds)

Extends the shared media object so any oversized image's crop is adjustable from
content, no re-cropping the file:

| Field      | Meaning                                          | Default    |
|------------|--------------------------------------------------|------------|
| `fit`      | CSS `object-fit`                                 | `"cover"`  |
| `position` | CSS `object-position` (the visible crop)         | `"center"` |
| `zoom`     | scale multiplier (`transform: scale()`)          | `1`        |

- `position` accepts coordinates (`"50% 20%"` — x then y; `0%` = top/left,
  `100%` = bottom/right) or keywords (`"top"`, `"left center"`).
- `zoom` is a numeric multiplier (`1` = no zoom). `>1` magnifies **into** the
  focal point; `<1` shrinks the image within the frame (revealing the column's
  cream background — gaps are allowed, per §0.6). Applied as
  `transform: scale(zoom)` with `transform-origin` set to `position`, so zoom and
  crop stay coherent. The media container clips overflow, so `>1` reads as a
  tighter crop. Sensible range ~`0.2`–`5` (the picker clamps to this).
- **Scope now: FAQ-only (see §0.4).** Added to the shared `createMedia` image
  branch and used on FAQs. The styles are applied **only when the field is
  present**, so the already-built folds' own CSS isn't overridden. Home/About/
  Services/Process are left untouched for now; a full rollout to every fold
  (including migrating `home.js` off its private media renderer) is a **dedicated
  later task**. Conceptually it still applies to any image/video — just not wired
  up everywhere yet.

---

## 5. Dev-only focal-point + zoom picker

A development aid for finding `position` and `zoom` values, **built now and gated
on `?dev`** (see §0.5).

- **Activation:** a `?dev` query flag (off by default).
- **Behavior:** a small control panel (right side, clear of the left image):
  - **Position** — a ▲▼◀▶ **D-pad** nudges the focal point (default 1%/click,
    **Shift = 10%**), plus a center button that resets to `50% 50%`. The **arrow
    keys ↑↓←→** do the same (Shift = 10%), and dragging on the image still works
    for quick big moves. Arrow keys only act while the FAQ fold is showing.
  - **Navigation lock:** while `?dev` is set, fold gesture-navigation is disabled
    (§0.7) so the arrows pan instead of flipping folds; use the nav bar to change
    folds, or reload without `?dev` to leave dev mode.
  - **Zoom** — **− / +** buttons step the scale (default 0.05/click, **Shift =
    0.25**) with the current value shown between them.
  - **Save to faqs.json** — POSTs `{ fold, position, zoom }` to the dev server's
    `POST /__dev/crop` endpoint, which writes `media.position`/`media.zoom`
    straight into `content/faqs.json` — no copy-paste. Dev-server only; the
    deployed static site has no such endpoint (and the picker doesn't run there),
    so Save just reports a failure. The readout still shows the JSON values.
  - No scroll-wheel or `±`-key zoom (buttons replace them), so nothing competes
    with the fold controller's wheel/keyboard navigation.
- **Implementation:** vanilla JS, loaded/activated only when the flag is present
  — no build step. **Note:** with no build/SSR layer yet, the file still lives on
  the static host; `?dev`-gating means it never runs for normal visitors, but it
  is **not** truly stripped from the shipped assets. Real exclusion from the
  production bundle waits for the Worker/SSR pass.

---

## 6. Content model — single file `content/faqs.json`

```json
{
  "fold": "faqs",
  "heading": {
    "eyebrow": "The",
    "title": "Experience"
  },
  "media": {
    "type": "image",
    "src": "/assets/images/faqs-image-placeholder.jpg",
    "fit": "cover",
    "position": "center"
  },
  "faqs": [
    {
      "question": "Is the process personalised?",
      "answer": [
        "Every archive is approached differently.",
        "We spend time understanding your story, materials, and comfort levels before shaping the process around you. No two projects are handled the same way."
      ]
    },
    {
      "question": "Is my information kept private?",
      "answer": [
        "Absolutely!",
        "Any personal material shared with us remains confidential and is never published or shared without your permission."
      ]
    },
    {
      "question": "What are the deliverables and timelines?",
      "answer": [
        "Each archive is unique, and timelines vary depending on the materials and scope of the project.",
        "All deliverables, timelines, and expectations are discussed clearly beforehand."
      ]
    }
  ]
}
```

- `answer` is an **array of paragraphs** so the **deliberate breaks** (punchy
  opening line → elaboration) are preserved exactly.
- No `headerTheme` field — the FAQ logo uses the shared default; there is no
  per-fold header treatment (see §2).
- `position` is the crop control (defaults to `"center"`; tune with the picker).

---

## 7. Typography

Weights are limited to what's currently loaded — Cormorant ≤600, Jost ≤500. No
700/bold is added in this pass (see §0.3); true bold waits for the design-system
pass.

| Element                  | Family (placeholder)               | Treatment            |
|--------------------------|------------------------------------|----------------------|
| Question                 | Cormorant Garamond *italic 600*    | left, above answer   |
| Answer paragraphs        | Cormorant Garamond *italic 400*    | left, stacked        |
| `Experience` title       | Jost 500                           | large, right-aligned |
| `The` eyebrow            | Jost regular                       | small, right-aligned |
| Logo                     | existing logo fonts                | shared default (solid dark ink) |

---

## 8. CSS — `css/folds/faqs.css`

Per-fold styles only:
- Three-region layout: full-height left image | centered Q&A list | bottom-right heading.
- Q&A spacing/rhythm; question vs answer-paragraph type treatment.
- Left image: full-height, `object-fit`/`object-position` from the media object.

Base header/transition/token styles stay in `base.css`. The FAQ logo uses the
shared default — there are no per-fold header rules.

---

## 9. JavaScript

| File          | Change                                                                                  |
|---------------|-----------------------------------------------------------------------------------------|
| `js/faqs.js`  | FAQ renderer: reads `faqs.json`; renders Q&A (answers as paragraph arrays), heading, and the left image with `fit`/`position`. No logo-image logic. |
| `js/folds.js` | **No theme-switching code needed.** (Unchanged for FAQs.) |
| `js/nav.js`   | **No theme attribute / image logic** — the FAQ logo is the shared default. (Unchanged for FAQs.) |
| `js/media.js` | Extend `createMedia`'s image branch to apply `fit`/`position`/`zoom` **only when present**. |
| dev picker    | `js/faqs-dev-picker.js`: focal-point + zoom picker, loaded/activated only under `?dev`.  |
| dev editor    | `js/faqs-dev-editor.js`: text/structure/CSS editor, loaded only under `?dev` (see §12).  |
| `server/dev-server.js` | Dev-only `POST /__dev/crop` (image), `POST /__dev/content` (text+structure → `faqs.json`), `POST /__dev/css` (curated CSS → `faqs.overrides.css`). |

---

## 10. Deferred / out of scope
- **Actual image asset** + final crop `position` — placeholder for now
  (`assets/images/faqs-image-placeholder.jpg` to be added).
- **Full `fit`/`position` rollout** — wiring the crop control into every fold
  (and migrating `home.js` off its private media renderer) is a dedicated later
  task (§0.4).
- **True production stripping of the dev picker** — waits for the Worker/SSR pass;
  `?dev`-gating is the interim (§0.5).
- **Bold font weights** — Cormorant 700 italic / Jost 700 land with the
  design-system pass (§0.3).
- **Real design system** — fonts, colors, spacing.
- **Mobile polish** — sensible defaults only (stack image/Q&A/heading); refined
  later. Note: stacking
  three regions in one viewport may force the "no internal scroll" rule to relax
  on small screens — revisit when mobile polish lands.

---

## 11. Assumptions to confirm
- Fits one viewport (three FAQs, no internal scroll).
- The header logo is the shared default (solid dark ink) on FAQ, same as every
  other fold.

---

## 12. Dev FAQ editor (`js/faqs-dev-editor.js`, `?dev` only)

A second dev tool beside the crop picker (top-right panel; the picker stays
bottom-right). Edits the **live DOM in place** — no re-render. Everything it
injects is tagged `data-faqs-dev` and never persisted; only the overrides CSS
ships.

**Text editing.** Single-click a text element (eyebrow, title, question, answer
line) to **select** it (fills the CSS inspector); double-click to **edit** it
(`contenteditable` plaintext; Enter commits, Escape reverts). All four kinds are
single-line.

**Structure.** Context buttons in the panel add / remove / reorder FAQ items and
answer paragraphs (kept ≥1 each). New nodes use the exact `js/faqs.js` markup so
classes/CSS apply immediately; delegated listeners make them editable at once.

**CSS inspector.** For the selected element's **shared class** (`.faqs__question`
etc.) it shows a curated set: `font-size, font-weight, font-style, color,
line-height, letter-spacing, text-align, margin`. Fields seed from the **declared**
rule value (scanning `document.styleSheets`, skipping the live `<style>` and
cross-origin sheets) so `clamp()`/`var()` are preserved — not `getComputedStyle`.
Only **changed** props are tracked; a live `<style id="faqs-dev-overrides">`
previews them (byte-identical to what's saved).

**Save (two buttons).**
- **Save text** → `POST /__dev/content` `{fold, heading, faqs}` (scraped from the
  DOM). Server read-modify-writes `content/faqs.json`, touching only `heading` +
  `faqs` — **never `media`**, so it can't clobber the crop picker's writes.
- **Save CSS** → `POST /__dev/css` `{fold, overrides:{selector:{prop:value}}}`.
  Server triple-whitelists (selector ∈ the four faqs classes; prop ∈ curated set;
  value charset, no `url(`/`;{}:`), then **re-serializes the whole**
  `css/folds/faqs.overrides.css` from the validated map (no CSS parsing).

`css/folds/faqs.overrides.css` is linked **after** `faqs.css` and loaded **always**
(not gated on `?dev`), so saved CSS is real on the live site; it ships pre-seeded
with just the AUTO-GENERATED header so the link never 404s. The crop picker's
arrow-pan is suppressed while a `contenteditable`/form field is focused, so arrows
move the caret while editing.

Out of scope (same as the rest of the crop tooling): FAQ-only; plaintext (no
markup); class-rule CSS only (no per-instance); curated property set only. The two
`/__dev/*` write endpoints exist only on the dev server — saves fail harmlessly on
the deployed static host.
