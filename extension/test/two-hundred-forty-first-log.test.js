// extension/test/two-hundred-forty-first-log.test.js
//
// 241st log (session rs-1791811561485-1, build 240). The 239th mandate
// gate WORKED: the first finish was blocked and the model, turn-starved
// (its configured 35-turn budget), took exit (c) — an explicit best-effort
// ship with disclosures. But the shipped v4 carried postTime 'Ad','Ad','Ad'
// — a decoy read (the ad-account label where the time element lives, the
// 33rd-log family). Implausible (non-date) values are neither relative nor
// empty, so they rode through REQUIREMENT_TIME_SOURCE_DROPPED with only
// the report-only TIME_FIELD_IMPLAUSIBLE lane while the requirement's
// popover source was never bound. v1/v2 before it burned two verifies on
// an all-empty field census (permalink sub-selector matched 0 of 3/9 —
// the census taught, the model fixed by v3).
//
//   A. postTime='Ad' on a REQUIRED time field + popover-designated source
//      → RED REQUIREMENT_TIME_SOURCE_DROPPED naming the decoy read.
//   B. No requirementText keeps the lane report-only (legacy callers).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createVerifyRunner } = require('../lib/verify-runner');

const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
  type: 'object', required: ['content', 'postTime'], properties: { content: { type: 'string' }, postTime: { type: 'string' } } } } } };
const RECORDS = [1, 2, 3].map((n) => ({ content: 'A full body #' + n + ' ' + Math.random().toString(36).slice(2, 8), postTime: 'Ad' }));
const REQ = '悬浮窗的时间戳信息作为发帖时间，提取帖子正文。';

function makeRunner(sessionEvidence) {
  const runner = createVerifyRunner({
    ensureLock: async () => {}, releaseLock: async () => {},
    createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
    sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true,
    getSignal: () => null, log: () => {}, onEvent: () => {},
    orchestrate: async (svc, input, d, opts) => {
      await d.createTab(svc.targetUrl);
      opts.onEvent({ type: 'EXECUTION_START' });
      return { finalResult: { posts: RECORDS }, steps: [], pages: [], pagesTruncated: false };
    }
  });
  return runner({
    service: { targetUrl: 'https://e.com', steps: [{ id: 's1', name: 's', script: 'return {posts:__input__.posts};', onSuccess: 'TERMINATE' }], config: {} },
    input: { count: 3 }, outputSchema: SCHEMA, sessionEvidence
  });
}

describe('241st round — implausible time values join the requirement time-source gate', () => {
  it('A: postTime="Ad" (a decoy read) under a popover-designated source → BOTH gates ride one error', async () => {
    const out = await makeRunner({ requirementText: REQ });
    assert.equal(out.report.ok, false);
    const msg = out.report.error.message;
    // the 170th schema-driven shape gate names the decoy…
    assert.match(msg, /TIME_SHAPE_VIOLATION/);
    assert.match(msg, /"Ad"/);
    // …and the 241st requirement-family gate composes via ALSO RED (which
    // feeds the 239th one-shot finish block on REQUIREMENT_* reds)
    assert.match(msg, /ALSO RED — fix together/);
    assert.match(msg, /REQUIREMENT_TIME_SOURCE_DROPPED/);
    assert.match(msg, /NON-DATE values/);
    assert.match(msg, /decoy read on the wrong element/);
    assert.ok(out.report.detectors.implausibleTimeFields, 'the report-only census still rides');
  });
  it('B: no requirementText — the shape gate still reds the decoy; the REQUIREMENT_* framing stays out', async () => {
    const out = await makeRunner({});
    assert.equal(out.report.ok, false, 'the 170th shape gate is requirement-independent');
    const msg = out.report.error.message;
    assert.match(msg, /TIME_SHAPE_VIOLATION/);
    assert.doesNotMatch(msg, /REQUIREMENT_TIME_SOURCE_DROPPED/, 'the requirement family needs requirementText');
  });
  it('C: the shape gate composes when an earlier gate already set the error (the incident shape)', async () => {
    // REQUIREMENT_EXPAND_DROPPED (236) fires first on See-more tails; the
    // decoy gate must APPEND, not silently skip.
    const runner = createVerifyRunner({
      ensureLock: async () => {}, releaseLock: async () => {},
      createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
      sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
      captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true,
      getSignal: () => null, log: () => {}, onEvent: () => {},
      orchestrate: async (svc, input, d, opts) => {
        await d.createTab(svc.targetUrl);
        opts.onEvent({ type: 'EXECUTION_START' });
        return { finalResult: { posts: RECORDS.map((r) => Object.assign({}, r, { content: r.content + ' … See more' })) }, steps: [], pages: [], pagesTruncated: false };
      }
    });
    const out = await runner({
      service: { targetUrl: 'https://e.com', steps: [{ id: 's1', name: 's', script: 'return {posts:__input__.posts};', onSuccess: 'TERMINATE' }], config: {} },
      input: { count: 3 }, outputSchema: SCHEMA,
      sessionEvidence: { requirementText: '帖子正文中若有"展开"操作，点击展开加载完整正文。悬浮窗的时间戳作为发帖时间。' }
    });
    assert.equal(out.report.ok, false);
    const msg = out.report.error.message;
    assert.match(msg, /REQUIREMENT_EXPAND_DROPPED/);
    assert.match(msg, /TIME_SHAPE_VIOLATION/);
    assert.match(msg, /ALSO RED/);
  });
});
