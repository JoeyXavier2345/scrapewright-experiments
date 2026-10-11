// extension/test/two-hundred-thirty-second-log.test.js
//
// 232nd round — follow-up on the user's two questions:
//   Q1 "OPEN_TAB_TIMEOUT 是不是误判？" — NO misjudgment of the PAGE: the
//      sub-tab was healthy and working (activation ok → ready → 21 anchor
//      dispatches → completed 08:52:54). The bug was the relay's 60s local
//      cap (231st). But the 231st fix left two residuals:
//      (A) the relay timer starts at SEND — it includes the sub-tab LOAD
//          (7s in that session; up to 120s on slow networks), which the
//          remote 120s exec budget does not count. A slow load + a
//          legitimate 100s body still dies at the local cap.
//      (B) after the local timeout the sub-tab kept burning 49s as a
//          zombie — no cancel channel existed.
//   Q2 "还有没有 bug" — (C) the v2 verify shipped ALL-null hover detectors
//      while the journal showed extractWithHover_done with anchorsFound 0:
//      sub-tab diagnostics never reach the parent verify receipt. The
//      EMPTY_EXTRACTION messages now name the blind spot + the exits.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('232nd round — openTab residuals after the 231st alignment', () => {
  it('A: the relay default carries load headroom (180000) and opts cap 300000', () => {
    const cs = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    const i = cs.indexOf('232nd log: the relay timer starts at SEND');
    assert.ok(i > -1);
    assert.match(cs.slice(i, i + 500), /OPEN_TAB_LOCAL_TIMEOUT_MS = 180000/, 'default = exec 120s + load headroom');
    const j = cs.indexOf('async function domOpenTab');
    assert.match(cs.slice(j, j + 500), /Math\.min\(timeoutMs, 300000\)/, 'opts cap raised to 300s');
  });
  it('B: the local timeout sends OPEN_TAB_CANCEL and background kills the zombie sub-tab', () => {
    const cs = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    const i = cs.indexOf('kill the zombie sub-tab');
    assert.ok(i > -1);
    assert.match(cs.slice(i, i + 400), /OPEN_TAB_CANCEL/, 'the timeout sends the cancel');
    const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
    const j = bg.indexOf('OPEN_TAB_CANCEL: removing zombie sub-tab');
    assert.ok(j > -1, 'the background cancel handler exists');
    const region = bg.slice(j - 500, j + 300);
    assert.match(region, /openTabSubTabs\.get\(message\.reqId\)/, 'registry lookup');
    assert.match(region, /closeScrapeTab/, 'the tab is closed');
    const reg = bg.indexOf('const openTabSubTabs = new Map()');
    assert.ok(reg > -1, 'the registry exists');
    assert.match(bg.slice(bg.indexOf('openTabSubTabs.set(reqId, tab.id)'), bg.indexOf('openTabSubTabs.set(reqId, tab.id)') + 100), /openTabSubTabs\.set/, 'registered after createScrapeTab');
    assert.match(bg.slice(bg.indexOf('openTabSubTabs.delete(reqId); // 232nd: normal completion'), bg.indexOf('openTabSubTabs.delete(reqId); // 232nd: normal completion') + 80), /delete/, 'cleaned on normal completion');
  });
  it('C: EMPTY_EXTRACTION names the $openTab diagnostics blind spot + exits', () => {
    const vr = fs.readFileSync(path.join(__dirname, '..', 'lib', 'verify-runner.js'), 'utf8');
    const i = vr.indexOf('232nd log: when the failing extraction ran INSIDE $openTab');
    assert.ok(i > -1, 'the note exists');
    const region = vr.slice(i, i + 1100);
    assert.match(region, /DO NOT reach this receipt/, 'the blind spot is named');
    assert.match(region, /probe\.snippet on the research tab/, 'exit (a): research-tab snippet');
    assert.match(region, /amend targetUrl/, 'exit (b): the 204th orchestrator-tab exit');
    for (const variant of ['SELECTOR_OVERFILTERED', 'INPUT_VALUE_SUSPECT']) {
      const k = vr.indexOf("EMPTY_EXTRACTION / " + variant);
      assert.ok(k > -1);
      assert.match(vr.slice(k, k + 1600), /openTabBlind232/, variant + ' variant carries the note');
    }
  });
});
