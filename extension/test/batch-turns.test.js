// extension/test/batch-turns.test.js
//
// Batch probe turns (2026-10-13 session-memory spec §4, plan Task 4): the
// turn protocol gains a third action shape — "tools":[{tool,args}×2-5
// (1 accepted as equivalent)] — that dispatches READ-ONLY probes
// sequentially inside ONE turn (N probes, one LLM round-trip, ONE
// transcript entry, ONE toolTimings row, +1 turn). Violations are ATOMIC
// teaching receipts: nothing executes, not even the legal members.
// Single-tool turns must be byte-for-byte unchanged.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createResearchSession } = require('../lib/research-session');
const Protocol = require('../lib/session-protocol');

const mk = (content) => ({ content, finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1 } });
const fin = () => mk(JSON.stringify({ think: 'done', finish: { summary: 'x' } }));
const member = (tool, args) => ({ tool: tool, args: args || {} });
const batchReply = (members) => mk(JSON.stringify({ think: 't', tools: members }));

function makeSession(replies, stubs, events, cfgExtra) {
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
  const session = createResearchSession(Object.assign({
    requirement: 'collect posts',
    llm: async () => { const r = replies[Math.min(i, replies.length - 1)]; i += 1; return r; },
    tools: tools,
    onEvent: (e) => { if (events) events.push(e); }
  }, cfgExtra || {}));
  return { session: session, calls: calls };
}

