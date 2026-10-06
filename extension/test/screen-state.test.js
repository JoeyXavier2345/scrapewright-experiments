// 197th round (spec §1): the screen-state detector. Primary channel is
// chrome.idle (injected); fallback is multi-signal synthesis calibrated by
// the Oct-4/5 journal — the 01:55 lock cluster MUST classify locked, the
// 15:28 user-present cluster MUST classify active (popover_timeout alone is
// NOT lock evidence).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createScreenState } = require('../lib/screen-state.js');

describe('screen-state: API channel', () => {
  it('maps chrome.idle states with source api and confidence 1', async () => {
    const ss = createScreenState({ idle: { queryState: async () => 'locked' } });
    const r = await ss.getScreenState();
    assert.deepEqual(r, { state: 'locked', confidence: 1, source: 'api' });
  });
  it('active/idle pass through; api errors degrade to unknown, never throw', async () => {
    const ssA = createScreenState({ idle: { queryState: async () => 'active' } });
    assert.equal((await ssA.getScreenState()).state, 'active');
    const ssB = createScreenState({ idle: { queryState: async () => { throw new Error('denied'); } } });
    assert.equal((await ssB.getScreenState()).state, 'unknown');
  });
  it('unknown API state falls back to synthesis once', async () => {
    let n = 0;
    const ss = createScreenState({
      idle: { queryState: async () => { n++; return n === 1 ? 'unknown' : 'locked'; } },
      synthesis: () => ({ state: 'idle', confidence: 0.7 })
    });
    const r = await ss.getScreenState();
    assert.equal(r.state, 'idle');
    assert.equal(r.source, 'synthesis');
  });
});

describe('screen-state: synthesis channel (journal-calibrated)', () => {
  // The 01:55 lock signature from the journal: dense focus losses, a
  // dispatch-failure cluster, wall 6x median, no suspend credit.
  const lockWindow = { focusedFalseDensity: 0.9, consecutiveDispatchFailures: 5,
    wallOverMedian: 6, suspendCreditPresent: false };
  // The 15:28 user-present signature: timeouts present but focus held,
  // no cluster beyond normal variance.
  const presentWindow = { focusedFalseDensity: 0.2, consecutiveDispatchFailures: 2,
    wallOverMedian: 1.5, suspendCreditPresent: false };

  it('the lock window classifies locked (journal 01:55 cluster)', () => {
    const ss = createScreenState({ idle: null });
    const r = ss.synthesize(lockWindow);
    assert.equal(r.state, 'locked');
    assert.ok(r.confidence >= 0.75 && r.confidence <= 0.85);
    assert.equal(r.source, 'synthesis');
  });
  it('the user-present window classifies active (journal 15:28 cluster)', () => {
    const ss = createScreenState({ idle: null });
    const r = ss.synthesize(presentWindow);
    assert.equal(r.state, 'active');
  });
  it('suspend credit present means the machine slept, not display-off: active verdict with note', () => {
    const ss = createScreenState({ idle: null });
    const r = ss.synthesize(Object.assign({}, lockWindow, { suspendCreditPresent: true }));
    assert.equal(r.state, 'active');
  });
  it('ambiguous middle stays unknown (never guesses)', () => {
    const ss = createScreenState({ idle: null });
    const r = ss.synthesize({ focusedFalseDensity: 0.5, consecutiveDispatchFailures: 3,
      wallOverMedian: 2.5, suspendCreditPresent: false });
    assert.equal(r.state, 'unknown');
  });

  // 197th-round review #9 (SW live wiring): the service worker feeds the
  // synthesis from its TabActivation receipt window — density + wall only,
  // the dispatch-failure counter is NOT wired there. The calibrated 4-point
  // bar is unreachable in that mode (density caps at 2, wall adds 1), so the
  // locked bar lowers to 3 with confidence capped at 0.75; pure density
  // without wall corroboration stays unknown (conservative).
  it('density + wall (failures unwired) classifies the lock shape at capped confidence', () => {
    const ss = createScreenState({ idle: null });
    const r = ss.synthesize({ focusedFalseDensity: 0.9, wallOverMedian: 6,
      suspendCreditPresent: false });
    assert.equal(r.state, 'locked');
    assert.equal(r.confidence, 0.75, 'lowered-bar mode caps confidence below the calibrated 0.8');
    const r2 = createScreenState({ idle: null }).synthesize(lockWindow);
    assert.ok(r2.confidence > r.confidence, 'the fully-calibrated mode keeps the higher-confidence bar');
  });
  it('density alone (no wall corroboration, failures unwired) stays unknown', () => {
    const ss = createScreenState({ idle: null });
    const r = ss.synthesize({ focusedFalseDensity: 0.9, wallOverMedian: 1.2,
      suspendCreditPresent: false });
    assert.equal(r.state, 'unknown');
  });
  it('the fully-wired mode keeps the 4-point bar (no lowered-bar leakage)', () => {
    const ss = createScreenState({ idle: null });
    // score 3 WITH the failure counter wired: 1 (density 0.6) + 2 (failures) —
    // must NOT classify locked through the lowered bar.
    const r = ss.synthesize({ focusedFalseDensity: 0.6, consecutiveDispatchFailures: 4,
      wallOverMedian: 1, suspendCreditPresent: false });
    // score = 1 + 2 = 3, failures wired: original bar 4 applies -> unknown
    assert.equal(r.state, 'unknown');
  });
});
