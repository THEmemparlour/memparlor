/* ==========================================================================
   Cloudflare R2 upload — hand-rolled AWS SigV4 over Node built-ins only.
   The dev server is intentionally zero-dependency, so rather than pull in the
   AWS SDK we sign an S3-compatible PUT ourselves with `crypto` + `https`.

   Used ONLY by the local ?dev media panel (POST /__dev/upload): it streams a
   file to R2's S3 API and hands back the public custom-domain URL, which the
   editor then writes into content/<fold>.json. Production never touches this —
   it just reads the stored URL.

   Config (all five required) from env, never committed:
     R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET
     R2_PUBLIC_BASE_URL  (custom-domain base; public URL = `${base}/${key}`)

   The signing helpers are exported so server/r2.test.js can drive them against
   AWS's published SigV4 test vector (deterministic + offline) without a network.
   ========================================================================== */

'use strict';

const crypto = require('crypto');
const https = require('https');

// --- Primitive crypto helpers ----------------------------------------------
// HMAC-SHA256 → Buffer (chainable for the signing-key derivation).
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
// SHA-256 → lowercase hex. Accepts a string (utf8) or a Buffer (raw bytes).
const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

// --- SigV4 building blocks ---------------------------------------------------
// Derive the scoped signing key: HMAC chain over date → region → service → terminator.
function signingKey(secret, date, region, service) {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

// Build the canonical request string + the signed-headers list. `uri` must already
// be the canonical (percent-encoded) path; `headers` keys are lowercased, values
// trimmed and inner whitespace collapsed, then sorted by name.
function canonicalRequest({ method, uri, query = '', headers, payloadHash }) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  }
  const names = Object.keys(lower).sort();
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [method, uri, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  return { canonical, signedHeaders };
}

// The string-to-sign wraps the hash of the canonical request with the algorithm,
// timestamp, and credential scope.
function stringToSign({ amzDate, scope, canonicalReq }) {
  return ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalReq)].join('\n');
}

// RFC-3986 percent-encode each path segment, preserving the separators. Our keys
// only contain [a-z0-9._/-] so this is effectively identity, but we encode anyway
// so the signature stays correct if a key ever carries something exotic.
const encodePath = (p) =>
  p
    .split('/')
    .map((seg) =>
      encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    )
    .join('/');

// --- Config ------------------------------------------------------------------
const REGION = 'auto'; // R2 ignores region but SigV4 needs a value
const SERVICE = 's3';

function env() {
  return {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKey: process.env.R2_ACCESS_KEY_ID || '',
    secretKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.R2_BUCKET || '',
    publicBase: (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  };
}

// True only when every R2_* var is present — the upload endpoint 503s otherwise.
function r2Configured() {
  const e = env();
  return !!(e.accountId && e.accessKey && e.secretKey && e.bucket && e.publicBase);
}

// --- Public PUT --------------------------------------------------------------
// Sign + PUT `body` to R2 at `key`; resolves { url, status } on 2xx, rejects with
// the status + body otherwise (or on a network error). `body` may be a Buffer or
// string; it's buffered in full so we can hash + length it (matches our upload cap).
function putObject({ key, body, contentType }) {
  return new Promise((resolve, reject) => {
    const cfg = env();
    if (!r2Configured()) return reject(new Error('R2 not configured'));

    const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
    const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const payloadHash = sha256hex(bodyBuf);

    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
    const date = amzDate.slice(0, 8);
    const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
    const uri = encodePath(`/${cfg.bucket}/${key}`);

    const headers = {
      host,
      'content-type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const { canonical, signedHeaders } = canonicalRequest({ method: 'PUT', uri, headers, payloadHash });
    const sts = stringToSign({ amzDate, scope, canonicalReq: canonical });
    const signature = hmac(signingKey(cfg.secretKey, date, REGION, SERVICE), sts).toString('hex');
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const req = https.request(
      {
        method: 'PUT',
        host,
        path: uri,
        headers: {
          Authorization: authorization,
          'X-Amz-Date': amzDate,
          'X-Amz-Content-Sha256': payloadHash,
          'Content-Type': contentType,
          'Content-Length': bodyBuf.length,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ url: `${cfg.publicBase}/${key}`, status: res.statusCode });
          } else {
            reject(new Error(`R2 PUT ${res.statusCode}: ${data.slice(0, 500)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

module.exports = {
  putObject,
  r2Configured,
  // Signing internals — exported for the offline test vector.
  hmac,
  sha256hex,
  signingKey,
  canonicalRequest,
  stringToSign,
  encodePath,
};
