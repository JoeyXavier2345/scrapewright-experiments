// extension/test/two-hundred-seventh-log.test.js
//
// 207th log (session rs-1791511010473-1, coffee AGAIN, maxTurns 150,
// tokenCap 2M, 97 calls, 8 verifies 0 green, tokenCap death): the 205th
// machinery fired but missed in two ways this shape exposes —
//   A. tokenWallProjection used LIFETIME avg: at turn 24 the early avg was
//      small, the advisory said "126 calls left / 130 turns" (near-parity,
//      ignorable), while prompts GREW 5K→20K through the session and the
//      true remaining runway at 75% spend was ~10 calls. The projection
//      must use the RECENT (marginal) call cost — max(recent, lifetime).
//   B. The near-miss breaker needed 3 CONSECUTIVE near-misses; the live
//      pattern WANDERED (6/7, 4/7, id-error, 3/7, 5/7, dup-id, deadline,
//      dup-id) — every non-near outcome reset the streak and the note
//      never fired. The supply-ceiling signal must look at a WINDOW of
//      recent verifies, not consecutive ones.
//   C. The model DID take the renegotiation exit — and burned a 30-minute
//      user park re-proposing the contract with the SAME count=7 (it
//      dropped fields instead; the count was the binding constraint).
//      The user confirmed 7 unchanged and every later verify kept failing
//      short. io.confirm must WARN when the session is failing count-short
//      and the proposal keeps the failing count.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RS = require('../lib/research-session');

describe('A. tokenWallProjection uses the RECENT marginal cost (207th log)', () => {
  const { tokenWallProjection } = RS;
  it('lifetime-avg optimism is corrected: prompts grew, recent cost is the truth', () => {
    // 60 calls, 1.2M spent (lifetime avg 20K) — but the LAST 5 calls cost
    // 40K each (prompts grew). Remaining 800K funds ~20 calls by recent
    // cost, while lifetime says 40.
    const r = tokenWallProjection(
      { promptTokens: 1180000, completionTokens: 20000, turns: 60, llmCalls: 60, recentCallTokens: [41000, 39500, 40200, 40800, 40000] },
      { tokenCap: 2000000, maxTurns: 150 });
    assert.ok(r, 'fires');
    assert.equal(r.wallFirst, 'token');
    assert.ok(r.callsLeft <= 22, 'uses the RECENT cost (~40K/call → ~20 calls), got ' + r.callsLeft);
    assert.ok(r.callsLeft >= 15);
  });
  it('no recent history → lifetime avg (backward compatible)', () => {
    const r = tokenWallProjection(
      { promptTokens: 1500000, completionTokens: 20000, turns: 60, llmCalls: 75 },
      { tokenCap: 2000000, maxTurns: 120 });
    assert.ok(r && r.wallFirst === 'token');
  });
});

