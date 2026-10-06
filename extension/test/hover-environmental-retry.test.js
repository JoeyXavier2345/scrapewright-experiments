// 197th round (spec §2): in-operation transparent retry. A hover that
// times out while the screen is locked/idle waits for recovery (5s cycles,
// 90s cap) and retries once. Sliced-source behavioral test: the retry
// wrapper is extracted with the eval pattern used across this suite.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../content-script.js'), 'utf8');

function sliceFn(name) {
  const start = SRC.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' must be defined');
  let depth = 0, i = SRC.indexOf('{', start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return SRC.slice(start, i + 1);
}

describe('hover environmental retry (spec §2)', () => {
  it('queryScreenState + withEnvironmentalRetry exist (source audit)', () => {
    assert.match(SRC, /function queryScreenState\(\)/);
    assert.match(SRC, /function withEnvironmentalRetry\(/);
    assert.match(SRC, /environmental/);
  });

  it('locked→active recovery retries the op once and marks the receipt', async () => {
    const states = [{ state: 'locked', confidence: 1, source: 'api' },
                    { state: 'active', confidence: 1, source: 'api' }];
    const queryScreenState = async () => states.shift() || states[0];
    const sleep = async () => {}; // fast tests: no real 5s
    let calls = 0;
    const op = async () => { calls += 1; return calls === 1
      ? { hovered: true, reason: 'popover_timeout' }
      : { hovered: true, htmlSnippet: '<div>ok</div>' }; };
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleepFn) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(queryScreenState, sleep);
    const r = await withEnvironmentalRetry('hover', op, undefined, null, sleep);
    assert.equal(calls, 2, 'retried once after recovery');
    assert.ok(r.htmlSnippet, 'recovered result surfaces');
    assert.ok(r.environmental && r.environmental.recovered === true);
  });

  it('non-environmental timeout does NOT retry', async () => {
    const queryScreenState = async () => ({ state: 'active', confidence: 1, source: 'api' });
    const sleep = async () => {};
    let calls = 0;
    const op = async () => { calls += 1; return { hovered: true, reason: 'popover_timeout' }; };
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleepFn) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(queryScreenState, sleep);
    const r = await withEnvironmentalRetry('hover', op, undefined, null, sleep);
    assert.equal(calls, 1, 'no retry on an active screen');
    assert.ok(!r.environmental);
  });

  it('never recovers: honest receipt after the cap', async () => {
    const queryScreenState = async () => ({ state: 'locked', confidence: 1, source: 'api' });
    const sleep = async () => {};
    const op = async () => ({ hovered: true, reason: 'popover_timeout' });
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleepFn) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(queryScreenState, sleep);
    const r = await withEnvironmentalRetry('hover', op, { maxWaitMs: 1, cycleMs: 1 }, null, sleep);
    assert.equal(r.reason, 'popover_timeout');
    assert.ok(r.environmental && r.environmental.recovered === false);
  });
});

