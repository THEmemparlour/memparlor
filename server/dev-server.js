#!/usr/bin/env node
/* ==========================================================================
   Minimal static dev server (Node built-ins only — no dependencies).
   Serves the project root and falls back to index.html for clean-path routes
   (e.g. /about-us) so deep links work. Mirrors what the Worker/SSR pass will
   do later; not a production server.
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const r2 = require('./r2'); // hand-rolled SigV4 R2 upload (built-ins only)

// Populate process.env from <root>/.env before anything reads it (e.g. DEV_KEY
// below, and the lazy R2_* lookups in r2.js). Inline env overrides still win.
require('./load-env').loadEnv();

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8080;

// Passphrase gate for the dev write endpoints (and the client's /__dev/auth check).
// The ?dev tools are DISABLED unless MP_DEV_KEY is set — there is no open mode.
const DEV_KEY = process.env.MP_DEV_KEY || '';

// True only when a key is configured AND `provided` matches it. With no key
// configured, dev is disabled, so nothing validates.
// Constant-time compare with a length guard so timing can't leak the key length.
function keyOk(provided) {
  if (!DEV_KEY) return false; // dev disabled — no passphrase configured
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(DEV_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 500, 'Internal Server Error');
    send(res, 200, data, MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  });
}

// Dev-only: persist a fold's image crop (media.position / media.zoom) so the
// ?dev focal-point picker can "Save" straight to content/<fold>.json instead of
// the user copy-pasting. Dev convenience only — there is no such endpoint on the
// deployed static site, where the picker doesn't run anyway.
function saveCrop(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1e5) req.destroy(); // guard against runaway payloads
  });
  req.on('end', () => {
    try {
      const { fold, position, zoom } = JSON.parse(body || '{}');
      // fold names map to content/<fold>.json — restrict the charset so this can
      // never escape the content dir.
      if (typeof fold !== 'string' || !/^[a-z][a-z0-9-]*$/.test(fold)) {
        return send(res, 400, 'invalid fold');
      }
      const file = path.join(ROOT, 'content', `${fold}.json`);
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      json.media = json.media || {};
      if (typeof position === 'string' && /^[\d%.\s a-z-]+$/i.test(position)) {
        json.media.position = position;
      }
      if (typeof zoom === 'number' && Number.isFinite(zoom)) {
        json.media.zoom = zoom;
      }
      fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
      send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 400, `save failed: ${err.message}`);
    }
  });
}

// Read a JSON body (≤100 KB) then hand the parsed object to `cb`. 400 on bad JSON.
function readJsonBody(req, res, cb) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1e5) req.destroy();
  });
  req.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(body || '{}');
    } catch (err) {
      return send(res, 400, `bad JSON: ${err.message}`);
    }
    cb(parsed);
  });
}

// Read a raw binary body (for media uploads) up to R2_MAX_UPLOAD_MB (default 50);
// over the cap we destroy the socket. The JSON readers cap at 100 KB, which is far
// too small for an image/video — hence this separate reader.
function readRawBody(req, res, cb) {
  const cap = (Number(process.env.R2_MAX_UPLOAD_MB) || 50) * 1024 * 1024;
  const chunks = [];
  let size = 0;
  let over = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > cap) { over = true; req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => { if (!over) cb(Buffer.concat(chunks)); });
}

const FOLD_RE = /^[a-z][a-z0-9-]*$/; // content/<fold>.json — can't escape the dir

const isStr = (v) => typeof v === 'string';

// --- Per-fold content validators (POST /__dev/content) -----------------------
// Each returns the PARTIAL set of keys to write; the caller merges them into the
// existing JSON, so `media` (owned by the crop picker) and `fold` are preserved
// and the two save paths never clobber each other.
function validateFaqsContent(payload) {
  const { heading, faqs } = payload;
  if (!heading || !isStr(heading.eyebrow) || !isStr(heading.title)) throw new Error('invalid heading');
  if (!Array.isArray(faqs) || faqs.length > 100) throw new Error('invalid faqs');
  for (const item of faqs) {
    if (!item || !isStr(item.question) || item.question.length > 2000) throw new Error('invalid question');
    if (!Array.isArray(item.answer) || item.answer.length > 50) throw new Error('invalid answer');
    if (!item.answer.every((l) => isStr(l) && l.length <= 5000)) throw new Error('invalid answer line');
  }
  return {
    heading: { eyebrow: heading.eyebrow, title: heading.title },
    faqs: faqs.map((i) => ({ question: i.question, answer: i.answer.slice() })),
  };
}

function validateHomeContent(payload) {
  const { headline } = payload;
  if (!Array.isArray(headline) || headline.length > 200) throw new Error('invalid headline');
  const clean = headline.map((seg) => {
    if (seg && seg.break === true) return { break: true };
    if (seg && isStr(seg.text) && seg.text.length <= 500 && (seg.style === 'upright' || seg.style === 'italic')) {
      return { text: seg.text, style: seg.style };
    }
    throw new Error('invalid headline segment');
  });
  return { headline: clean };
}

function validateAboutContent(payload) {
  const { heading, poem } = payload;
  if (!heading || !isStr(heading.eyebrow) || !isStr(heading.title)) throw new Error('invalid heading');
  if (!Array.isArray(poem) || poem.length > 100) throw new Error('invalid poem');
  if (!poem.every((l) => isStr(l) && l.length <= 5000)) throw new Error('invalid poem line');
  return {
    heading: { eyebrow: heading.eyebrow, title: heading.title },
    poem: poem.slice(),
  };
}

function validateServicesContent(payload) {
  const { heading, services } = payload;
  if (!heading || !isStr(heading.eyebrow) || !isStr(heading.title)) throw new Error('invalid heading');
  if (!Array.isArray(services) || services.length > 100) throw new Error('invalid services');
  for (const s of services) {
    if (!s || !isStr(s.label) || s.label.length > 500) throw new Error('invalid service label');
    if (!isStr(s.description) || s.description.length > 5000) throw new Error('invalid service description');
  }
  return {
    heading: { eyebrow: heading.eyebrow, title: heading.title },
    services: services.map((s) => ({ label: s.label, description: s.description })),
  };
}

function validateProcessContent(payload) {
  const { heading, lede, steps } = payload;
  if (!heading || !isStr(heading.eyebrow) || !isStr(heading.title)) throw new Error('invalid heading');
  if (!Array.isArray(lede) || lede.length > 50) throw new Error('invalid lede');
  if (!lede.every((l) => isStr(l) && l.length <= 5000)) throw new Error('invalid lede line');
  if (!Array.isArray(steps) || steps.length > 100) throw new Error('invalid steps');
  for (const s of steps) {
    if (!s || !isStr(s.title) || s.title.length > 500) throw new Error('invalid step title');
    if (!isStr(s.description) || s.description.length > 5000) throw new Error('invalid step description');
  }
  return {
    heading: { eyebrow: heading.eyebrow, title: heading.title },
    lede: lede.slice(),
    steps: steps.map((s) => ({ title: s.title, description: s.description })),
  };
}

function validateContactContent(payload) {
  const { lede, body, heading } = payload;
  if (!isStr(lede) || lede.length > 5000) throw new Error('invalid lede'); // a single string, not an array
  if (!Array.isArray(body) || body.length > 100) throw new Error('invalid body');
  if (!body.every((l) => isStr(l) && l.length <= 5000)) throw new Error('invalid body line');
  if (!heading || !isStr(heading.eyebrow) || !isStr(heading.title)) throw new Error('invalid heading');
  return {
    lede,
    body: body.slice(),
    heading: { eyebrow: heading.eyebrow, title: heading.title },
  };
}

// The shared nav/header (content/site.json) — logo text + nav-link labels. Labels
// are editable; each link's route (path/fold) is passed through. Structure is not
// re-ordered/changed here, but every field is still validated before it's written.
function validateSiteContent(payload) {
  const { logo, nav } = payload;
  if (!logo || typeof logo !== 'object') throw new Error('invalid logo');
  for (const f of ['tagline', 'wordmark', 'established', 'href']) {
    if (!isStr(logo[f]) || logo[f].length > 500) throw new Error(`invalid logo.${f}`);
  }
  if (!Array.isArray(nav) || nav.length > 20) throw new Error('invalid nav');
  for (const item of nav) {
    if (!item || !isStr(item.label) || item.label.length > 200) throw new Error('invalid nav label');
    if (!isStr(item.path) || item.path.length > 200) throw new Error('invalid nav path');
    if (!isStr(item.fold) || !FOLD_RE.test(item.fold)) throw new Error('invalid nav fold');
  }
  return {
    logo: { tagline: logo.tagline, wordmark: logo.wordmark, established: logo.established, href: logo.href },
    nav: nav.map((i) => ({ label: i.label, path: i.path, fold: i.fold })),
  };
}

// Per-fold config: which CSS selectors may be overridden, and the content shape.
const FOLDS = {
  faqs: {
    cssSelectors: ['.faqs__eyebrow', '.faqs__title', '.faqs__question', '.faqs__answer-line'],
    layoutSelectors: ['.faqs__heading', '.faqs__list'],
    validateContent: validateFaqsContent,
  },
  home: {
    cssSelectors: ['.home__headline', '.home__seg--upright', '.home__seg--italic'],
    layoutSelectors: ['.home__headline'],
    validateContent: validateHomeContent,
  },
  about: {
    cssSelectors: ['.about__eyebrow', '.about__title', '.about__poem-line'],
    layoutSelectors: ['.about__heading', '.about__poem'],
    validateContent: validateAboutContent,
  },
  services: {
    cssSelectors: ['.services__eyebrow', '.services__title', '.services__list h2', '.services__list p'],
    layoutSelectors: ['.services__heading', '.services__list'],
    validateContent: validateServicesContent,
  },
  process: {
    cssSelectors: ['.process__eyebrow', '.process__title', '.process__lede-line', '.process__step-head', '.process__step-desc'],
    layoutSelectors: ['.process__heading', '.process__lede', '.process__steps'],
    validateContent: validateProcessContent,
  },
  contact: {
    cssSelectors: ['.contact__lede', '.contact__body-line', '.contact__eyebrow', '.contact__title'],
    layoutSelectors: ['.contact__heading', '.contact__lede', '.contact__body'],
    validateContent: validateContactContent,
  },
  // Shared fold heading typography (not a fold, no content/layout). The ?dev heading
  // editor on every fold routes its eyebrow/title edits here so one Save styles them
  // all; written to css/folds/headings.overrides.css via the generic saveCss path.
  headings: {
    cssSelectors: ['.fold-eyebrow', '.fold-title'],
  },
  // The shared nav/header (not a fold). content/site.json + css/folds/site.overrides.css.
  site: {
    // .site-nav__link.is-active = the active link's higher-specificity state; the
    // nav editor targets it when the active link is selected (see dev-config.site.js).
    cssSelectors: ['.logo__tagline', '.logo__wordmark', '.logo__est', '.site-nav__link', '.site-nav__link.is-active'],
    validateContent: validateSiteContent,
  },
};

function saveContent(req, res) {
  readJsonBody(req, res, (payload) => {
    try {
      const { fold } = payload;
      if (!isStr(fold) || !FOLD_RE.test(fold)) return send(res, 400, 'invalid fold');
      const cfg = FOLDS[fold];
      if (!cfg) return send(res, 400, 'unknown fold');
      const partial = cfg.validateContent(payload); // throws on invalid shape
      const file = path.join(ROOT, 'content', `${fold}.json`);
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.assign(json, partial); // merge only the validated keys; preserve media/fold
      fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
      send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 400, `save failed: ${err.message}`);
    }
  });
}

// --- Dev-only: persist curated CSS overrides (POST /__dev/css) ----------------
// Triple whitelist (selector / property / value charset), then re-serialize the
// WHOLE overrides file from the validated map — no parsing/patching of CSS.
const CSS_PROPS = [
  'font-size', 'font-weight', 'font-style', 'color',
  'line-height', 'letter-spacing', 'text-align', 'margin',
];
const CSS_VALUE_RE = /^[a-zA-Z0-9 .,%#()/_+-]+$/; // no ; { } : quotes @ url \ newline

// Returns a cleaned { selector: { prop: value } } map, or throws on any violation.
// `allowedSelectors` is the per-fold whitelist.
function validateOverrides(overrides, allowedSelectors) {
  if (!overrides || typeof overrides !== 'object') throw new Error('overrides must be an object');
  const clean = {};
  for (const [selector, props] of Object.entries(overrides)) {
    if (!allowedSelectors.includes(selector)) throw new Error(`bad selector: ${selector}`);
    if (!props || typeof props !== 'object') throw new Error(`bad rule: ${selector}`);
    const cleanProps = {};
    for (const [prop, value] of Object.entries(props)) {
      if (!CSS_PROPS.includes(prop)) throw new Error(`bad property: ${prop}`);
      if (!isStr(value) || value.length > 200 || !CSS_VALUE_RE.test(value) || /url\s*\(/i.test(value)) {
        throw new Error(`bad value for ${prop}`);
      }
      cleanProps[prop] = value.trim();
    }
    if (Object.keys(cleanProps).length) clean[selector] = cleanProps;
  }
  return clean;
}

// Serialize the validated map into the overrides stylesheet (canonical order).
// When `media` is set (e.g. 'max-width: 768px') the rules are wrapped in one
// indented @media block, so the mobile shell's overrides file is breakpoint-scoped
// (see saveCssMobile). The default (null) emits the original flat, unscoped rules,
// so the desktop /__dev/css path is byte-for-byte unchanged.
function serializeOverrides(clean, allowedSelectors, media = null) {
  const header =
    '/* AUTO-GENERATED by the ?dev editor — overwritten on each Save.\n' +
    '   Loaded after the fold stylesheet on the live site; hand edits will be lost. */\n';
  const pad = media ? '  ' : '';
  const blocks = [];
  for (const selector of allowedSelectors) {
    const props = clean[selector];
    if (!props) continue;
    const lines = CSS_PROPS.filter((p) => p in props).map((p) => `${pad}  ${p}: ${props[p]};`);
    if (lines.length) blocks.push(`${pad}${selector} {\n${lines.join('\n')}\n${pad}}`);
  }
  if (!blocks.length) return header;
  const body = media ? `@media (${media}) {\n${blocks.join('\n\n')}\n}` : blocks.join('\n\n');
  return `${header}\n${body}\n`;
}

