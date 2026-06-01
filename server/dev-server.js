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

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8080;

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

const FOLD_RE = /^[a-z][a-z0-9-]*$/; // content/<fold>.json — can't escape the dir

// --- Dev-only: persist FAQ text/structure (POST /__dev/content) --------------
// Writes only `heading` + `faqs` into content/<fold>.json; `media` (the crop the
// picker owns) and `fold` are left untouched so the two save paths never clobber.
const isStr = (v) => typeof v === 'string';
function saveContent(req, res) {
  readJsonBody(req, res, (payload) => {
    try {
      const { fold, heading, faqs } = payload;
      if (!isStr(fold) || !FOLD_RE.test(fold)) return send(res, 400, 'invalid fold');
      if (!heading || !isStr(heading.eyebrow) || !isStr(heading.title)) {
        return send(res, 400, 'invalid heading');
      }
      if (!Array.isArray(faqs) || faqs.length > 100) return send(res, 400, 'invalid faqs');
      for (const item of faqs) {
        if (!item || !isStr(item.question) || item.question.length > 2000) {
          return send(res, 400, 'invalid question');
        }
        if (!Array.isArray(item.answer) || item.answer.length > 50) {
          return send(res, 400, 'invalid answer');
        }
        if (!item.answer.every((l) => isStr(l) && l.length <= 5000)) {
          return send(res, 400, 'invalid answer line');
        }
      }
      const file = path.join(ROOT, 'content', `${fold}.json`);
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      json.heading = { eyebrow: heading.eyebrow, title: heading.title };
      json.faqs = faqs.map((i) => ({ question: i.question, answer: i.answer.slice() }));
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
const CSS_SELECTORS = ['.faqs__eyebrow', '.faqs__title', '.faqs__question', '.faqs__answer-line'];
const CSS_PROPS = [
  'font-size', 'font-weight', 'font-style', 'color',
  'line-height', 'letter-spacing', 'text-align', 'margin',
];
const CSS_VALUE_RE = /^[a-zA-Z0-9 .,%#()/_+-]+$/; // no ; { } : quotes @ url \ newline

// Returns a cleaned { selector: { prop: value } } map, or throws on any violation.
function validateOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') throw new Error('overrides must be an object');
  const clean = {};
  for (const [selector, props] of Object.entries(overrides)) {
    if (!CSS_SELECTORS.includes(selector)) throw new Error(`bad selector: ${selector}`);
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
function serializeOverrides(clean) {
  const header =
    '/* AUTO-GENERATED by the ?dev FAQ editor — overwritten on each Save.\n' +
    '   Loaded after faqs.css on the live site; hand edits will be lost. */\n';
  const blocks = [];
  for (const selector of CSS_SELECTORS) {
    const props = clean[selector];
    if (!props) continue;
    const lines = CSS_PROPS.filter((p) => p in props).map((p) => `  ${p}: ${props[p]};`);
    if (lines.length) blocks.push(`${selector} {\n${lines.join('\n')}\n}`);
  }
  return blocks.length ? `${header}\n${blocks.join('\n\n')}\n` : header;
}

function saveCss(req, res) {
  readJsonBody(req, res, (payload) => {
    try {
      const { fold, overrides } = payload;
      if (!isStr(fold) || !FOLD_RE.test(fold)) return send(res, 400, 'invalid fold');
      const clean = validateOverrides(overrides);
      const file = path.join(ROOT, 'css', 'folds', `${fold}.overrides.css`);
      fs.writeFileSync(file, serializeOverrides(clean));
      send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 400, `save failed: ${err.message}`);
    }
  });
}

const server = http.createServer((req, res) => {
  // Decode + strip query, then resolve safely inside ROOT (no path traversal).
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (req.method === 'POST' && urlPath === '/__dev/crop') return saveCrop(req, res);
  if (req.method === 'POST' && urlPath === '/__dev/content') return saveContent(req, res);
  if (req.method === 'POST' && urlPath === '/__dev/css') return saveCss(req, res);

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

module.exports = { validateOverrides, serializeOverrides };