// 197th round Task 4 (spec §2): the scroll family and the collectUntil
// round loop. Scroll receipts carry their stall evidence under
// family-specific keys (scrolled:false / stalled / throttleNote) — never a
// reason/error string — so each wrap site passes its own classifier.
describe('scroll-family environmental retry wiring (source audit)', () => {
  it('the scrollBy and scrollToBottom dispatch cases route through the wrapper', () => {
    // the dispatcher cases assign via withEnvironmentalRetry('scrollBy', ...)
    assert.match(SRC, /withEnvironmentalRetry\('scrollBy'/);
    assert.match(SRC, /withEnvironmentalRetry\('scrollToBottom'/);
  });
  it('collectUntil stalls consult the screen state before concluding exhaustion', () => {
    assert.match(SRC, /withEnvironmentalRetry\('collectUntil-round'/);
  });
});

describe('scroll-family classifier (behavioral)', () => {
  it('an envelope-shaped stalled scroll consults via the site classifier and retries on recovery', async () => {
    const states = [{ state: 'locked', confidence: 1, source: 'api' },
                    { state: 'active', confidence: 1, source: 'api' }];
    const queryScreenState = async () => states.shift() || states[0];
    const sleep = async () => {}; // fast tests: no real 5s
    let calls = 0;
    // the scrollBy dispatch shape: the wrapper sees the {result,_diagnostics}
    // envelope — no reason key anywhere, so ONLY the site classifier can
    // flag it (the default reasonish probe alone would never fire).
    const op = async () => { calls += 1; return { result: { scrolled: false }, _diagnostics: {} }; };
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleepFn) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(queryScreenState, sleep);
    const r = await withEnvironmentalRetry('scrollBy', op, {
      isTimeoutClass: (x) => !!(x && x.result && x.result.scrolled === false)
    }, null, sleep);
    assert.equal(calls, 2, 'the stalled envelope consulted the screen state and retried once');
    assert.ok(r.environmental && r.environmental.recovered === true);
  });

  it('a satisfied collectUntil receipt is NOT timeout-class (no consult)', async () => {
    const queryScreenState = async () => ({ state: 'locked', confidence: 1, source: 'api' });
    const sleep = async () => {};
    let consults = 0;
    const qCounting = async () => { consults += 1; return { state: 'locked', confidence: 1, source: 'api' }; };
    const op = async () => ({ satisfied: true, collected: 5 });
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleepFn) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(qCounting, sleep);
    // the collectUntil-round wrap-site classifier: unsatisfied and NOT the
    // outer-deadline exit (a dead execution must not wait).
    const isTimeoutClass = (r) => !!(r && r.satisfied === false && !r.outerDeadline);
    const ok = await withEnvironmentalRetry('collectUntil-round', op, { isTimeoutClass }, null, sleep);
    assert.ok(!ok.environmental, 'a satisfied verdict never consults');
    const deadline = await withEnvironmentalRetry('collectUntil-round',
      async () => ({ satisfied: false, outerDeadline: 'OUTER_DEADLINE_EXCEEDED: budget ended' }),
      { isTimeoutClass, maxWaitMs: 1, cycleMs: 1 });
    assert.ok(!deadline.environmental, 'the outer-deadline exit never waits (dead execution)');
    assert.equal(consults, 0, 'no screen-state consult on either receipt');
  });
});

// 197th-round review #3: stalled:true is the HEALTHY termination of an
// incremental scroll — the old classifier consulted the screen state on
// EVERY completed scroll. Stall-class now requires frame-starvation
// evidence on the receipt (hidden/unfocused pageState, zero rAF ticks, or
// a throttle note); the bare stall keys alone are not enough.
describe('scroll stall classifier requires frame evidence (review #3)', () => {
  const classifier = eval('(function (receiptShowsDegradedPage) { return (' + sliceFn('scrollReceiptLooksStalled') + '); })')(
    eval('(' + sliceFn('receiptShowsDegradedPage') + ')')
  );

  it('a healthy completion (stalled:true, no page evidence) is NOT stall-class', () => {
    assert.equal(classifier({ scrolled: true, stalled: true, stallReason: 'no_progress_count_elapsed', newY: 50 }), false);
    assert.equal(classifier({ scrolled: false, prevY: 100, newY: 100 }), false, 'bottom arrival is not starvation');
  });

  it('healthy completion on an idle screen NEVER consults (review #3 behavioral)', async () => {
    let consults = 0;
    const qCounting = async () => { consults += 1; return { state: 'idle', confidence: 1, source: 'api' }; };
    const sleep = async () => {};
    let calls = 0;
    const op = async () => { calls += 1; return { scrolled: true, stalled: true, stallReason: 'no_progress_count_elapsed', newY: 50 }; };
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleepFn) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(qCounting, sleep);
    const r = await withEnvironmentalRetry('scrollToBottom', op, { isTimeoutClass: classifier }, null, sleep);
    assert.equal(consults, 0, 'no screen-state consult on a healthy completion');
    assert.equal(calls, 1, 'the op ran exactly once');
    assert.ok(!r.environmental, 'no environmental marker on a healthy completion');
  });

  it('frame-starvation evidence IS stall-class (pageState hidden / zero rAF / throttleNote)', () => {
    assert.equal(classifier({ scrolled: false, pageState: { visibilityState: 'hidden', hasFocus: true } }), true);
    assert.equal(classifier({ scrolled: false, pageState: { visibilityState: 'visible', hasFocus: false } }), true);
    assert.equal(classifier({ scrolled: false, frameSample: { rAFTicks: 0, sampleMs: 300 } }), true);
    assert.equal(classifier({ scrolled: false, throttleNote: 'page reports hidden' }), true);
    assert.equal(classifier({ scrolled: false, pageState: { visibilityState: 'visible', hasFocus: true } }), false, 'a healthy pageState does not fabricate starvation');
  });

  it('the envelope shape unwraps before judging (scrollBy dispatch)', () => {
    assert.equal(classifier({ result: { scrolled: false, pageState: { visibilityState: 'hidden', hasFocus: false } }, _diagnostics: {} }), true);
    assert.equal(classifier({ result: { scrolled: false, stalled: true }, _diagnostics: {} }), false, 'bare stall keys inside the envelope stay healthy');
  });
});