function saveCss(req, res) {
  readJsonBody(req, res, (payload) => {
    try {
      const { fold, overrides } = payload;
      if (!isStr(fold) || !FOLD_RE.test(fold)) return send(res, 400, 'invalid fold');
      const cfg = FOLDS[fold];
      if (!cfg) return send(res, 400, 'unknown fold');
      const clean = validateOverrides(overrides, cfg.cssSelectors);
      const file = path.join(ROOT, 'css', 'folds', `${fold}.overrides.css`);
      fs.writeFileSync(file, serializeOverrides(clean, cfg.cssSelectors));
      send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 400, `save failed: ${err.message}`);
    }
  });
}

// --- Dev-only: persist MOBILE curated CSS overrides (POST /__dev/css-mobile) ---
// Sibling of saveCss for the ?dev mobile shell's text/style tool. Identical triple
// whitelist (CSS_PROPS / CSS_VALUE_RE / per-fold cssSelectors) and X-Dev-Key gate,
// but emits an @media (max-width:768px) block to a SEPARATE file. Because the
// desktop and mobile overrides live in disjoint files (the mobile one is media-
// scoped and loaded after it), neither save can clobber the other — mirrors the
// layout / layout-mobile split, no server-side merge needed.
function saveCssMobile(req, res) {
  readJsonBody(req, res, (payload) => {
    try {
      const { fold, overrides } = payload;
      if (!isStr(fold) || !FOLD_RE.test(fold)) return send(res, 400, 'invalid fold');
      const cfg = FOLDS[fold];
      if (!cfg) return send(res, 400, 'unknown fold');
      const clean = validateOverrides(overrides, cfg.cssSelectors);
      const file = path.join(ROOT, 'css', 'folds', `${fold}.overrides.mobile.css`);
      fs.writeFileSync(file, serializeOverrides(clean, cfg.cssSelectors, 'max-width: 768px'));
      send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 400, `save failed: ${err.message}`);
    }
  });
}