describe('B. supply-ceiling window — interleaved failures still count (207th log)', () => {
  const { trackNearMissShortfall } = RS;
  const miss = (req, del) => ({
    ok: false,
    error: { message: 'COUNT_SHORTFALL_SUPPLY: posts delivered ' + del + ' of ' + req },
    detectors: { countShortfall: { requested: req, extracted: del } }
  });
  const other = (msg) => ({ ok: false, error: { message: msg }, detectors: {} });

  it('the LIVE wandering pattern fires the ceiling note (3 shortfalls in the last 5 verifies)', () => {
    let st = null;
    st = trackNearMissShortfall(st, miss(7, 6));      // 1
    st = trackNearMissShortfall(st, miss(7, 4));      // 2
    st = trackNearMissShortfall(st, other('CAPTURED_VALUE_UNBOUND: x')); // interleave
    st = trackNearMissShortfall(st, miss(7, 3));      // 3rd shortfall in the window — FIRES here
    assert.ok(st.ceilingNote, 'window-based note fires despite interleaving');
    assert.match(st.ceilingNote, /SUPPLY CEILING/i);
    assert.match(st.ceilingNote, /6 of 7, 4 of 7, 3 of 7|6, ?4, ?3, ?5/i); // 230th: rendered as 'N of M' pairs
    assert.match(st.ceilingNote, /io\.confirm/);
    assert.match(st.ceilingNote, /collectUntil|certif/i);
  });
  it('2 shortfalls in the window stay silent (could still be converging)', () => {
    let st = null;
    st = trackNearMissShortfall(st, miss(7, 6));
    st = trackNearMissShortfall(st, other('JUNK_VALUES_REQUIRED: x'));
    st = trackNearMissShortfall(st, other('SANDBOX_DEADLINE: x'));
    st = trackNearMissShortfall(st, other('DUPLICATE_ID_REQUIRED: x'));
    st = trackNearMissShortfall(st, miss(7, 5));
    assert.ok(!st.ceilingNote);
  });
  it('fires ONCE — later windows do not repeat the note', () => {
    let st = null;
    for (let i = 0; i < 3; i++) st = trackNearMissShortfall(st, miss(7, 3)); // 4-short: ceiling class, not near-miss
    assert.ok(st.ceilingNote);
    st = trackNearMissShortfall(st, miss(7, 4));
    assert.ok(!st.ceilingNote, 'once per tracker (ceilingFired latches; the engine keeps the tracker alive across the session)');
  });
  it('wired: the engine pushes the ceiling note (source audit, wiring call site)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    assert.ok(src.includes('if (state.nearMissShortfall && state.nearMissShortfall.ceilingNote)'), 'wiring call site');
  });
});

describe('C. io.confirm warns when the failing COUNT is kept (207th log)', () => {
  const { createSessionTools } = require('../lib/session-tools');
  const CTX_BASE = { session: { state: () => ({ session: {}, countShortfall: 'requested 7 via the test input, extracted 5 into "posts" (severe) — exhaustion NOT certified' }) } };
  function makeDeps() {
    return {
      rail: { executeDsl: async () => ({ result: { ok: true }, selectorDiagnostics: [] }), pageState: async () => ({ open: true, tabId: 1 }), ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1 },
      runVerify: async () => ({ report: { ok: true, error: null, aborted: false, score: { score: 100, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [], detectors: {}, steps: [], finalResult: null, pages: '0', eventCount: 0, events: [] }, events: [], raw: {} }),
      getDraftService: () => null,
      applyArtifact: () => {},
      getTestInput: () => ({ keyword: 'coffee', count: 7 }),
      getOutputSchema: () => ({ type: 'object' }),
      getSteps: () => [],
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: () => ({ snippet: async () => ({ result: 'ok' }) })
    };
  }
  async function confirmWith(t, testInput) {
    return t.tools['io.confirm']({
      inputSchema: { type: 'object', required: ['keyword', 'count'], properties: { keyword: { type: 'string' }, count: { type: 'integer' } } },
      outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object', properties: { postId: { type: 'string' } } } } } },
      testInput
    }, CTX_BASE);
  }

  it('proposal keeps the FAILING count=7 → the receipt names the count as the binding constraint', async () => {
    const t = createSessionTools(makeDeps());
    const out = await confirmWith(t, { keyword: 'coffee', count: 7 });
    assert.equal(out.confirmed, true);
    assert.match(String(out.note), /COUNT IS THE BINDING CONSTRAINT|count.*binding/i, 'names it: ' + String(out.note).slice(0, 200));
    assert.match(String(out.note), /collectUntil|certif|lower the count/i);
  });
  it('a LOWER count proposal draws no such warning (the 132nd downgrade disclosure covers it)', async () => {
    const t = createSessionTools(makeDeps());
    const out = await confirmWith(t, { keyword: 'coffee', count: 5 });
    assert.equal(out.confirmed, true);
    assert.doesNotMatch(String(out.note), /BINDING CONSTRAINT/i);
  });
  it('wired: the engine records per-call token costs for the recent-avg projection (source audit)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    assert.match(src, /recentCallTokens/, 'the spend ring exists');
  });
});
