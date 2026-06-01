# Memory Parlour — FAQs Fold Spec

> Scope: the **FAQs** fold only. Builds on the implemented shell and the media
> model. Introduces three things: a **per-fold header treatment** (the header is
> shared/fixed, so this fold overrides it), a **see-through/knockout logo**
> filled with the fold's image, and a reusable **image `position` (crop)
> control** plus a **dev-only focal-point picker**.

---

## 0. Build decisions (resolved)

These supersede any conflicting detail below; the original intent is kept for
context but scoped to what we're building now.

1. **Knockout logo — approximate CSS fill, not a true cut-out.** Fill the logo
   letters with the FAQ image via `background-clip: text` (pure CSS). We do **not**
   pixel-align the fill to the photo behind it (no JS geometry / resize handler).
   A faithful, aligned cut-out is deferred to the design-system pass. See §2.1.
2. **No `data-header-theme` machinery.** The controller already mirrors
   `<html data-fold="faqs">`, so the knockout is keyed off that in CSS and resets
   automatically on leave. `js/folds.js` needs **no** theme-switching code. The
   only JS-side need is handing the **image URL** to the header (a CSS custom
   property, e.g. `--knockout-image`). See §2 / §9.
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

## 2. Header — per-fold treatment (refactor)

The shared `<site-nav>` is fixed and identical across folds, so a per-page look
is a **per-fold treatment keyed off the active fold**. The controller already
mirrors the active fold on `<html data-fold="…">`, so the treatment is **pure CSS**
keyed on `html[data-fold="faqs"]` — it applies on enter and reverts on leave with
no JS theme-switching. (No `data-header-theme` attribute is introduced; see §0.2.)

- **Default treatment** (Home / About / Services / Process / Contact):
  dark text on cream — the original look.
- **FAQ treatment:** the **logo** uses the see-through/knockout effect; the
  **nav links stay normal dark text on cream**.

### 2.1 See-through logo (knockout) — approximate CSS fill
- The logo's three text parts are filled with the **fold's left image** via
  `background-clip: text` (transparent letter fill revealing the photo).
- **Approximate fill only (see §0.1).** The fill is *not* pixel-aligned to the
  image's on-screen position — the letters read as image-filled, not as an exact
  cut-out of the photo directly behind them. A faithful, geometry-aligned cut-out
  (JS that matches the column's cover-crop and recomputes on resize) is deferred
  to the design-system pass.
- The image URL is the only dynamic input the header needs. The controller (or
  the FAQ renderer) exposes it as a CSS custom property (e.g. `--knockout-image`)
  the logo's `background-image` reads; no per-fold content is loaded by the
  controller itself.
- **Nav links are excluded** — the image is left-only, so there's nothing behind
  the right-side nav to reveal; they remain dark text on cream.

### 2.2 Legibility
- See-through letters reveal whatever is behind them, so a light image patch
  yields low contrast.
- Mitigation: use the image **`position`** control (§4) to slide a darker slice
  of the image behind the logo; tune it with the picker (§5).
- Adaptive blend (`mix-blend-mode`) remains a possible fallback if the effect is
  ever too subtle, but is **not** used by default.

---

## 3. Left image — full-height column

- Full-height column on the **left**, bleeding to the left, top, and bottom edges.
- The displayed image is a **crop of a larger source** — `object-fit: cover`
  fills the column; `object-position` (from `media.position`) picks the visible
  slice.
- This is the **same image** the knockout logo reveals (§2.1).

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
- No `headerTheme` field — the knockout treatment is keyed in CSS off
  `html[data-fold="faqs"]` (see §0.2). The same image referenced in `media` feeds
  the knockout logo fill via the `--knockout-image` custom property.
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
| Logo (knockout)          | existing logo fonts                | filled with image    |

---

## 8. CSS — `css/folds/faqs.css`

Per-fold styles only:
- Three-region layout: full-height left image | centered Q&A list | bottom-right heading.
- Q&A spacing/rhythm; question vs answer-paragraph type treatment.
- Left image: full-height, `object-fit`/`object-position` from the media object.
- FAQ header theme: knockout logo (`background-clip: text` on the logo, fed the
  fold image), nav links left as default dark text.

Base header/transition/token styles stay in `base.css`. The FAQ header treatment
is keyed in CSS off `html[data-fold="faqs"]` (already mirrored by the controller),
so there's no JS theme-switching hook — the knockout rules live here and read the
`--knockout-image` custom property for the logo fill (see §0.2 / §2.1).

---

## 9. JavaScript

| File          | Change                                                                                  |
|---------------|-----------------------------------------------------------------------------------------|
| `js/faqs.js`  | FAQ renderer: reads `faqs.json`; renders Q&A (answers as paragraph arrays), heading, and the left image with `fit`/`position`. Also publishes the image URL as the `--knockout-image` custom property for the logo fill. |
| `js/folds.js` | **No theme-switching code needed** — the existing `data-fold` mirror drives the CSS treatment. (Unchanged for FAQs.) |
| `js/nav.js`   | **No theme attribute / image logic** — the knockout is pure CSS keyed on `html[data-fold="faqs"]`, reading `--knockout-image`. (Unchanged for FAQs.) |
| `js/media.js` | Extend `createMedia`'s image branch to apply `fit`/`position`/`zoom` **only when present**. |
| dev picker    | `js/faqs-dev-picker.js`: focal-point + zoom picker, loaded/activated only under `?dev`.  |
| dev editor    | `js/faqs-dev-editor.js`: text/structure/CSS editor, loaded only under `?dev` (see §12).  |
| `server/dev-server.js` | Dev-only `POST /__dev/crop` (image), `POST /__dev/content` (text+structure → `faqs.json`), `POST /__dev/css` (curated CSS → `faqs.overrides.css`). |

---

## 10. Deferred / out of scope
- **Actual image asset** + final crop `position` — placeholder for now
  (`assets/images/faqs-image-placeholder.jpg` to be added).
- **True knockout cut-out** — geometry-aligned fill (letters showing the exact
  slice of the photo behind them, recomputed on resize). This pass ships the
  approximate CSS fill only (§0.1).
- **Full `fit`/`position` rollout** — wiring the crop control into every fold
  (and migrating `home.js` off its private media renderer) is a dedicated later
  task (§0.4).
- **True production stripping of the dev picker** — waits for the Worker/SSR pass;
  `?dev`-gating is the interim (§0.5).
- **Bold font weights** — Cormorant 700 italic / Jost 700 land with the
  design-system pass (§0.3).
- **Real design system** — fonts, colors, spacing.
- **Mobile polish** — sensible defaults only (stack image/Q&A/heading; the
  knockout logo may simplify on small screens); refined later. Note: stacking
  three regions in one viewport may force the "no internal scroll" rule to relax
  on small screens — revisit when mobile polish lands.

---

## 11. Assumptions to confirm
- Fits one viewport (three FAQs, no internal scroll).
- Knockout logo is fed the **same** left-column image (not a separate asset).
- Header reverts to the default dark-on-cream treatment on every other fold.

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
