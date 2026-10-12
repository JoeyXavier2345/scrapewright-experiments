// extension/test/two-hundred-thirty-sixth-log.test.js
//
// 236th log (session rs-1791779529734-1, build 234, user report: popovers
// worked at turn 24 but See-more never expanded and the extraction fell
// short). Root cause adjudicated against the log: the seeMoreUnexpanded
// detector FIRED in the green verify — 6/6 records carried "See more"
// tails — but it is REPORT-ONLY, so the model shipped green v3 with every
// content truncated while the user's requirement clause 3 explicitly
// demands 点击展开链接，加载出完整的帖子正文内容. The gate SAW the violation
// and could not veto; the model also never bound likeCount/commentCount/
// shareCount (disclosed optional-empty) — the hover layer itself worked
// (10/25 popovers captured, time+author cards observed on the page).
//
//   A. REQUIREMENT_EXPAND_DROPPED: detector fired + requirement carries
//      expand intent + no click step in the artifact → RED with the
//      $clickInList textFilter exit.
//   B. A click step present (attempted expansion) keeps the lane
//      report-only.
//   C. No requirementText (legacy callers) keeps the lane report-only.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createVerifyRunner } = require('../lib/verify-runner');

const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
  type: 'object', required: ['content'], properties: { content: { type: 'string' } } } } } };

const TRUNCATED = [
  { content: 'California Road Trip Seq… See more' },
  { content: 'THIS ONE HAS A LITTLE BIT OF EVERYTHING!I… See more' },
  { content: 'Take the trip! Yo… See more' },
  { content: '25 State Summer! I solo traveled… See more' },
  { content: 'My son and I first trip abroad… See more' },
  { content: 'Why wait for another thought… See more' }
];

const REQ = '从主工作区的信息流中提取帖子。帖子正文中若有"展开"操作，点击展开链接，加载出完整的帖子正文内容。';

function makeRunner(steps, sessionEvidence) {
  const runner = createVerifyRunner({
    ensureLock: async () => {}, releaseLock: async () => {},
    createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
    sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true,
    getSignal: () => null, log: () => {}, onEvent: () => {},
    orchestrate: async (svc, input, d, opts) => {
      await d.createTab(svc.targetUrl);
      opts.onEvent({ type: 'EXECUTION_START' });
      return { finalResult: { posts: TRUNCATED }, steps: [], pages: [], pagesTruncated: false };
    }
  });
  return runner({ service: { targetUrl: 'https://e.com', steps, config: {} }, input: { count: 6 }, outputSchema: SCHEMA, sessionEvidence });
}

const NO_CLICK = [{ id: 's1', name: 's', script: 'const rs=await $extractWithHover(sel,{}); return {posts:rs};', onSuccess: 'TERMINATE' }];
const WITH_CLICK = [
  { id: 'expand', name: 'e', script: "await $clickInList(sel,'div[role=button]',{textFilter:'See more'}); return {done:true};", onSuccess: 's1' },
  { id: 's1', name: 's', script: 'const rs=await $extractWithHover(sel,{}); return {posts:rs};', onSuccess: 'TERMINATE' }
];

describe('236th round — REQUIREMENT_EXPAND_DROPPED', () => {
  it('A: detector + expand-intent requirement + no click step → RED with the textFilter exit', async () => {
    const out = await makeRunner(NO_CLICK, { requirementText: REQ });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /REQUIREMENT_EXPAND_DROPPED/);
    assert.match(out.report.error.message, /6 record\(s\)/);
    assert.match(out.report.error.message, /NO step in the artifact clicks anything/);
    assert.match(out.report.error.message, /\$clickInList\(containerSel/);
    assert.ok(out.report.detectors.seeMoreUnexpanded, 'the census still rides the report');
  });
  it('B: a click step present keeps the lane report-only (expansion was attempted)', async () => {
    const out = await makeRunner(WITH_CLICK, { requirementText: REQ });
    assert.equal(out.report.ok, true, 'green with the operation attempted: ' + JSON.stringify(out.report.error || {}));
    assert.ok(out.report.detectors.seeMoreUnexpanded, 'report-only census still attached');
  });
  it('C: no requirementText keeps the lane report-only (legacy callers)', async () => {
    const out = await makeRunner(NO_CLICK, {});
    assert.equal(out.report.ok, true);
    assert.ok(out.report.detectors.seeMoreUnexpanded);
  });
  it('the requirement text rides sessionEvidence from the engine state (source pin)', () => {
    const fs = require('node:fs');
    const st = fs.readFileSync(require('path').join(__dirname, '..', 'lib', 'session-tools.js'), 'utf8');
    const i = st.indexOf('requirementText: (() => {');
    assert.ok(i > -1, 'the passthrough exists');
    const region = st.slice(i, i + 500);
    assert.match(region, /requirement/, 'reads the session requirement');
  });
});