function systemTexts(session) {
  return session.state().session.transcript.filter((e) => e.kind === 'system').map((e) => e.text);
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

  it('tools+finish is ambiguous-action; a non-array "tools" parses through for the ENGINE batch teaching receipt', () => {
    const amb = Protocol.parseAssistantTurn('{"think":"t","tools":[{"tool":"page.settle"}],"finish":{"summary":"x"}}');
    assert.ok(!amb.ok);
    assert.equal(amb.violation, 'ambiguous-action');
    // Review fix: tools:"x" used to collapse to missing-action (generic
    // JSON lecture). It is a batch-SHAPE mistake — the protocol passes it
    // through as a malformed marker so the engine's batch branch can
    // answer with the batch teaching receipt.
    const none = Protocol.parseAssistantTurn('{"think":"t","tools":"probe.count"}');
    assert.ok(none.ok, 'parses OK — the engine teaches, no repair round — got ' + JSON.stringify(none).slice(0, 160));
    assert.equal(none.turn.tool, null);
    assert.equal(none.turn.tools, null);
    assert.equal(none.turn.toolsMalformed, true, 'the malformed marker routes it to the batch branch');
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
    assert.equal(entries[0].results, undefined,
      'no duplicate results[] key — result.batch already persists the array (review dedupe)');
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
    assert.match(entries[0].result.error, /^batch rejected: only whitelisted read-only probes may batch \(probe\.scroll excluded — use scrollUntil\) — resend as single calls$/);
    assert.deepEqual(entries[0].result.rejected, ['verify.run']);
    assert.equal(entries[0].ok, false);
  });

  it('empty batch (tools:[]) rejects atomically with the count teaching', async () => {
    // Review batch (#7): the 0-member boundary — the count branch's
    // '2-5 tools per turn (got 0)' receipt, nothing executed.
    const { session, calls } = makeSession(
      [batchReply([]), fin()],
      { 'probe.count': async () => ({ count: 1 }) }
    );
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    assert.equal(calls.length, 0, 'nothing executed');
    const entry = toolEntries(session)[0];
    assert.match(entry.result.error, /^batch rejected: 2-5 tools per turn \(got 0\) — split the batch$/);
    assert.equal(entry.ok, false);
  });

  it('a 1-member batch executes and returns {batch:[oneResult]} (current behavior pinned as the equivalent single call)', async () => {
    // Review batch (#7): 1 member passes the count branch (only 0 and >5
    // reject) — it dispatches inside the batch envelope. Pinned so a future
    // tightening must do it consciously, and the catalog's "(1 accepted as
    // equivalent)" wording stays honest.
    const { session, calls } = makeSession(
      [batchReply([member('probe.count', { sel: 'div' })]), fin()],
      { 'probe.count': async () => ({ count: 4 }) }
    );
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    assert.deepEqual(calls.map((c) => c.tool), ['probe.count'], 'the single member dispatched');
    const entries = toolEntries(session);
    assert.equal(entries.length, 1, 'ONE transcript tool entry');
    assert.equal(entries[0].name, 'batch');
    assert.deepEqual(entries[0].result.batch, [{ count: 4 }], 'the batch envelope wraps the one result');
    assert.deepEqual(entries[0].result.memberMs.length, 1, 'one member cost entry');
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
    assert.match(entry.result.error, /^batch rejected: only whitelisted read-only probes may batch \(probe\.scroll excluded — use scrollUntil\) — resend as single calls$/);
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

  it('non-array "tools" (tools:"probe.count") gets the batch teaching receipt, nothing executed', async () => {
    const raw = mk('{"think":"t","tools":"probe.count"}');
    const { session, calls } = makeSession([raw, fin()], {
      'probe.count': async () => ({ count: 1 })
    });
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed', 'the receipt is a turn result, not a protocol stop');
    assert.equal(calls.length, 0, 'nothing executed');
    const entries = toolEntries(session);
    assert.equal(entries.length, 1, 'ONE batch transcript entry');
    assert.equal(entries[0].name, 'batch');
    assert.equal(entries[0].result.error,
      'batch rejected: tools must be an array of {tool,args} objects — resend as single calls');
    assert.equal(entries[0].ok, false);
  });
});

describe('batch turns — member-scaled suspend floor (review fix)', () => {
  // The 148th-log floor (240s, injectable via toolSuspendFloorMs) is
  // single-dispatch calibrated. A 2-5 member batch of probe.snippet (90s
  // cap) / probe.scrollUntil (~2-3 min) members legitimately exceeds it in
  // aggregate — the excess was falsely booked as SYSTEM SUSPENSION CREDIT.
  // The batch branch scales the floor by member count.
  const sleepStub = (ms) => async () => { await new Promise((r) => setTimeout(r, ms)); return { ok: true }; };

  it('a 3-member batch whose TOTAL exceeds the single floor gets NO suspension credit (floor scales by member count)', async () => {
    // floor 50ms/member → scaled batch floor 150ms; each member sleeps 35ms
    // → total ~110-120ms: ABOVE the old single 50ms floor (the pre-fix bug
    // booked ~60ms as suspension), BELOW the scaled 150ms floor.
    const { session, calls } = makeSession(
      [batchReply([member('probe.count', { sel: 'a' }), member('probe.count', { sel: 'b' }), member('probe.count', { sel: 'c' })]), fin()],
      { 'probe.count': sleepStub(35) },
      null,
      { toolSuspendFloorMs: 50 }
    );
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    assert.equal(calls.length, 3, 'all three members dispatched');
    const notes = systemTexts(session);
    assert.ok(!notes.some((t) => /SYSTEM SUSPENSION CREDIT/.test(t)),
      'no suspension credit for a legal 3-member batch under the scaled floor — notes: ' + JSON.stringify(notes));
    assert.equal((report.spend.suspendCreditMs || 0), 0, 'no wall credit booked');
  });

  it('a batch beyond even the SCALED floor still credits back, naming the member-scaled allowance', async () => {
    // floor 50ms/member → scaled floor 150ms; each member sleeps 120ms →
    // total ~360ms, beyond 150ms: the credit fires AND the note discloses
    // the scaling (3-member batch / scaled by member count).
    const { session } = makeSession(
      [batchReply([member('probe.count', { sel: 'a' }), member('probe.count', { sel: 'b' }), member('probe.count', { sel: 'c' })]), fin()],
      { 'probe.count': sleepStub(120) },
      null,
      { toolSuspendFloorMs: 50, budgets: { maxTurns: 60, maxTokensPerCall: 8192, tokenCap: 2000000, wallClockMs: 60000 } }
    );
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const creditNote = systemTexts(session).find((t) => /SYSTEM SUSPENSION CREDIT/.test(t));
    assert.ok(creditNote, 'the credit fires beyond the scaled floor');
    assert.match(creditNote, /3-member batch/);
    assert.match(creditNote, /scaled by member count/);
    assert.ok(report.spend.suspendCreditMs >= 150, 'credit ≈ wall − scaled floor — got ' + report.spend.suspendCreditMs);
  });

  it('source audit: the batch branch scales TOOL_DISPATCH_SUSPEND_FLOOR_MS by member count (the single-dispatch site does not)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    const i = src.indexOf('the batch dispatch wall was');
    assert.ok(i > -1, 'batch credit site found');
    const region = src.slice(i - 1200, i + 400);
    assert.match(region, /TOOL_DISPATCH_SUSPEND_FLOOR_MS \*/, 'the floor is multiplied by a member count');
    assert.match(region, /memberCount|__memberCount/, 'a member count feeds the multiplier');
    // the single-dispatch site keeps the unscaled floor
    const j = src.indexOf("turn.tool + ' dispatch wall was");
    assert.ok(j > -1, 'single-dispatch credit site found');
    const single = src.slice(j - 500, j + 300);
    assert.ok(!/TOOL_DISPATCH_SUSPEND_FLOOR_MS \*/.test(single), 'single-dispatch floor unchanged');
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
    assert.match(String(batchLine.args), /tools:\[\{tool,args\}×2-5 \(1 accepted as equivalent\)\]/);
    assert.match(String(batchLine.returns), /read-only probes/i);
    assert.match(String(batchLine.returns), /probe\.\* except probe\.scroll/, 'the catalog names the deliberate probe.scroll exclusion');
    assert.match(String(batchLine.returns), /write\/park\/verify never batch/);
    assert.match(String(batchLine.returns), /rejected atomically/);
    // 254th review (#6): the line must say TURN SHAPE — a model reading it
    // as a tool spec put "batch" in the tool slot.
    assert.match(String(batchLine.args), /TURN SHAPE/i, 'the catalog marks batch as a turn-level shape, not a tool');
  });
});

