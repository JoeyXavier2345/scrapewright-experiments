// extension/test/batch-turns.test.js
//
// Batch probe turns (2026-10-13 session-memory spec §4, plan Task 4): the
// turn protocol gains a third action shape — "tools":[{tool,args}×1-5] —
// that dispatches READ-ONLY probes sequentially inside ONE turn (N probes,
// one LLM round-trip, ONE transcript entry, ONE toolTimings row, +1 turn).
// Violations are ATOMIC teaching receipts: nothing executes, not even the
// legal members. Single-tool turns must be byte-for-byte unchanged.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createResearchSession } = require('../lib/research-session');
const Protocol = require('../lib/session-protocol');

const mk = (content) => ({ content, finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1 } });
const fin = () => mk(JSON.stringify({ think: 'done', finish: { summary: 'x' } }));
const member = (tool, args) => ({ tool: tool, args: args || {} });
const batchReply = (members) => mk(JSON.stringify({ think: 't', tools: members }));

function makeSession(replies, stubs, events) {
  const calls = [];
  const tools = {};
  for (const name of Object.keys(stubs || {})) {
    tools[name] = async (args) => {
      const rec = { tool: name, args: args };
      calls.push(rec);
      rec.result = await stubs[name](args);
      return rec.result;
    };
  }
  let i = 0;
  const session = createResearchSession({
    requirement: 'collect posts',
    llm: async () => { const r = replies[Math.min(i, replies.length - 1)]; i += 1; return r; },
    tools: tools,
    onEvent: (e) => { if (events) events.push(e); }
  });
  return { session: session, calls: calls };
}

function toolEntries(session) {
  return session.state().session.transcript.filter((e) => e.kind === 'tool');
}

describe('batch turns — protocol shape (parseAssistantTurn)', () => {
  it('normalizes a tools array; tool+tools stays parseable for the engine teaching receipt', () => {
    const r = Protocol.parseAssistantTurn(
      '{"think":"t","tools":[{"tool":"probe.count","args":{"sel":"div"}},{"tool":"page.settle"}]}');
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.turn.tool, null);
    assert.deepEqual(r.turn.tools, [
      { tool: 'probe.count', args: { sel: 'div' } },
      { tool: 'page.settle', args: {} }
    ]);
    const both = Protocol.parseAssistantTurn(
      '{"think":"t","tool":"probe.count","args":{},"tools":[{"tool":"page.settle"}]}');
    assert.ok(both.ok, 'tool+tools is an ENGINE-level teaching rejection, not a protocol violation');
    assert.equal(both.turn.tool, 'probe.count');
    assert.ok(Array.isArray(both.turn.tools));
  });

  it('tools+finish is ambiguous-action; garbage tools without another action is missing-action', () => {
    const amb = Protocol.parseAssistantTurn('{"think":"t","tools":[{"tool":"page.settle"}],"finish":{"summary":"x"}}');
    assert.ok(!amb.ok);
    assert.equal(amb.violation, 'ambiguous-action');
    const none = Protocol.parseAssistantTurn('{"think":"t","tools":"probe.count"}');
    assert.ok(!none.ok);
    assert.equal(none.violation, 'missing-action');
  });
});