// 197th-round review #2: idle alone is not degradation — a reader (or an
// unattended keep-awake machine) reports idle with a perfectly live page.
// The wait requires the receipt itself to corroborate a degraded page.
describe('idle corroboration gate (review #2)', () => {
  const degradedPageHelper = eval('(' + sliceFn('receiptShowsDegradedPage') + ')');
  // Bind positionally: the wrapper takes (label, op, opts, queryScreenStateFn,
  // sleepFn) — its own 5th param shadows any closure name, so the fast sleep
  // must ride the CALL, not the eval scope.
  const withEnv = (q, sleep) => {
    const fn = eval('(function (queryScreenState, sleepFn, receiptShowsDegradedPage) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(q, sleep, degradedPageHelper);
    return (label, op, opts) => fn(label, op, opts, null, sleep);
  };

  it('idle + timeout receipt WITHOUT page evidence does NOT wait', async () => {
    let consults = 0;
    const q = async () => { consults += 1; return { state: 'idle', confidence: 1, source: 'api' }; };
    const sleep = async () => {};
    let calls = 0;
    const op = async () => { calls += 1; return { hovered: true, reason: 'popover_timeout' }; };
    const r = await withEnv(q, sleep)('hover', op);
    assert.equal(consults, 1, 'the screen state was queried exactly once (the gate)');
    assert.equal(calls, 1, 'no retry and no waiting on an ambiguous idle');
    assert.ok(!r.environmental);
  });

  it('idle + receipt that corroborates a degraded page WAITS and retries', async () => {
    const states = [{ state: 'idle', confidence: 1, source: 'api' },
                    { state: 'active', confidence: 1, source: 'api' }];
    const q = async () => states.shift() || states[0];
    const sleep = async () => {};
    let calls = 0;
    const op = async () => { calls += 1; return calls === 1
      ? { hovered: false, reason: 'pre_dispatch_starved', pageState: { visibilityState: 'hidden', hasFocus: false } }
      : { hovered: true, htmlSnippet: '<div>ok</div>' }; };
    const r = await withEnv(q, sleep)('hover', op, { isTimeoutClass: (x) => !!(x && x.pageState) });
    assert.equal(calls, 2, 'corroborated idle waited for recovery and retried once');
    assert.ok(r.environmental && r.environmental.recovered === true);
  });

  it('locked waits WITHOUT receipt corroboration (the authoritative state)', async () => {
    const states = [{ state: 'locked', confidence: 1, source: 'api' },
                    { state: 'active', confidence: 1, source: 'api' }];
    const q = async () => states.shift() || states[0];
    const sleep = async () => {};
    let calls = 0;
    const op = async () => { calls += 1; return calls === 1
      ? { hovered: true, reason: 'popover_timeout' }
      : { hovered: true, htmlSnippet: '<div>ok</div>' }; };
    const r = await withEnv(q, sleep)('hover', op);
    assert.equal(calls, 2);
    assert.ok(r.environmental && r.environmental.recovered === true);
  });
});

// 197th-round review #4 + #6: the recovery wait clamps to the owning
// script deadline, stops polling once it passes, and a retry that still
// fails timeout-class stamps recovered:false with the retry reason.
describe('deadline clamp + honest recovery stamp (review #4/#6)', () => {
  const withEnv = (q, sleep) => {
    const fn = eval('(function (queryScreenState, sleepFn) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(q, sleep);
    return (label, op, opts) => fn(label, op, opts, null, sleep);
  };

  it('a passed deadline stops the wait immediately (no polling past a dead execution)', async () => {
    let sleeps = 0;
    const q = async () => ({ state: 'locked', confidence: 1, source: 'api' });
    const sleep = async () => { sleeps += 1; };
    const op = async () => ({ hovered: true, reason: 'popover_timeout' });
    const r = await withEnv(q, sleep)('hover', op, { deadlineAt: Date.now() - 1 });
    assert.equal(sleeps, 0, 'never slept past the deadline');
    assert.ok(r.environmental && r.environmental.recovered === false);
    assert.equal(r.environmental.deadlineStopped, true);
  });

  it('a retry that still fails timeout-class is NOT a recovery', async () => {
    const states = [{ state: 'locked', confidence: 1, source: 'api' },
                    { state: 'active', confidence: 1, source: 'api' }];
    const q = async () => states.shift() || states[0];
    const sleep = async () => {};
    const op = async () => ({ hovered: true, reason: 'popover_timeout' });
    const r = await withEnv(q, sleep)('hover', op);
    assert.ok(r.environmental && r.environmental.recovered === false, 'same timeout reason on the retry');
    assert.match(r.environmental.retryReason || '', /popover_timeout/);
  });
});

// 197th-round review #5: a collectUntil verdict concluded on a degraded
// screen is demoted — the certification must never survive a starved loop.
describe('collectUntil verdict demotion + deadline threading (review #4/#5, source audit)', () => {
  it('the wrap site demotes the certification when the receipt carries an environmental marker', () => {
    assert.match(SRC, /verdict demoted — re-run to certify/);
    assert.match(SRC, /verdictDemoted = true/);
  });
  it('every wrap site threads the caller deadline into the wait budget (review #4)', () => {
    assert.match(SRC, /withEnvironmentalRetry\('scrollBy'[\s\S]{0,300}?deadlineAt: data\.deadlineAt/);
    assert.match(SRC, /withEnvironmentalRetry\('scrollToBottom'[\s\S]{0,300}?deadlineAt: data\.deadlineAt/);
    assert.match(SRC, /withEnvironmentalRetry\('scrollIntoView'[\s\S]{0,300}?deadlineAt: data\.deadlineAt/);
    assert.match(SRC, /withEnvironmentalRetry\('hover'[\s\S]{0,300}?deadlineAt: data\.deadlineAt/);
    assert.match(SRC, /withEnvironmentalRetry\('collectUntil-round'/);
  });
});
