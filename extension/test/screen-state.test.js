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
});