// --- Dev-only: persist per-block layout (POST /__dev/layout) -----------------
// Free positioning for singleton text blocks: position/left/top/width stored
// breakpoint-keyed and emitted inside a media query, so the desktop layout never
// touches ≤768px (which keeps its normal responsive flow). Percent-only values,
// per-fold selector whitelist — same defence-in-depth as the CSS overrides.
const LAYOUT_BREAKPOINTS = { desktop: 'min-width: 769px' }; // desktop in-page layout tool
// The ?dev mobile preview shell writes the complementary query to its own file
// (see saveLayoutMobile), so the two breakpoints live in disjoint files and a save
// on one can never clobber the other. The helpers below take the map as a param so
// the desktop and mobile paths share one validator/serializer.
const MOBILE_BREAKPOINTS = { mobile: 'max-width: 768px' };
const PCT_RE = /^-?\d+(?:\.\d+)?%$/; // percent only — no var()/calc()/other units

// Returns cleaned { breakpoint: { selector: { left, top, width } } }, or throws.
// `breakpoints` whitelists the allowed breakpoint keys (defaults to desktop).
function validateLayout(layout, allowedSelectors, breakpoints = LAYOUT_BREAKPOINTS) {
  if (!layout || typeof layout !== 'object') throw new Error('layout must be an object');
  const clean = {};
  for (const [bp, blocks] of Object.entries(layout)) {
    if (!(bp in breakpoints)) throw new Error(`bad breakpoint: ${bp}`);
    if (!blocks || typeof blocks !== 'object') throw new Error(`bad breakpoint block: ${bp}`);
    const cleanBlocks = {};
    for (const [selector, props] of Object.entries(blocks)) {
      if (!allowedSelectors.includes(selector)) throw new Error(`bad selector: ${selector}`);
      if (!props || typeof props !== 'object') throw new Error(`bad rule: ${selector}`);
      for (const k of ['left', 'top', 'width']) {
        if (!isStr(props[k]) || !PCT_RE.test(props[k])) throw new Error(`bad ${k} for ${selector}`);
      }
      cleanBlocks[selector] = { left: props.left.trim(), top: props.top.trim(), width: props.width.trim() };
    }
    if (Object.keys(cleanBlocks).length) clean[bp] = cleanBlocks;
  }
  return clean;
}

