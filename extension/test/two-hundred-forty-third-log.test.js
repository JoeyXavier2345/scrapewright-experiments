// extension/test/two-hundred-forty-third-log.test.js
//
// 243rd log (session rs-1791814850941-1, build 242): NO harness defect —
// the gates fired correctly (POLL_EXHAUSTED with pacing + frozen-count
// census on a genuinely-exhausted 5/6 feed; dry-run gate; FINALIZE nudge;
// chunked assembly), and the model behaved reasonably on a hostile SERP
// (raw-text degraded loads, permalinks collapsing 25→1). The session died
// at the user-persisted maxTurns=35 mid-fix — the THIRD consecutive
// death at that cap (239: "no turns left"; 241: exit (c) at 31/35; 243:
// patch applied as turn 35 expired, artifact left unverified). The
// engine default is 60; the user's knob overrides it.
//
// The one change: SURFACE the below-default budget at session start — a
// model-facing convergence-preserving note plus a budget_advisory line —
// so tight-budget sessions prioritize early renegotiation and batched
// fixes, and post-mortems can see the constraint. Never override.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createResearchSession } = require('../lib/research-session');

const mk = (content) => ({ content, finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1 } });
const env = (tool, args) => mk(JSON.stringify({ think: 't', tool, args: args || {} }));
const SCHEMAS = { inputSchema: { type: 'object', properties: { k: { type: 'string' } } }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } };

function makeSession(replies, budgets, events) {
  let draft = null;
  const { createSessionTools } = require('../lib/session-tools');
  const tools = createSessionTools({
    rail: { executeDsl: async () => ({}), pageState: async () => ({}), epoch: 0 },
    runVerify: async () => ({ events: [], report: { ok: true, detectors: {} }, raw: {} }),
    probeFactory: () => ({ snippet: async () => ({ result: 'ok' }) }),
    getDraftService: () => draft, applyArtifact: (a) => { draft = { steps: a.steps, targetUrl: 'https://example.com/?k={{k}}', config: {} }; },
    getTestInput: () => ({ k: 'ml' }), getOutputSchema: () => SCHEMAS.outputSchema, getSteps: () => (draft ? draft.steps : []),
    ioConfirmBridge: { request: (p) => Promise.resolve({ confirmed: true, testInput: p && p.testInput }) }
  }).tools;
  let i = 0;
  return createResearchSession({
    requirement: 'collect posts',
    budgets: budgets,
    llm: async () => { const r = replies[Math.min(i, replies.length - 1)]; i += 1; return r; },
    tools, onEvent: (e) => { if (events) events.push(e); }
  });
}

describe('243rd round — low-turn-budget surfaced at session start', () => {
  it('a below-default maxTurns emits the advisory + the model-facing note once', async () => {
    const events = [];
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('service.update', { steps: [{ id: 's1', name: 's', script: 'return 1;', onSuccess: 'TERMINATE' }] }),
      mk(JSON.stringify({ think: 'done', finish: { summary: 'x' } }))
    ], { maxTurns: 35 }, events);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const sysNotes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text);
    const notes = sysNotes.filter((t) => /TURN BUDGET: this session runs maxTurns=35/.test(t));
    assert.equal(notes.length, 1, 'exactly one start-time note');
    assert.match(notes[0], /below the engine default 60/);
    assert.match(notes[0], /renegotiate uncertain fields via io\.confirm EARLY/);
    assert.ok(events.some((e) => e && e.type === 'budget_advisory' && e.key === 'low-turn-budget'), 'the advisory line rides the log');
  });
  it('a default-or-higher budget stays silent', async () => {
    const events = [];
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('service.update', { steps: [{ id: 's1', name: 's', script: 'return 1;', onSuccess: 'TERMINATE' }] }),
      mk(JSON.stringify({ think: 'done', finish: { summary: 'x' } }))
    ], { maxTurns: 60 }, events);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const sysNotes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text);
    assert.ok(!sysNotes.some((t) => /TURN BUDGET: this session runs/.test(t)), 'no note at the default budget');
    assert.ok(!events.some((e) => e && e.type === 'budget_advisory' && e.key === 'low-turn-budget'));
  });
});