describe('batch turns — dispatch', () => {
  it('a legal 2-member batch dispatches both in order as ONE turn', async () => {
    const { session, calls } = makeSession(
      [batchReply([member('probe.count', { sel: 'div' }), member('page.settle')]), fin()],
      {
        'probe.count': async () => ({ count: 8 }),
        'page.settle': async () => ({ settled: true, chars: 120 })
      }
    );
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    assert.deepEqual(calls.map((c) => c.tool), ['probe.count', 'page.settle'], 'both members dispatched in order');
    const entries = toolEntries(session);
    assert.equal(entries.length, 1, 'ONE transcript tool entry');
    assert.equal(entries[0].name, 'batch');
    assert.deepEqual(entries[0].result.batch, [{ count: 8 }, { settled: true, chars: 120 }],
      "the turn's result is {batch:[…]} in member order");
    assert.deepEqual(entries[0].results, [{ count: 8 }, { settled: true, chars: 120 }],
      'the entry carries results[] (spec §4.3 transcript shape)');
    assert.equal(entries[0].ok, true);
    // batch turn + finish turn — the batch itself consumed exactly ONE turn
    assert.equal(session.state().session.spend.turns, 2);
    const timings = session.timings.toolTimingEntries();
    const batchRow = timings.find((t) => t.tool === 'batch');
    assert.ok(batchRow, 'one toolTimings row named batch');
    assert.equal(batchRow.calls, 1);
    assert.ok(!timings.some((t) => t.tool === 'probe.count'), 'members are not timed as their own rows');
  });

  it('atomic: a batch containing verify.run executes NOTHING and receipts the rejection', async () => {
    const { session, calls } = makeSession(
      [batchReply([member('probe.count', { sel: 'div' }), member('verify.run')]), fin()],
      { 'probe.count': async () => ({ count: 8 }) }
    );
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    assert.equal(calls.length, 0, 'NOTHING executed — not even the legal first member');
    const entries = toolEntries(session);
    assert.equal(entries.length, 1);
    assert.match(entries[0].result.error, /^batch rejected: only read-only probes may batch — resend as single calls$/);
    assert.deepEqual(entries[0].result.rejected, ['verify.run']);
    assert.equal(entries[0].ok, false);
  });

  it('over-limit (6 members) rejects atomically with the count', async () => {
    const six = [0, 1, 2, 3, 4, 5].map(() => member('probe.count', { sel: 'div' }));
    const { session, calls } = makeSession(
      [batchReply(six), fin()],
      { 'probe.count': async () => ({ count: 1 }) }
    );
    await session.run();
    assert.equal(calls.length, 0);
    const entry = toolEntries(session)[0];
    assert.match(entry.result.error, /^batch rejected: 2-5 tools per turn \(got 6\) — split the batch$/);
  });

  it('mutual exclusion: tool + tools is a teaching rejection, nothing runs', async () => {
    const both = mk(JSON.stringify({
      think: 't', tool: 'probe.count', args: { sel: 'div' }, tools: [member('page.settle')]
    }));
    const { session, calls } = makeSession([both, fin()], {
      'probe.count': async () => ({ count: 1 }),
      'page.settle': async () => ({ settled: true })
    });
    await session.run();
    assert.equal(calls.length, 0, 'neither the single tool nor the batch member ran');
    const entry = toolEntries(session)[0];
    assert.match(entry.result.error,
      /^batch rejected: send either "tool" or "tools", not both — resend as a single call or a clean batch$/);
  });

  it('a malformed member (missing tool string) joins the same atomic rejection family', async () => {
    const raw = mk('{"think":"t","tools":[{"args":{"sel":"div"}},{"tool":"page.settle"}]}');
    const { session, calls } = makeSession([raw, fin()], {
      'page.settle': async () => ({ settled: true })
    });
    await session.run();
    assert.equal(calls.length, 0);
    const entry = toolEntries(session)[0];
    assert.match(entry.result.error, /^batch rejected: only read-only probes may batch — resend as single calls$/);
    assert.deepEqual(entry.result.rejected, ['(missing tool name)']);
  });

  it("a member's error does not stop later members", async () => {
    const { session, calls } = makeSession(
      [batchReply([member('probe.count', { sel: 'div.x' }), member('probe.text', { sel: 'p' })]), fin()],
      {
        'probe.count': async () => ({ error: 'ELEMENT_NOT_FOUND: div.x' }),
        'probe.text': async () => ({ total: 2, items: ['a', 'b'] })
      }
    );
    await session.run();
    assert.deepEqual(calls.map((c) => c.tool), ['probe.count', 'probe.text'], 'the later member still ran');
    const entry = toolEntries(session)[0];
    assert.match(entry.result.batch[0].error, /ELEMENT_NOT_FOUND/);
    assert.deepEqual(entry.result.batch[1], { total: 2, items: ['a', 'b'] });
    assert.equal(entry.ok, false, 'a failing member marks the batch entry not-ok');
  });

  it('repeated-failure trackers are fed per member (identical failing snippet across two batches fires the nudge)', async () => {
    const stubs = {
      'probe.count': async () => ({ error: 'ELEMENT_NOT_FOUND: nope' }),
      'probe.snippet': async () => ({ error: 'ELEMENT_NOT_FOUND: boom' })
    };
    const b1 = batchReply([member('probe.count', { sel: 'a' }), member('probe.snippet', { code: 'return 1;' })]);
    const b2 = batchReply([member('probe.count', { sel: 'a' }), member('probe.snippet', { code: 'return 1;' })]);
    const { session } = makeSession([b1, b2, fin()], stubs);
    await session.run();
    const notes = session.state().session.transcript.filter((e) => e.kind === 'system').map((e) => e.text);
    assert.ok(
      notes.some((t) => /REPEATED IDENTICAL FAILURE: probe\.snippet/.test(t)),
      'the 68th-round nudge fires from inside batches — got notes: ' + JSON.stringify(notes)
    );
  });

  it('single-tool turns are completely unchanged', async () => {
    const { session, calls } = makeSession(
      [mk(JSON.stringify({ think: 't', tool: 'probe.count', args: { sel: 'div' } })), fin()],
      { 'probe.count': async () => ({ count: 3 }) }
    );
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    assert.deepEqual(calls.map((c) => c.tool), ['probe.count']);
    const entries = toolEntries(session);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, 'probe.count');
    assert.deepEqual(entries[0].result, { count: 3 }, 'the raw tool result — no batch envelope');
    assert.equal(session.state().session.spend.turns, 2);
    const timings = session.timings.toolTimingEntries();
    assert.ok(timings.some((t) => t.tool === 'probe.count'));
    assert.ok(!timings.some((t) => t.tool === 'batch'));
  });
});

describe('batch turns — prompt surface', () => {
  it('the tool catalog carries the one-sentence batch protocol within the 6500 budget', () => {
    const { createSessionTools } = require('../lib/session-tools');
    const t = createSessionTools({
      rail: { executeDsl: async () => ({}) },
      runVerify: async () => ({}),
      probeFactory: () => ({}),
      getDraftService: () => null,
      applyArtifact: async () => ({}),
      getTestInput: () => ({}),
      getOutputSchema: () => ({}),
      getSteps: () => []
    });
    const total = t.toolSpecs.reduce((a, s) => a + (s.args || '').length + (s.returns || '').length, 0);
    assert.ok(total <= 6500, 'toolSpec total ' + total + ' <= 6500');
    const batchLine = t.toolSpecs.find((s) => s.name === 'batch');
    assert.ok(batchLine, 'a catalog line documents the batch shape');
    assert.match(String(batchLine.args), /tools:\[\{tool,args\}×2-5\]/);
    assert.match(String(batchLine.returns), /READ-ONLY probes/);
    assert.match(String(batchLine.returns), /write\/park\/verify tools never batch/);
    assert.match(String(batchLine.returns), /rejected atomically/);
  });
});
