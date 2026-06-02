#!/usr/bin/env node
/* ==========================================================================
   Minimal .env loader (Node built-ins only — keeps the dev server zero-dep).
   Reads KEY=value lines from <root>/.env into process.env, WITHOUT clobbering
   anything already set in the real environment — so an inline override like
   `MP_DEV_KEY=… npm run dev` still wins. Tolerates `KEY = value` (spaces around
   the `=`), surrounding single/double quotes, blank lines, and `#` comments.
   A missing .env is a no-op. Dev-only; the deployed static site has no server.
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

function loadEnv(file = path.resolve(__dirname, '..', '.env')) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return; // no .env present — nothing to load
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue; // blank or comment
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    // Strip one matching pair of surrounding quotes, if present.
    if (
      value.length >= 2 &&
      (value[0] === '"' || value[0] === "'") &&
      value[value.length - 1] === value[0]
    ) {
      value = value.slice(1, -1);
    }
    // The real environment wins, so inline `KEY=… npm run dev` is never overwritten.
    if (!(key in process.env)) process.env[key] = value;
  }
}

module.exports = { loadEnv };