// Serialize the validated map into the layout stylesheet: one @media block per
// breakpoint. `right/bottom/transform` are reset so left/top/width fully govern
// (neutralising any natural transform/anchor on the block).
function serializeLayout(clean, allowedSelectors, breakpoints = LAYOUT_BREAKPOINTS) {
  const header =
    '/* AUTO-GENERATED by the ?dev layout tool — overwritten on each Save.\n' +
    '   Loaded after the fold stylesheet on the live site; hand edits will be lost. */\n';
  const mediaBlocks = [];
  for (const [bp, query] of Object.entries(breakpoints)) {
    const blocks = clean[bp];
    if (!blocks) continue;
    const rules = [];
    for (const selector of allowedSelectors) {
      const v = blocks[selector];
      if (!v) continue;
      rules.push(
        `  ${selector} {\n` +
        `    position: absolute;\n` +
        `    left: ${v.left};\n` +
        `    top: ${v.top};\n` +
        `    width: ${v.width};\n` +
        `    max-width: none;\n` +
        `    right: auto;\n` +
        `    bottom: auto;\n` +
        `    transform: none;\n` +
        `  }\n\n` +
        // Let inner text fill the widened block (e.g. `.services__list p` is capped
        // at 48ch). !important because that base rule (specificity 0,1,1) outranks
        // `${selector} *` (0,1,0). Scoped to this block, desktop-only.
        `  ${selector} * { max-width: none !important; }`
      );
    }
    if (rules.length) mediaBlocks.push(`@media (${query}) {\n${rules.join('\n\n')}\n}`);
  }
  return mediaBlocks.length ? `${header}\n${mediaBlocks.join('\n\n')}\n` : header;
}

