// extension/test/two-hundred-twenty-first-log.test.js
//
// 221st round (deep-dive on session rs-1791611731391-1, prompted by the
// user: "so many turns and still no usable result — analyze again"):
//
// The session reached GREEN v12 (07:11, delivered 6/6, location optional
// empty) — then kept patching for the green's report-only disclosures, went
// red (v13 bullet-content TRUE red, v14/v15 repeated-token FALSE reds on
// htmlSnippet — fixed in the 220th round), and finished by asserting
// {"shipRedArtifact":true,"summary":"...it is genuinely the better
// artifact: it delivers 5 real posts..."} — FIVE, one fewer than the green
// it was shipping over. The 143rd-round gate fired FINISH BLOCKED naming
// restoreVersion:12, but the (c) override is accepted as a naked
// self-assertion: nothing checks the claim against the receipts on both
// sides.
//
// Fix: the (c) override is EVIDENCE-CHECKED. When the green's verify and
// the current red's verify both carry a delivered count, an override
// shipping STRICTLY FEWER delivered items is rejected with the numbers —
// restore the green or fix forward. An override whose red delivers at
// least the green's count (or when either side lacks count receipts)
// still honors the explicit choice (the 143rd coverage must hold).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createResearchSession } = require('../lib/research-session');

function scriptedLlm(replies, calls) {
  let i = 0;
  return async (req) => {
    calls.push(req);
    const r = replies[Math.min(i, replies.length - 1)];
    i++;
    return r;
  };
}
function envelope(tool, args) {
  return { content: JSON.stringify({ think: 't', tool, args: args || {} }), finish_reason: 'stop', usage: { prompt_tokens: 100, completion_tokens: 10 } };
}
function finishEnvelope(summary, extra) {
  return { content: JSON.stringify({ think: 'done', finish: Object.assign({ summary: summary || 'done' }, extra || {}) }), finish_reason: 'stop', usage: { prompt_tokens: 100, completion_tokens: 10 } };
}

const SCHEMAS = {
  inputSchema: { type: 'object', properties: { k: { type: 'string' } } },
  outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } }
};
const STEP = (n) => ({ id: 's' + n, name: 'step' + n, onSuccess: 'TERMINATE', script: 'return ' + n + ';' });

function verifyResult(ok, delivered, requested) {
  return {
    events: [],
    report: {
      ok,
      error: ok ? null : { message: 'COUNT_SHORTFALL_SUPPLY: posts delivered ' + delivered + ' of ' + requested, stepId: null },
      detectors: { countShortfall: { field: 'posts', requested, extracted: delivered, ratio: delivered / requested, severe: delivered / requested < 0.5 } },
      score: { score: 1 }, finalResult: ok ? { posts: [{ a: 1 }] } : null
    },
    raw: {}
  };
}

function makeSession(replies, verifyResults) {
  let verifyIdx = 0;
  let draft = null;
  const { createSessionTools } = require('../lib/session-tools');
  const tools = createSessionTools({
    rail: { executeDsl: async () => ({}), pageState: async () => ({}), epoch: 0 },
    runVerify: async () => { const r = verifyResults[Math.min(verifyIdx, verifyResults.length - 1)]; verifyIdx += 1; return r; },
    probeFactory: () => ({ snippet: async () => ({ result: 'ok' }), count: async () => ({ count: 1 }) }),
    getDraftService: () => draft,
    applyArtifact: (a) => { draft = { steps: a.steps, targetUrl: 'https://example.com/?k={{k}}', config: {} }; },
    getTestInput: () => ({ k: 'ml' }),
    getOutputSchema: () => SCHEMAS.outputSchema,
    getSteps: () => (draft ? draft.steps : []),
    ioConfirmBridge: { request: (p) => Promise.resolve({ confirmed: true, testInput: p && p.testInput }) }
  }).tools;
  const calls = [];
  const session = createResearchSession({ requirement: 'collect posts', llm: scriptedLlm(replies, calls), tools, onEvent: () => {} });
  return { session, calls };
}

const CONFIRM = envelope('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 6 } }, SCHEMAS));

describe('221st round — shipRedArtifact override is evidence-checked', () => {
  it('the incident shape: green 6/6, red 5/6, override REJECTED with the receipt numbers; restore then finish passes', async () => {
    const { session } = makeSession([
      CONFIRM,
      envelope('service.update', { steps: [STEP(1)] }),
      envelope('verify.run', {}),                        // GREEN, delivered 6
      envelope('service.update', { steps: [STEP(2)] }),
      envelope('verify.run', {}),                        // RED, delivered 5
      finishEnvelope('genuinely the better artifact: 5 real posts', { shipRedArtifact: true }), // must be BLOCKED
      envelope('service.update', { restoreVersion: 1 }),
      finishEnvelope('shipping the restored green')
    ], [verifyResult(true, 6, 6), verifyResult(false, 5, 6)]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed', 'the restored finish completed');
    const sysNotes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text);
    const block = sysNotes.find((t) => /OVERRIDE REJECTED/.test(t));
    assert.ok(block, 'the override was rejected by receipts');
    assert.match(block, /delivered 6/);
    assert.match(block, /delivered 5/);
    assert.match(block, /restoreVersion:1/);
  });
  it('a GENUINELY better red (green 2/6, red 5/6) still honors the override', async () => {
    const { session } = makeSession([
      CONFIRM,
      envelope('service.update', { steps: [STEP(1)] }),
      envelope('verify.run', {}),                        // GREEN, delivered 2
      envelope('service.update', { steps: [STEP(2)] }),
      envelope('verify.run', {}),                        // RED, delivered 5 (better, red for another reason)
      finishEnvelope('the red delivers more', { shipRedArtifact: true })
    ], [verifyResult(true, 2, 6), verifyResult(false, 5, 6)]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    assert.match(String(report.stopped.detail || ''), /LAST VERIFY FAILED/);
    const sysNotes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text);
    assert.ok(!sysNotes.some((t) => /OVERRIDE REJECTED/.test(t)), 'no rejection — the receipts back the claim');
  });
  it('no count receipts on either side → the explicit override stands (143rd coverage)', async () => {
    const noFacts = (ok) => ({ events: [], report: { ok, error: ok ? null : { message: 'DUPLICATE_ENTITY_PAIRS: red' }, detectors: {}, score: { score: 1 } }, raw: {} });
    const { session } = makeSession([
      CONFIRM,
      envelope('service.update', { steps: [STEP(1)] }),
      envelope('verify.run', {}),
      envelope('service.update', { steps: [STEP(2)] }),
      envelope('verify.run', {}),
      finishEnvelope('deliberate red ship', { shipRedArtifact: true })
    ], [noFacts(true), noFacts(false)]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const sysNotes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text);
    assert.ok(!sysNotes.some((t) => /FINISH BLOCKED|OVERRIDE REJECTED/.test(t)), 'receipts cannot contradict — the choice is honored');
  });
});
