// extension/test/two-hundred-thirty-ninth-log.test.js
//
// 239th log (session rs-1801805627028-1... actually rs-1791805627028-1,
// build 238 — live). The 236/237 teaching WORKED: v3 adopted the
// $clickInList see-more expand (tails gone) and bound likeCount from
// aria-labels (real '2K' values). But the anchor selection SWUNG from an
// over-broad union (30 anchors: 15 no-signal early-exits + 11 deadline
// deaths) to author-families-only ('h2 a, h3 a' — 6 anchors, 5 author
// cards captured): the TIME anchor was never hovered, so postTime shipped
// 4 relative + 1 full and REQUIREMENT_TIME_SOURCE_DROPPED stayed red —
// a red the model could not decode (its anchorSel excludes the fix). It
// finished after three reds asserting "页面上确实取不到" — contradicted by
// its own receipts (a MIXED population is capture failures, not page
// truth) — without ever asking the user via io.confirm.
//
//   A. Gate B anchor-blind branch: hovercards WERE captured but none
//      carries ANY date-shaped text (author cards only) + no quoted
//      absolute → the fix text names WHY: the anchorSel has no TIME
//      anchor family, and points at the anchor census.
//   B. Finish gate: a finish on a REQUIREMENT_* red with NO green
//      anywhere is blocked ONCE — exits: io.confirm renegotiation (the
//      USER drops the mandate, not the model), keep fixing, or finish
//      again (honored as best-effort with disclosures).
//   C. shipRedArtifact:true bypasses the 239 block (the explicit choice).
//   D. A non-REQUIREMENT red with no green still finishes disclosed (the
//      143rd no-green semantics preserved).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createVerifyRunner } = require('../lib/verify-runner');
const { createResearchSession } = require('../lib/research-session');

const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
  type: 'object', required: ['content'], properties: { content: { type: 'string' }, postTime: { type: 'string' } } } } } };
const REC = (over) => Object.assign({ content: 'A full body #' + Math.random().toString(36).slice(2, 8), postTime: 'November 3, 2025' }, over || {});
const RECORDS = [REC(), REC({ postTime: '2 days ago' }), REC({ postTime: 'August 4, 2024' }), REC({ postTime: '3 days ago' })];
const REQ_POPTIME = '悬浮窗的时间戳信息作为发帖时间，提取帖子正文。';

// Author-card-only hover captures: real hovercards, ZERO date-shaped text.
const AUTHOR_EVENTS = [{
  type: 'STEP_ITERATION', stepId: 's1',
  selectorDiagnostics: [{
    api: 'extractWithHover',
    hoverSummary: { hovercardsCaptured: 2 },
    capturedPopovers: { captured: 2, samples: ['Marco — digital creator', 'Travel photographer and guide'] }
  }]
}];

function makeRunner(steps, records, sessionEvidence, events) {
  const runner = createVerifyRunner({
    ensureLock: async () => {}, releaseLock: async () => {},
    createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
    sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true,
    getSignal: () => null, log: () => {}, onEvent: () => {},
    orchestrate: async (svc, input, d, opts) => {
      await d.createTab(svc.targetUrl);
      opts.onEvent({ type: 'EXECUTION_START' });
      for (const ev of (events || [])) opts.onEvent(ev);
      return { finalResult: { posts: records }, steps: [], pages: [], pagesTruncated: false };
    }
  });
  return runner({ service: { targetUrl: 'https://e.com', steps, config: {} }, input: { count: 4 }, outputSchema: SCHEMA, sessionEvidence });
}

const STEP = (script) => [{ id: 's1', name: 's', script, onSuccess: 'TERMINATE' }];
const EXTRACT = "const rs=await $extractWithHover('div.card',{content:{selector:'.msg'},postTime:{selector:'.ts'}});\nreturn {posts:rs};";