function saveLayout(req, res) {
  readJsonBody(req, res, (payload) => {
    try {
      const { fold, layout } = payload;
      if (!isStr(fold) || !FOLD_RE.test(fold)) return send(res, 400, 'invalid fold');
      const cfg = FOLDS[fold];
      if (!cfg || !cfg.layoutSelectors) return send(res, 400, 'unknown fold');
      const clean = validateLayout(layout, cfg.layoutSelectors);
      const file = path.join(ROOT, 'css', 'folds', `${fold}.layout.css`);
      fs.writeFileSync(file, serializeLayout(clean, cfg.layoutSelectors));
      send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 400, `save failed: ${err.message}`);
    }
  });
}

// --- Dev-only: persist per-block MOBILE layout (POST /__dev/layout-mobile) ----
// Sibling of saveLayout for the ?dev mobile preview shell. Identical validation,
// per-fold selector whitelist, and auth (the route block gates the X-Dev-Key), but
// emits the complementary @media (max-width:768px) block to a SEPARATE file. Because
// the desktop and mobile rules live in disjoint files with disjoint queries, neither
// save can clobber the other — no server-side merge needed (see spec §4.2).
function saveLayoutMobile(req, res) {
  readJsonBody(req, res, (payload) => {
    try {
      const { fold, layout } = payload;
      if (!isStr(fold) || !FOLD_RE.test(fold)) return send(res, 400, 'invalid fold');
      const cfg = FOLDS[fold];
      if (!cfg || !cfg.layoutSelectors) return send(res, 400, 'unknown fold');
      const clean = validateLayout(layout, cfg.layoutSelectors, MOBILE_BREAKPOINTS);
      const file = path.join(ROOT, 'css', 'folds', `${fold}.layout.mobile.css`);
      fs.writeFileSync(file, serializeLayout(clean, cfg.layoutSelectors, MOBILE_BREAKPOINTS));
      send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 400, `save failed: ${err.message}`);
    }
  });
}

