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
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleep) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(queryScreenState, sleep);
    const r = await withEnvironmentalRetry('hover', op);
    assert.equal(calls, 2, 'retried once after recovery');
    assert.ok(r.htmlSnippet, 'recovered result surfaces');
    assert.ok(r.environmental && r.environmental.recovered === true);
  });

  it('non-environmental timeout does NOT retry', async () => {
    const queryScreenState = async () => ({ state: 'active', confidence: 1, source: 'api' });
    const sleep = async () => {};
    let calls = 0;
    const op = async () => { calls += 1; return { hovered: true, reason: 'popover_timeout' }; };
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleep) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(queryScreenState, sleep);
    const r = await withEnvironmentalRetry('hover', op);
    assert.equal(calls, 1, 'no retry on an active screen');
    assert.ok(!r.environmental);
  });

  it('never recovers: honest receipt after the cap', async () => {
    const queryScreenState = async () => ({ state: 'locked', confidence: 1, source: 'api' });
    const sleep = async () => {};
    const op = async () => ({ hovered: true, reason: 'popover_timeout' });
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleep) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(queryScreenState, sleep);
    const r = await withEnvironmentalRetry('hover', op, { maxWaitMs: 1, cycleMs: 1 });
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
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleep) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(queryScreenState, sleep);
    const r = await withEnvironmentalRetry('scrollBy', op, {
      isTimeoutClass: (x) => !!(x && x.result && x.result.scrolled === false)
    });
    assert.equal(calls, 2, 'the stalled envelope consulted the screen state and retried once');
    assert.ok(r.environmental && r.environmental.recovered === true);
  });

  it('a satisfied collectUntil receipt is NOT timeout-class (no consult)', async () => {
    const queryScreenState = async () => ({ state: 'locked', confidence: 1, source: 'api' });
    const sleep = async () => {};
    let consults = 0;
    const qCounting = async () => { consults += 1; return { state: 'locked', confidence: 1, source: 'api' }; };
    const op = async () => ({ satisfied: true, collected: 5 });
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleep) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(qCounting, sleep);
    // the collectUntil-round wrap-site classifier: unsatisfied and NOT the
    // outer-deadline exit (a dead execution must not wait).
    const isTimeoutClass = (r) => !!(r && r.satisfied === false && !r.outerDeadline);
    const ok = await withEnvironmentalRetry('collectUntil-round', op, { isTimeoutClass });
    assert.ok(!ok.environmental, 'a satisfied verdict never consults');
    const deadline = await withEnvironmentalRetry('collectUntil-round',
      async () => ({ satisfied: false, outerDeadline: 'OUTER_DEADLINE_EXCEEDED: budget ended' }),
      { isTimeoutClass, maxWaitMs: 1, cycleMs: 1 });
    assert.ok(!deadline.environmental, 'the outer-deadline exit never waits (dead execution)');
    assert.equal(consults, 0, 'no screen-state consult on either receipt');
  });
});
