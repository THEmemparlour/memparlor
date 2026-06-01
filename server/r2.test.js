#!/usr/bin/env node
/* ==========================================================================
   Tests for server/r2.js — proves the hand-rolled SigV4 math, then (only when
   real R2 credentials are present in the env) does a live PUT smoke test.

   Run: `npm run test:r2`.  Offline by default; set the R2_* vars to also run
   the live check.  No test framework — Node's assert + a tiny runner.
   ========================================================================== */

'use strict';

const assert = require('node:assert');
const https = require('node:https');
const r2 = require('./r2');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}

// --- 1) Offline: AWS published SigV4 test vector (`get-vanilla`) -------------
// From the AWS Signature Version 4 test suite. Reproducing this exact signature
// proves canonical-request → string-to-sign → signing-key → signature end to end,
// with no network and no credentials.
test('SigV4 reproduces the AWS get-vanilla test vector', () => {
  const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'; // exact key from the AWS test suite
  const amzDate = '20150830T123600Z';
  const scope = '20150830/us-east-1/service/aws4_request';

  const payloadHash = r2.sha256hex(''); // empty body
  assert.strictEqual(payloadHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  const { canonical, signedHeaders } = r2.canonicalRequest({
    method: 'GET',
    uri: '/',
    query: '',
    headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': amzDate },
    payloadHash,
  });
  assert.strictEqual(signedHeaders, 'host;x-amz-date');

  const sts = r2.stringToSign({ amzDate, scope, canonicalReq: canonical });
  const key = r2.signingKey(SECRET, '20150830', 'us-east-1', 'service');
  const signature = r2.hmac(key, sts).toString('hex');

  assert.strictEqual(signature, '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
});

// --- 2) Offline: path encoding preserves separators --------------------------
test('encodePath preserves slashes and encodes the rest', () => {
  assert.strictEqual(r2.encodePath('/bucket/media/home/123-a b.jpg'), '/bucket/media/home/123-a%20b.jpg');
  assert.strictEqual(r2.encodePath('/bucket/media/about/file.mp4'), '/bucket/media/about/file.mp4');
});

// --- 3) Live (env-gated): real PUT + public fetch ----------------------------
function fetchStatus(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        res.resume(); // drain
        resolve(res.statusCode);
      })
      .on('error', reject);
  });
}

(async () => {
  if (!r2.r2Configured()) {
    console.log('  skip  live R2 PUT smoke test (R2_* env not set)');
  } else {
    const key = `media/__test__/${Date.now()}-r2-smoke.txt`;
    const body = Buffer.from(`r2 smoke test ${new Date().toISOString()}\n`);
    try {
      const { url, status } = await r2.putObject({ key, body, contentType: 'text/plain' });
      assert.ok(status >= 200 && status < 300, `PUT status ${status}`);
      const getStatus = await fetchStatus(url);
      assert.ok(getStatus >= 200 && getStatus < 300, `public GET ${url} → ${getStatus}`);
      console.log(`  ok  live R2 PUT + public fetch (${url})`);
    } catch (err) {
      failures++;
      console.error(`FAIL  live R2 PUT smoke test\n      ${err.message}`);
    }
  }

  if (failures) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll r2 tests passed.');
})();
