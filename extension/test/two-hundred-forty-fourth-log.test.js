// extension/test/two-hundred-forty-fourth-log.test.js
//
// 244th log (sessionlog2.log — the resumed rs-1791814850941-1 after the
// user's fix-request feedback). The user's own user.observe answer named
// the truth: "有正常的贴子，在后面一点，前面三条都是groups的推荐" — and the
// model's deep scroll DID surface 12 articles. But all three resumed
// verifies died FIELD_MATCH_ZERO: the extract processed 3 containers —
// exactly the leading group-recommendation modules the user said to skip
// — and the permalink field matched 0 of 3. The real posts (deeper,
// carrying the field's family) were never processed. The census taught
// two mechanisms (population divergence / own filtering) but not the
// third, decisive one: the sub-selector matches elements ELSEWHERE on
// the page — the container subset is wrong.
//
//   A. Source (both mirrors): a zero-in-containers field gets a bounded
//      page-wide count on its diagnostics row.
//   B. detectFieldMatchZero carries pageWideMatches through.
//   C. The verify census gains mechanism (c): CONTAINER SUBSET with the
//      page-wide evidence and the :has(<sub-selector>) rebinding order.
//   D. Without page-wide evidence the census text is unchanged.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WU = require('../lib/wizard-utils');
const { createVerifyRunner } = require('../lib/verify-runner');

describe('244th round — page-wide field cross-check (container-subset fingerprint)', () => {
  it('A: both mirrors compute the bounded page-wide count at source', () => {
    const cs = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    const ops = fs.readFileSync(path.join(__dirname, '..', 'lib', 'list-extract-ops.js'), 'utf8');
    for (const [name, src] of [['content-script', cs], ['list-extract-ops', ops]]) {
      assert.match(src, /244th log[\s\S]{0,700}pageWideMatches/, name + ' computes it');
      assert.match(src, /matchCount === 0 && subSelector/, name + ' only on zero-in-containers fields');
      assert.match(src, /> 50 \? 50 :/, name + ' bounded at 50');
    }
  });
  it('B: detectFieldMatchZero carries pageWideMatches (max over calls)', () => {
    const events = [
      { type: 'STEP_ITERATION', stepId: 'extract', selectorDiagnostics: [{ api: 'extractWithHover', containerMatches: 3, perField: [{ field: 'postUrl', subSelector: 'a[href*="/posts/"]', matchCount: 0, pageWideMatches: 7 }] }] },
      { type: 'STEP_ITERATION', stepId: 'extract', selectorDiagnostics: [{ api: 'extractWithHover', containerMatches: 3, perField: [{ field: 'postUrl', subSelector: 'a[href*="/posts/"]', matchCount: 0, pageWideMatches: 4 }] }] }
    ];
    const hits = WU.detectFieldMatchZero(events) || [];
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pageWideMatches, 7, 'max rides');
  });
  it('C: the census names mechanism (c) with the evidence and the :has() order', async () => {
    const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
      type: 'object', required: ['postUrl'], properties: { postUrl: { type: 'string' }, content: { type: 'string' } } } } } };
    const runner = createVerifyRunner({
      ensureLock: async () => {}, releaseLock: async () => {},
      createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
      sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
      captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true,
      getSignal: () => null, log: () => {}, onEvent: () => {},
      orchestrate: async (svc, input, d, opts) => {
        await d.createTab(svc.targetUrl);
        opts.onEvent({ type: 'EXECUTION_START' });
        opts.onEvent({ type: 'STEP_ITERATION', stepId: 'extract', selectorDiagnostics: [{ api: 'extractWithHover', containerMatches: 3, perField: [{ field: 'postUrl', subSelector: 'a[href*="/posts/"]', matchCount: 0, pageWideMatches: 7 }] }] });
        return { finalResult: { posts: [] }, steps: [], pages: [], pagesTruncated: false };
      }
    });
    const out = await runner({
      service: { targetUrl: 'https://e.com', steps: [{ id: 'extract', name: 'e', script: 'return 1;', onSuccess: 'TERMINATE' }], config: {} },
      input: { count: 6 }, outputSchema: SCHEMA, sessionEvidence: {}
    });
    assert.equal(out.report.ok, false);
    const msg = out.report.error.message;
    assert.match(msg, /FIELD_MATCH_ZERO/);
    assert.match(msg, /\(c\) CONTAINER SUBSET/);
    assert.match(msg, /matches 7 element\(s\) ELSEWHERE on this page/);
    assert.match(msg, /:has\(a\[href\*="\/posts\/"\]\)/);
    assert.match(msg, /requirement's own exclusion list applies/);
  });
  it('D: without page-wide evidence the census text stays on the two legacy mechanisms', async () => {
    const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
      type: 'object', required: ['postUrl'], properties: { postUrl: { type: 'string' } } } } } };
    const runner = createVerifyRunner({
      ensureLock: async () => {}, releaseLock: async () => {},
      createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
      sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
      captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true,
      getSignal: () => null, log: () => {}, onEvent: () => {},
      orchestrate: async (svc, input, d, opts) => {
        await d.createTab(svc.targetUrl);
        opts.onEvent({ type: 'EXECUTION_START' });
        opts.onEvent({ type: 'STEP_ITERATION', stepId: 'extract', selectorDiagnostics: [{ api: 'extractWithHover', containerMatches: 3, perField: [{ field: 'postUrl', subSelector: 'a[href*="/posts/"]', matchCount: 0 }] }] });
        return { finalResult: { posts: [] }, steps: [], pages: [], pagesTruncated: false };
      }
    });
    const out = await runner({
      service: { targetUrl: 'https://e.com', steps: [{ id: 'extract', name: 'e', script: 'return 1;', onSuccess: 'TERMINATE' }], config: {} },
      input: { count: 6 }, outputSchema: SCHEMA, sessionEvidence: {}
    });
    assert.equal(out.report.ok, false);
    assert.doesNotMatch(out.report.error.message, /CONTAINER SUBSET/, 'no page-wide evidence, no (c) line');
  });
});