describe('239th round — anchor-blind Gate B teaching', () => {
  it('A: captured hovercards with no date-shaped text → the fix names the missing TIME-anchor family', async () => {
    const out = await makeRunner(STEP(EXTRACT), RECORDS, {
      requirementText: REQ_POPTIME,
      lastFullAbsolute: 'November 3, 2025'
    }, AUTHOR_EVENTS);
    assert.equal(out.report.ok, false);
    const msg = out.report.error.message;
    assert.match(msg, /REQUIREMENT_TIME_SOURCE_DROPPED/);
    assert.match(msg, /no TIME anchor at all/);
    assert.match(msg, /anchor census/);
    assert.match(msg, /descendant direction/);
    // the $timestamp exit stays (the census route is ADDITIVE teaching)
    assert.match(msg, /\$timestamp/);
  });
  it('no requirementText keeps the lane advisory (legacy callers)', async () => {
    const out = await makeRunner(STEP(EXTRACT), RECORDS, {}, AUTHOR_EVENTS);
    assert.equal(out.report.ok, true, JSON.stringify(out.report.error || {}));
  });
});

// ---- finish gate ----
function scriptedLlm(replies) {
  let i = 0;
  return async () => {
    const r = replies[Math.min(i, replies.length - 1)];
    i++;
    return { content: r, finish_reason: 'stop', usage: { prompt_tokens: 100, completion_tokens: 10 } };
  };
}
const env = (tool, args) => JSON.stringify({ think: 't', tool, args: args || {} });
const fin = (summary, extra) => JSON.stringify({ think: 'done', finish: Object.assign({ summary: summary || 'done' }, extra || {}) });
const SCHEMAS = { inputSchema: { type: 'object', properties: { k: { type: 'string' } } }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } };
const STEP1 = { id: 's1', name: 's', onSuccess: 'TERMINATE', script: 'return 1;' };

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
    getTestInput: () => ({ k: 'ml' }), getOutputSchema: () => SCHEMAS.outputSchema, getSteps: () => (draft ? draft.steps : []),
    ioConfirmBridge: { request: async (p) => ({ confirmed: true, testInput: p && p.testInput }) }
  }).tools;
  return createResearchSession({ requirement: 'collect posts with popover timestamps', llm: scriptedLlm(replies), tools, onEvent: () => {} });
}

const REQ_RED = { events: [], report: { ok: false, error: { message: 'REQUIREMENT_TIME_SOURCE_DROPPED: the requirement designates the hover-popover timestamp as the time source, but posts.postTime ships 4 relative record(s) while 1 carries FULL absolutes — capture failures, not page truth.' }, detectors: {} }, raw: {} };
const PLAIN_RED = { events: [], report: { ok: false, error: { message: 'DUPLICATE_ENTITY_PAIRS: red' }, detectors: {} }, raw: {} };

describe('239th round — finish blocked once on a REQUIREMENT-mandate red (no green)', () => {
  it('B: first finish blocked with the three exits; the second finish is honored disclosed', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('service.update', { steps: [STEP1] }),
      env('verify.run', {}),
      fin('页面上确实取不到，best-effort 出货'),
      fin('再次 finish，显式 best-effort')
    ], [REQ_RED]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const sysNotes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text);
    const blocks = sysNotes.filter((t) => /FINISH BLOCKED \(requirement mandate\)/.test(t));
    assert.equal(blocks.length, 1, 'blocked exactly once');
    assert.match(blocks[0], /io\.confirm/);
    assert.match(blocks[0], /capture failure/);
    assert.match(String(report.stopped.detail || ''), /LAST VERIFY FAILED/);
  });
  it('C: shipRedArtifact:true bypasses the 239 block (the explicit choice)', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('service.update', { steps: [STEP1] }),
      env('verify.run', {}),
      fin('deliberate red ship', { shipRedArtifact: true })
    ], [REQ_RED]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const sysNotes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text);
    assert.ok(!sysNotes.some((t) => /FINISH BLOCKED \(requirement mandate\)/.test(t)), 'the override bypasses');
  });
  it('D: a non-REQUIREMENT red with no green still finishes disclosed (143rd semantics intact)', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('service.update', { steps: [STEP1] }),
      env('verify.run', {}),
      fin('best effort, no green exists')
    ], [PLAIN_RED]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const sysNotes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text);
    assert.ok(!sysNotes.some((t) => /FINISH BLOCKED/.test(t)), 'no gate for a non-mandate red');
  });
});
