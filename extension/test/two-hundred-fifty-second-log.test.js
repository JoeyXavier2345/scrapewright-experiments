// extension/test/two-hundred-fifty-second-log.test.js
//
// 252nd round — two fixes from the joint-solver live-run evidence:
//
//   FIX A. WORKING-CONTAINER PROTECTION (verify-runner COUNT_SHORTFALL).
//     The model's propose artifact v1 was STRUCTURALLY WORKING (8
//     containers matched, 3 real posts extracted), but after the
//     COUNT_SHORTFALL red the model REWROTE the container with a
//     prior-family guess → 0 matches → session dead. The shortfall error
//     now opens with a STRUCTURAL SUCCESS sentence whenever the run's own
//     census proves containers matched AND real records were extracted —
//     teaching keep-the-container-VERBATIM before any branch diagnosis.
//     (Additive prefix: the existing supply/assembly branch text and the
//     170th identity census are unchanged behind it.)
//
// No site tokens.
const { test, describe, it } = require('node:test');
const assert = require('assert');

const VR = require('../lib/verify-runner');

const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object',
  required: ['postId', 'postTime', 'content'],
  properties: {
    postId: { type: 'string' }, postTime: { type: 'string' }, content: { type: 'string' }
  } } } } };

function mkRunner(orch) {
  return VR.createVerifyRunner({
    ensureLock: async () => {}, releaseLock: async () => {},
    createTab: async () => ({ id: 1 }), removeTab: async () => {},
    waitForTabLoad: async () => {}, sendMessage: async () => ({ pong: true }),
    executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }),
    evaluateCondition: async () => true, orchestrate: orch
  });
}

function runWith(posts, containerMatches) {
  const orch = async (svc, input, d, opts) => {
    await d.createTab(svc.targetUrl);
    opts.onEvent({ type: 'EXECUTION_START' });
    opts.onEvent({ type: 'STEP_ITERATION', stepId: 's1', iteration: 1, resultPreview: '{"done":true}',
      selectorDiagnostics: [{ containerMatches: containerMatches }] });
    return { finalResult: { posts }, steps: [], pages: [], pagesTruncated: false };
  };
  return mkRunner(orch)({ service: { targetUrl: 'https://e.com', steps: [{ id: 's1', name: 'x', script: 'return 1', onSuccess: 'TERMINATE' }], config: {} }, input: { count: 5 }, outputSchema: SCHEMA });
}

describe('252 A — working-container protection in the COUNT_SHORTFALL teaching', () => {
  it('containers matched AND records extracted → the error OPENS with the STRUCTURAL SUCCESS sentence naming both counts', async () => {
    const posts = [
      { postId: 'aaa111', postTime: 'November 3, 2025', content: 'c1' },
      { postId: 'bbb222', postTime: 'November 2, 2025', content: 'c2' },
      { postId: 'ccc333', postTime: 'November 1, 2025', content: 'c3' }
    ];
    const out = await runWith(posts, 8);
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /COUNT_SHORTFALL_(SUPPLY|ASSEMBLY)/);
    assert.ok(
      out.report.error.message.indexOf('STRUCTURAL SUCCESS: 8 containers matched and 3 real record(s) extracted') > -1,
      'the structural-success sentence leads with the measured counts'
    );
    assert.match(out.report.error.message, /Do NOT rewrite the container selector/, 'the container-rewrite prohibition is explicit');
    assert.match(out.report.error.message, /keep it VERBATIM/, 'keep-verbatim teaching present');
    // The sentence rides BEFORE the supply/assembly branch text (it is a
    // prefix, not an appendix — the model reads the head of the error).
    assert.ok(
      out.report.error.message.indexOf('STRUCTURAL SUCCESS') < out.report.error.message.indexOf(/The SUPPLY reading|The collection satisfied/.exec(out.report.error.message)[0]),
      'the sentence precedes the branch diagnosis'
    );
  });
  it('extracted === 0 → NO structural-success claim (a zero-extract run is the empty-extraction gate\'s domain, never "working")', async () => {
    const out = await runWith([], 8);
    assert.equal(out.report.ok, false);
    assert.ok(!String(out.report.error.message || '').includes('STRUCTURAL SUCCESS'),
      'a zero-record run never claims the container family works');
  });
});