// --- Dev-only: upload media to Cloudflare R2 (POST /__dev/upload) ------------
// Streams the raw request body to R2 via the SigV4 helper and returns the public
// custom-domain URL. The fold + filename come from headers (the body is the file).
// Disabled (503) when the R2_* env isn't configured — like the dev key, this is a
// local-authoring-only capability with no presence on the deployed site.
const UPLOAD_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif',
  'video/mp4', 'video/webm',
]);

function handleUpload(req, res) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!UPLOAD_TYPES.has(contentType)) return send(res, 400, 'unsupported content-type');
  const fold = req.headers['x-media-fold'];
  if (!isStr(fold) || !FOLD_RE.test(fold)) return send(res, 400, 'invalid fold');
  // Sanitize the filename to a safe slug; the key path is fully server-controlled.
  const name =
    String(req.headers['x-file-name'] || 'file')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-.]+|-+$/g, '') || 'file';
  if (!r2.r2Configured()) {
    return send(res, 503, JSON.stringify({ error: 'r2 not configured' }), 'application/json; charset=utf-8');
  }
  readRawBody(req, res, async (body) => {
    if (!body.length) return send(res, 400, 'empty body');
    const key = `media/${fold}/${Date.now()}-${name}`;
    try {
      const { url } = await r2.putObject({ key, body, contentType });
      send(res, 200, JSON.stringify({ url }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 502, JSON.stringify({ error: String(err.message || err) }), 'application/json; charset=utf-8');
    }
  });
}

// --- Dev-only: persist media source fields (POST /__dev/media) ----------------
// Read-modify-write of content/<fold>.json's media.{src,alt?,poster?} only — every
// other media key (type/position/zoom/fit + the video flags) is preserved, exactly
// like saveCrop. `src` is the uploaded R2 URL or a pasted https/asset path. Type-
// switching (image↔video) is out of scope and authored by hand.
const validMediaUrl = (v) => isStr(v) && v.length <= 2000 && (v.startsWith('https://') || v.startsWith('/assets/'));

function saveMedia(req, res) {
  readJsonBody(req, res, (payload) => {
    try {
      const { fold, src, alt, poster } = payload;
      if (!isStr(fold) || !FOLD_RE.test(fold)) return send(res, 400, 'invalid fold');
      if (!FOLDS[fold]) return send(res, 400, 'unknown fold'); // restrict to known content files, like the other write endpoints
      if (!validMediaUrl(src)) return send(res, 400, 'invalid src');
      if (alt != null && (!isStr(alt) || alt.length > 2000)) return send(res, 400, 'invalid alt');
      if (poster != null && !validMediaUrl(poster)) return send(res, 400, 'invalid poster');
      const file = path.join(ROOT, 'content', `${fold}.json`);
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      json.media = json.media || {};
      json.media.src = src;
      if (alt != null) json.media.alt = alt;
      if (poster != null) json.media.poster = poster;
      fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
      send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 400, `save failed: ${err.message}`);
    }
  });
}

