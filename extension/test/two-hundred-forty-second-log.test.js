// extension/test/two-hundred-forty-second-log.test.js
//
// 242nd log (user challenge on session rs-1791811561485-1): "我在操作需求里
// 明确说了'发帖账号为Ad（广告，没有发帖时间）'，为何还会悬浮Ad元素？这类
// 帖子应该在step 1就被过滤掉了啊。" — adjudicated from the v4 artifact: the
// collect step's candidate population was `a[href^="?__cft"]` (the tracking-
// blob fingerprint) and the extract read postTime from that anchor's label,
// shipping 'Ad','Ad','Ad' — the excluded class itself, SELECTED by the
// population filter. No gate connected the requirement's own exclusion
// vocabulary to the shipped values.
//
//   A. Exclusion clause with a Latin marker (Ad) + a field shipping exactly
//      that marker → RED REQUIREMENT_EXCLUSION_LEAKED with the
//      re-bind-to-organic + negation-form teaching.
//   B. No requirementText → no gate (legacy callers).
//   C. The marker appearing inside long content text does NOT fire
//      (near-exact short values only — prose is not a population leak).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createVerifyRunner } = require('../lib/verify-runner');

const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
  type: 'object', required: ['content', 'postTime'], properties: { content: { type: 'string' }, postTime: { type: 'string' }, author: { type: 'string' } } } } } };
const REQ = '从信息流中提取帖子dom对象，注意要剔除主页推荐、账号推荐、小组、广告推荐、发帖账号为Ad（广告，没有发帖时间）等非正常帖子条目。';

function makeRunner(records, sessionEvidence) {
  const runner = createVerifyRunner({
    ensureLock: async () => {}, releaseLock: async () => {},
    createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
    sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true,
    getSignal: () => null, log: () => {}, onEvent: () => {},
    orchestrate: async (svc, input, d, opts) => {
      await d.createTab(svc.targetUrl);
      opts.onEvent({ type: 'EXECUTION_START' });
      return { finalResult: { posts: records }, steps: [], pages: [], pagesTruncated: false };
    }
  });
  return runner({
    service: { targetUrl: 'https://e.com', steps: [{ id: 's1', name: 's', script: 'return {posts:__input__.posts};', onSuccess: 'TERMINATE' }], config: {} },
    input: { count: 3 }, outputSchema: SCHEMA, sessionEvidence
  });
}

const AD_POSTS = [
  { content: 'Get a FREE 132 Page Coastal Travel Guide', postTime: 'Ad', author: 'Coastal' },
  { content: 'In the next 24 hours a discount awaits', postTime: 'Ad', author: 'Deals' },
  { content: 'Sponsored story about travel gear', postTime: 'Ad', author: 'Gear' }
];
const CLEAN_POSTS = [
  { content: 'organic trip report number one', postTime: 'November 3, 2025', author: 'Marco' },
  { content: 'organic trip report number two', postTime: 'August 4, 2024', author: 'Marcia' },
  { content: 'organic trip report with the word Ad inside a long sentence about ads', postTime: 'October 1, 2026', author: 'Karla' }
];

describe('242nd round — REQUIREMENT_EXCLUSION_LEAKED', () => {
  it('A: the excluded marker ships AS a value → RED naming the inverted population filter', async () => {
    const out = await makeRunner(AD_POSTS, { requirementText: REQ });
    assert.equal(out.report.ok, false);
    const msg = out.report.error.message;
    assert.match(msg, /REQUIREMENT_EXCLUSION_LEAKED/);
    assert.match(msg, /posts\[\]\.postTime ships exactly "Ad"/);
    assert.match(msg, /SELECTED by the extraction, not filtered/);
    assert.match(msg, /negation form/);
  });
  it('B: no requirementText → no exclusion gate (legacy callers)', async () => {
    const out = await makeRunner(AD_POSTS, {});
    // other gates (TIME_SHAPE) may fire; the exclusion family must NOT
    assert.doesNotMatch(String(out.report.error && out.report.error.message || ''), /REQUIREMENT_EXCLUSION_LEAKED/);
  });
  it('C: the marker inside long prose does not fire (near-exact short values only)', async () => {
    const out = await makeRunner(CLEAN_POSTS, { requirementText: REQ });
    const msg = String(out.report.error && out.report.error.message || '');
    assert.doesNotMatch(msg, /REQUIREMENT_EXCLUSION_LEAKED/, 'prose mentions are not population leaks');
  });
});