// 254th review batch (#4 + #6 + #9 + #10): member-loop interrupt checks,
// the dispatchTool batch backstop, per-member scaled receipt caps, and the
// interaction-snippet guard.
describe('batch turns — 254th review hardening', () => {
  it('#4: abort between members — later members skipped, receipt names them', async () => {
    let sessionRef = null;
    const { session, calls } = makeSession(
      [batchReply([member('probe.count', { sel: 'div' }), member('page.settle'), member('probe.text', { sel: 'p' })]), fin()],
      {
        'probe.count': async () => { if (sessionRef) sessionRef.abort('test'); return { count: 1 }; },
        'page.settle': async () => ({ settled: true }),
        'probe.text': async () => ({ total: 2 })
      }
    );
    sessionRef = session;
    const report = await session.run();
    assert.equal(report.stopped.reason, 'aborted', 'the turn-top guard still owns the stop');
    assert.deepEqual(calls.map((c) => c.tool), ['probe.count'], 'members 2-3 never dispatched');
    const entry = toolEntries(session)[0];
    assert.equal(entry.result.interrupted, 'aborted');
    assert.deepEqual(entry.result.skipped, ['page.settle', 'probe.text'], 'the receipt names the skipped member tools');
    assert.equal(entry.result.batch.length, 1, 'only member 1 has a receipt');
    assert.equal(entry.result.memberMs.length, 1, 'memberMs stays aligned with the DISPATCHED members');
  });

  it('#4: wallClock between members — a member that exhausts the wall budget stops the loop', async () => {
    const sleep = (ms) => async () => { await new Promise((r) => setTimeout(r, ms)); return { ok: true }; };
    const { session, calls } = makeSession(
      [batchReply([member('probe.count', { sel: 'a' }), member('page.settle'), member('probe.text', { sel: 'p' })]), fin()],
      { 'probe.count': sleep(60), 'page.settle': sleep(10), 'probe.text': sleep(10) },
      null,
      { budgets: { wallClockMs: 50 } }
    );
    const report = await session.run();
    assert.equal(report.stopped.reason, 'wallClock', 'the turn-top wall guard owns the stop');
    assert.deepEqual(calls.map((c) => c.tool), ['probe.count'], 'member 1 alone burned the wall — members 2-3 skipped');
    const entry = toolEntries(session)[0];
    assert.equal(entry.result.interrupted, 'wallClock');
    assert.deepEqual(entry.result.skipped, ['page.settle', 'probe.text']);
  });

  it('#6: {"tool":"batch"} gets the TURN-LEVEL shape backstop, not unknown-tool', async () => {
    const raw = mk(JSON.stringify({ think: 't', tool: 'batch', args: { tools: [member('probe.count')] } }));
    const { session, calls } = makeSession([raw, fin()], {});
    await session.run();
    assert.equal(calls.length, 0);
    const entry = toolEntries(session)[0];
    assert.ok(entry && entry.name === 'batch', 'the dispatch is recorded under the attempted name');
    assert.equal(entry.result.error,
      'batch is a TURN-LEVEL shape, not a tool: send {"tools":[{tool,args},…]} at the top level of the turn JSON (2-5 read-only probes), exactly one of tool/tools/finish');
  });

  it('#6: the tools+finish ambiguous-action nudge names the "tools" batch shape', async () => {
    const both = mk(JSON.stringify({ think: 't', tools: [member('page.settle')], finish: { summary: 'x' } }));
    const { session } = makeSession([both, fin()], { 'page.settle': async () => ({ settled: true }) });
    await session.run();
    const nudge = systemTexts(session).find((t) => /PROTOCOL VIOLATION \(ambiguous-action/.test(t));
    assert.ok(nudge, 'the ambiguous-action repair nudge fired');
    assert.match(nudge, /"tools"/, 'the nudge teaches the tools batch as a legal single action');
  });

  it('#9: per-member receipt caps scale with batch size — every member keeps its key fields', async () => {
    const big = (i) => ({ total: i, note: 'x'.repeat(11000), marker: 'lane-' + i });
    const five = [0, 1, 2, 3, 4].map((i) => member('probe.census', { containerSel: 'div.c' + i }));
    const { session } = makeSession([batchReply(five), fin()], {
      'probe.census': async (a) => big(Number(String(a.containerSel).slice(-1)))
    });
    await session.run();
    const entry = toolEntries(session)[0];
    const s = entry.summary;
    // scaled total = 8000 + 4*2000 = 16000; per member min(12000, 3200) = 3200
    assert.ok(s.length <= 16000 + 400, 'summary within the scaled cap + label slack — got ' + s.length);
    for (let i = 0; i < 5; i++) {
      assert.ok(s.indexOf('"total":' + i) !== -1, 'member ' + i + ' keeps its decision key (total:' + i + ')');
      assert.ok(s.indexOf('lane-' + i) !== -1, 'member ' + i + ' keeps its marker field');
    }
    assert.match(s, /chars elided/, 'the oversized note discloses its elision per member');
    assert.ok(!/\[\+\d+ more items elided\]/.test(s), 'no member fully elided');
  });

  it('#10: a snippet member that mutates the page rejects the batch atomically, naming the op', async () => {
    const { session, calls } = makeSession(
      [batchReply([
        member('probe.count', { sel: 'div' }),
        member('probe.snippet', { code: 'await $click("button.go"); return 1;' })
      ]), fin()],
      { 'probe.count': async () => ({ count: 1 }), 'probe.snippet': async () => ({ ok: 1 }) }
    );
    await session.run();
    assert.equal(calls.length, 0, 'NOTHING executes — the read-only member included');
    const entry = toolEntries(session)[0];
    assert.equal(entry.result.error,
      'batch rejected: snippet member mutates the page ($click) — interaction snippets run as single calls so later members read an unmutated page; disclose order-dependence by running singly');
    assert.deepEqual(entry.result.mutatingOps, ['$click']);
    assert.equal(entry.ok, false);
  });

  it('#10: read-only snippet members still batch (the capability stays)', async () => {
    const { session, calls } = makeSession(
      [batchReply([
        member('probe.snippet', { code: 'return await $count("div.card");' }),
        member('page.settle')
      ]), fin()],
      {
        'probe.snippet': async () => ({ count: 7 }),
        'page.settle': async () => ({ settled: true })
      }
    );
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    assert.deepEqual(calls.map((c) => c.tool), ['probe.snippet', 'page.settle'], 'both members dispatched');
    const entry = toolEntries(session)[0];
    assert.ok(!entry.result.error, 'no rejection');
    // $clickInList must not false-positive on a bare $click pattern match
    assert.ok(!(entry.result.mutatingOps), 'no mutating ops flagged');
  });

  it('#10: $clickInList is detected as its own op (no $click/$clickInList confusion)', async () => {
    const { session, calls } = makeSession(
      [batchReply([member('probe.snippet', { code: 'await $clickInList("div.c", "button"); return 1;' })]), fin()],
      { 'probe.snippet': async () => ({ ok: 1 }) }
    );
    await session.run();
    assert.equal(calls.length, 0);
    const entry = toolEntries(session)[0];
    assert.deepEqual(entry.result.mutatingOps, ['$clickInList'], 'the FULL op name is flagged');
    assert.ok(entry.result.error.indexOf('$clickInList') !== -1);
  });
});

describe('254th — nudge arms on the live red classes', () => {
  it('COUNT_SHORTFALL and HOVER_ANCHORS_FAMILY_MISS reds arm the red→propose route', async () => {
    const { createResearchSession } = require('../lib/research-session');
    const mk = (c) => ({ content: c, finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const env = (t, a) => mk(JSON.stringify({ think: 't', tool: t, args: a || {} }));
    const SCHEMAS = { inputSchema: { type: 'object', properties: { k: { type: 'string' } } }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } };
    let draft = null;
    const { createSessionTools } = require('../lib/session-tools');
    const tools = createSessionTools({
      rail: { executeDsl: async () => ({}), pageState: async () => ({}), epoch: 0 },
      runVerify: async () => ({ events: [], report: { ok: false, error: { message: 'COUNT_SHORTFALL_SUPPLY: posts delivered 3 of 6' }, detectors: {} }, raw: {} }),
      probeFactory: () => ({ count: async () => ({ count: 5 }) }),
      getDraftService: () => draft, applyArtifact: (a) => { draft = { steps: a.steps, targetUrl: 'https://example.com/?k={{k}}', config: {} }; return Promise.resolve({ version: 1 }); },
      getTestInput: () => ({ k: 'ml' }), getOutputSchema: () => SCHEMAS.outputSchema, getSteps: () => (draft ? draft.steps : []),
      ioConfirmBridge: { request: (p) => Promise.resolve({ confirmed: true, testInput: p && p.testInput }) }
    }).tools;
    let i = 0;
    const session = createResearchSession({ requirement: 'collect posts', budgets: { maxTurns: 20 }, llm: async () => { const r = [env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)), env('service.update', { steps: [{ id: 's1', name: 's', script: 'return 1;', onSuccess: 'TERMINATE' }] }), env('verify.run', {}), env('probe.count', {}), mk(JSON.stringify({ think: 'done', finish: { summary: 'x' } }))][Math.min(i, 4)]; i += 1; return r; }, tools, onEvent: () => {} });
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const notes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text).filter((t) => /RED → artifact\.propose/.test(t));
    assert.equal(notes.length, 1, 'COUNT_SHORTFALL red armed the nudge');
  });
});