// Validate a passphrase for the client gate. The client never learns the real key —
// it sends what the user typed and we just say yes/no. When no key is configured
// dev is disabled: reply 403 {configured:false} so the client stays locked WITHOUT
// prompting (distinct from a 401 wrong-key).
function devAuth(req, res) {
  readJsonBody(req, res, ({ key }) => {
    if (!DEV_KEY) {
      return send(res, 403, JSON.stringify({ ok: false, configured: false }), 'application/json; charset=utf-8');
    }
    if (keyOk(key)) {
      return send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    }
    send(res, 401, JSON.stringify({ ok: false }), 'application/json; charset=utf-8');
  });
}

const server = http.createServer((req, res) => {
  // Decode + strip query, then resolve safely inside ROOT (no path traversal).
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (req.method === 'POST' && urlPath === '/__dev/auth') return devAuth(req, res);

  // Writes require the passphrase (header-based, so it's checked before the body
  // is read). In open mode (no MP_DEV_KEY) keyOk() always passes.
  if (req.method === 'POST' && urlPath.startsWith('/__dev/')) {
    if (!keyOk(req.headers['x-dev-key'])) return send(res, 401, 'unauthorized');
    if (urlPath === '/__dev/crop') return saveCrop(req, res);
    if (urlPath === '/__dev/content') return saveContent(req, res);
    if (urlPath === '/__dev/css') return saveCss(req, res);
    if (urlPath === '/__dev/css-mobile') return saveCssMobile(req, res);
    if (urlPath === '/__dev/layout') return saveLayout(req, res);
    if (urlPath === '/__dev/layout-mobile') return saveLayoutMobile(req, res);
    if (urlPath === '/__dev/upload') return handleUpload(req, res);
    if (urlPath === '/__dev/media') return saveMedia(req, res);
  }

  const resolved = path.normalize(path.join(ROOT, urlPath));
  // Guard against path traversal. A bare startsWith(ROOT) would also pass for a
  // sibling dir sharing the prefix (e.g. <root>-private), so require the path to
  // be ROOT itself or sit under ROOT + separator.
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden');
  }

  fs.stat(resolved, (err, stats) => {
    if (!err && stats.isFile()) return serveFile(res, resolved);
    if (!err && stats.isDirectory()) return serveFile(res, path.join(resolved, 'index.html'));

    // No file at this path. If it looks like a clean route (no file extension),
    // fall back to index.html so the client router can handle it.
    if (!path.extname(urlPath)) return serveFile(res, path.join(ROOT, 'index.html'));

    send(res, 404, 'Not Found');
  });
});

// Try the requested port; if it's busy, walk up to the next few free ones so a
// stray process on 8080 doesn't block `npm run dev`. Set PORT to pin it.
const MAX_PORT_TRIES = 10;

server.on('listening', () => {
  console.log(`Memory Parlour dev server → http://localhost:${server.address().port}`);
  if (!DEV_KEY) {
    console.warn('[dev] MP_DEV_KEY not set — the ?dev tools are DISABLED. Set MP_DEV_KEY to enable them.');
  }
  if (!r2.r2Configured()) {
    console.warn('[dev] R2_* env not fully set — media upload (POST /__dev/upload) is DISABLED. Set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_BASE_URL to enable it.');
  }
});

function listen(port, triesLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) {
      console.warn(`Port ${port} is in use, trying ${port + 1}…`);
      listen(port + 1, triesLeft - 1);
    } else {
      console.error(err.message);
      process.exit(1);
    }
  });
  server.listen(port);
}

// Start listening only when run directly (`node server/dev-server.js`); when
// required (e.g. unit-testing the validators) just expose the pure helpers.
if (require.main === module) {
  listen(Number(PORT), MAX_PORT_TRIES);
}

module.exports = { validateOverrides, serializeOverrides, validateLayout, serializeLayout };
