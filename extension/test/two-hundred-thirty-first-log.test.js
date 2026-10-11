// extension/test/two-hundred-thirty-first-log.test.js
//
// 231st log (session rs-1791707009414-1, build 230, user report: "未见页面
// 有悬浮操作"). The v3 collect step wrapped feed-settle + a 4-round
// scroll/stable loop + an $extractWithHover batch (wallBudgetMs 64000 per
// the taught scaled budget) inside $openTab — and died OPEN_TAB_TIMEOUT at
// exactly 60000ms... while the background executor's budget had been 120s
// since the sixtieth round. The raise never reached the CONTENT-SCRIPT
// RELAY (OPEN_TAB_LOCAL_TIMEOUT_MS = 60s, the B9 local cap): the two ends
// of the $openTab pipe disagreed, and the relay end silently vetoed bodies
// the harness itself teaches. The sub-tab kept working 49s past the
// caller's error (zombie batch, events at 08:52:54 after the 08:52:05
// timeout) — its hover dispatches (21 anchors, 16 no-signal early exits)
// ran on a sub-tab the model had already been told failed.
//
// Also: the earlier v2 batch on the verify sub-tab dispatched ZERO hovers
// (anchorsFound 0 across 8 containers — the model passed a CONTAINER
// selector as anchorSel), which is the "no visible hover operation" the
// user saw; the 08:52 batch's dispatches ran on the already-doomed sub-tab.
//
//   A. the relay cap matches the remote budget (120000), opts.timeoutMs is
//      forwarded from the DSL (max 180000), and the timeout message names
//      the budget + the size-the-body exits instead of "check the service
//      worker".
//   B. the DSL guide documents the $openTab budget and the sizing rule.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('231st round — the $openTab relay/executor budget split-brain', () => {
  it('the local cap matches the remote executor budget (120000), not the pre-sixtieth 60000', () => {
    const cs = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    const i = cs.indexOf('231st log: the local relay cap');
    assert.ok(i > -1, 'the fix marker exists');
    // 232nd: the default moved to 180000 (120s exec + load headroom —
    // the relay timer starts at SEND and includes the sub-tab load).
    const region = cs.slice(i - 400, i + 900);
    assert.match(cs, /OPEN_TAB_LOCAL_TIMEOUT_MS = 180000/, 'cap carries load headroom');
    const j = cs.indexOf('async function domOpenTab');
    assert.ok(j > -1);
    assert.match(cs.slice(j, j + 500), /Math\.min\(timeoutMs, 300000\)/, 'caller timeoutMs honored, capped at 300s (232nd)');
  });
  it('the DSL forwards opts.timeoutMs through the sandbox and the relay call', () => {
    const sb = fs.readFileSync(path.join(__dirname, '..', 'sandbox.js'), 'utf8');
    assert.match(sb, /'\$openTab': \(url, fn, opts\)/, 'three-arg signature');
    assert.match(sb, /opts\.timeoutMs/, 'opts.timeoutMs forwarded');
    const cs = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    const k = cs.indexOf("case 'openTab'");
    const region = cs.slice(k, k + 700);
    assert.match(region, /domOpenTab\(data\.args\[0\], data\.args\[1\], data\.args\[2\], data\.args\[3\]\)/, 'the relay passes the 4th arg');
  });
  it('the timeout message teaches sizing + the opt-up + the 204th exit (not "check the service worker")', () => {
    const cs = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    const i = cs.indexOf('OPEN_TAB_TIMEOUT: the sub-tab execution did not answer within its budget');
    assert.ok(i > -1, 'the new message exists');
    const msg = cs.slice(i, i + 800);
    assert.match(msg, /SIZE THE BODY/, 'the sizing directive');
    assert.match(msg, /waitForStable can take up to 20s/, 'the settle cost is named');
    assert.match(msg, /timeoutMs/, 'the opt-up is named');
    assert.match(msg, /amend targetUrl/, 'the 204th orchestrator-tab exit is named');
    assert.doesNotMatch(msg, /check the background service worker/, 'the misleading service-worker blame is gone');
  });
  it('the DSL guide documents the budget and the sizing rule', () => {
    const wu = fs.readFileSync(path.join(__dirname, '..', 'lib', 'wizard-utils.js'), 'utf8');
    const i = wu.indexOf('The sub-tab execution budget is 120000ms by default');
    assert.ok(i > -1, 'the budget line exists in the $openTab guide entry');
    const region = wu.slice(i, i + 400);
    assert.match(region, /timeoutMs/, 'the per-call opt-up documented');
    assert.match(region, /8s\/container|~8s\/container/, 'the hover scaling rule documented');
  });
});