describe('255c — REQUIRED_FIELD_EMPTY arms the nudge; unfilled carries the renegotiation exit', () => {
  it('REQUIRED_FIELD_EMPTY red arms red→propose', async () => {
    const { createResearchSession } = require('../lib/research-session');
    const mk = (c) => ({ content: c, finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const env = (t, a) => mk(JSON.stringify({ think: 't', tool: t, args: a || {} }));
    const SCHEMAS = { inputSchema: { type: 'object', properties: { k: { type: 'string' } } }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } };
    let draft = null;
    const { createSessionTools } = require('../lib/session-tools');
    const tools = createSessionTools({
      rail: { executeDsl: async () => ({}), pageState: async () => ({}), epoch: 0 },
      runVerify: async () => ({ events: [], report: { ok: false, error: { message: 'REQUIRED_FIELD_EMPTY: posts.id is empty in 1/1 records' }, detectors: {} }, raw: {} }),
      probeFactory: () => ({ count: async () => ({ count: 5 }) }),
      getDraftService: () => draft, applyArtifact: (a) => { draft = { steps: a.steps, targetUrl: 'https://example.com/?k={{k}}', config: {} }; return Promise.resolve({ version: 1 }); },
      getTestInput: () => ({ k: 'ml' }), getOutputSchema: () => SCHEMAS.outputSchema, getSteps: () => (draft ? draft.steps : []),
      ioConfirmBridge: { request: (p) => Promise.resolve({ confirmed: true, testInput: p && p.testInput }) }
    }).tools;
    let i = 0;
    const session = createResearchSession({ requirement: 'collect posts', budgets: { maxTurns: 20 }, llm: async () => { const r = [env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)), env('service.update', { steps: [{ id: 's1', name: 's', script: 'return 1;', onSuccess: 'TERMINATE' }] }), env('verify.run', {}), env('probe.count', {}), mk(JSON.stringify({ think: 'done', finish: { summary: 'x' } }))][Math.min(i, 4)]; i += 1; return r; }, tools, onEvent: () => {} });
    await session.run();
    const notes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text).filter((t) => /RED → artifact\.propose/.test(t));
    assert.equal(notes.length, 1, 'REQUIRED_FIELD_EMPTY armed');
  });
  it('propose unfilled → next carries the io.confirm renegotiation exit', async () => {
    const AP = require('../lib/artifact-proposer');
    const census = { containerSel: '[role=article]', total: 6, sampled: [{}], lanes: { url: [{ selector: 'a[href*="/p/"]', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }], time: [], count: [], id: [], text: [{ selector: 'div.m', tag: 'div', strength: 'strong', coverage: '4/5', texts: ['b'] }] }, hrefIdentity: [{ token: 'query:id', coverage: '5/5', samples: ['a1', 'b2'] }] };
    const out = await AP.proposeArtifact({ probes: { count: async () => ({ count: 6 }), census: async () => census, sample: async () => ({}) }, requirementText: '滚动。悬浮窗。', outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object', required: ['postUrl'], properties: { postUrl: { type: 'string' }, postTime: { type: 'string' }, likeCount: { type: 'string' } } } } } }, currentArtifact: null });
    assert.match(out.next, /renegotiate via io\.confirm FIRST/);
  });
});
