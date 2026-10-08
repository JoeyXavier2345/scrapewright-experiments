// extension/test/two-hundred-fifth-log.test.js
//
// 205th log (session rs-1791436358463-1, keyword coffee, maxTurns RAISED to
// 120, died on tokenCap at turn ~100): 100 LLM calls × avg 19,730 prompt
// tokens = the 2M cap, 98% input. Three harness gaps:
//   A. The turn budget was raised but the token cap was not — the token
//      wall hit first with NO advisory saying so (the token family fires on
//      absolute fractions; nothing PROJECTS turns-remaining × avg-cost
//      against tokens-remaining).
//   B. SIX consecutive verifies shipped 8/9 or 7/9 of the requested count
//      (one-record-short forever) with no loop-breaking note — the exits
//      (certified exhaustion / count renegotiation) exist in the error text
//      but the model kept assembly-tweaking.
//   C. The tokenCap stop detail offered "ship the last VERIFIED artifact"
//      as exit (b) — this session had ZERO green verifies; the exit was a
//      hollow pointer.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RS = require('../lib/research-session');

describe('A. tokenWallProjection — which wall hits first (205th log)', () => {
  const { tokenWallProjection } = RS;
  it('token wall first: remaining tokens cannot fund remaining turns', () => {
    const r = tokenWallProjection(
      { promptTokens: 1500000, completionTokens: 20000, turns: 60, llmCalls: 75 },
      { tokenCap: 2000000, maxTurns: 120 });
    assert.ok(r, 'projection fires');
    assert.equal(r.wallFirst, 'token');
    assert.ok(r.callsLeft < 60, 'fewer calls fit than turns remain: ' + JSON.stringify(r));
    assert.ok(r.callsLeft >= 1);
  });
  it('turn wall first: tokens comfortably outlast turns → null advisory (no noise)', () => {
    const r = tokenWallProjection(
      { promptTokens: 400000, completionTokens: 5000, turns: 30, llmCalls: 35 },
      { tokenCap: 2000000, maxTurns: 60 });
    assert.equal(r, null);
  });
  it('degenerate inputs (no calls / no cap) stay silent', () => {
    assert.equal(tokenWallProjection({ promptTokens: 0, completionTokens: 0, turns: 1, llmCalls: 0 }, { tokenCap: 1000000, maxTurns: 60 }), null);
    assert.equal(tokenWallProjection({ promptTokens: 500000, completionTokens: 0, turns: 10, llmCalls: 10 }, { tokenCap: 0, maxTurns: 60 }), null);
  });
  it('wired: the budget tick emits the token-wall-first advisory (source audit)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    assert.match(src, /tokenWallProjection/, 'helper exists');
    assert.match(src, /token-wall-first/, 'the advisory key fires');
  });
});

describe('B. trackNearMissShortfall — the one-record-short loop breaker (205th log)', () => {
  const { trackNearMissShortfall } = RS;
  const miss = (req, del, certified) => ({
    ok: false,
    error: { message: 'COUNT_SHORTFALL_SUPPLY: posts delivered ' + del + ' of ' + req + ' requested while this run matched 14 containers.' },
    detectors: { countShortfall: { requested: req, extracted: del, exhaustionCertified: !!certified } }
  });
  it('third consecutive within-one-record shortfall returns the loop-breaking note', () => {
    let st = null;
    st = trackNearMissShortfall(st, miss(9, 8));
    assert.equal(st.count, 1);
    assert.equal(st.note, null);
    st = trackNearMissShortfall(st, miss(9, 8));
    assert.equal(st.count, 2);
    assert.equal(st.note, null);
    st = trackNearMissShortfall(st, miss(9, 7));
    assert.ok(st.note, 'third near-miss fires the note');
    assert.match(st.note, /collectUntil|certif/i);
    assert.match(st.note, /io\.confirm/);
    assert.match(st.note, /assembly tweak/i);
  });
  it('a green verify or a non-shortfall error RESETS the streak', () => {
    let st = trackNearMissShortfall(null, miss(9, 8));
    st = trackNearMissShortfall(st, { ok: true, detectors: {} });
    assert.equal(st.count, 0, 'green resets');
    st = trackNearMissShortfall(st, miss(9, 8));
    st = trackNearMissShortfall(st, { ok: false, error: { message: 'JUNK_VALUES_REQUIRED: x' }, detectors: {} });
    assert.equal(st.count, 0, 'different error class resets');
  });
  it('a big miss (3+ short) is NOT the loop class — resets', () => {
    let st = trackNearMissShortfall(null, miss(9, 8));
    st = trackNearMissShortfall(st, miss(9, 6));
    assert.equal(st.count, 0);
  });
  it('the LIVE pattern (8/9, 8/9, 7/9, 8/9, 7/9...) fires the note — alternating one- and two-short must NOT reset', () => {
    let st = null;
    st = trackNearMissShortfall(st, miss(9, 8));
    st = trackNearMissShortfall(st, miss(9, 8));
    st = trackNearMissShortfall(st, miss(9, 7));
    assert.ok(st.note, 'the actual session pattern breaks on the third verify');
  });
  it('a CERTIFIED shortfall is already shippable-disclosed — no note', () => {
    let st = trackNearMissShortfall(null, miss(9, 8, true));
    st = trackNearMissShortfall(st, miss(9, 8, true));
    st = trackNearMissShortfall(st, miss(9, 8, true));
    assert.equal(st.note, null, 'certified exhaustion is an exit, not a loop');
  });
  it('wired: the verify post-processing consults the tracker (source audit)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    assert.match(src, /trackNearMissShortfall\(/);
  });
});

describe('C. tokenCap stop detail names the real exit set (205th log)', () => {
  const { buildTokenCapDetail } = RS;
  const spend = { promptTokens: 1973011, completionTokens: 31669, llmCalls: 100 };
  it('WITH a green artifact: the ship-the-verified exit stands', () => {
    const d = buildTokenCapDetail(spend, { tokenCap: 2000000 }, { lastVerifyOk: true, greenArtifactVersion: 6 });
    assert.match(d, /ship the last VERIFIED/);
  });
  it('NO green verify: exit (b) says so honestly instead of pointing at nothing', () => {
    const d = buildTokenCapDetail(spend, { tokenCap: 2000000 }, { lastVerifyOk: false, greenArtifactVersion: null });
    assert.match(d, /no version was ever verified/i);
    assert.match(d, /UNVERIFIED/i);
    assert.doesNotMatch(d, /ship the last VERIFIED artifact — the review banner/);
  });
  it('wired: the stop caller passes verify state (source audit)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    const i = src.indexOf('stop(\'tokenCap\', buildTokenCapDetail(');
    assert.ok(i > -1);
    assert.match(src.slice(i, i + 200), /lastVerifyOk|greenArtifactVersion/, 'verify state reaches the detail');
  });
});
