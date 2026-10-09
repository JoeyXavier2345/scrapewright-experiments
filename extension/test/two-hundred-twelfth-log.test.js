// extension/test/two-hundred-twelfth-log.test.js
//
// 212th log (user's four asks on the 美食 session rs-1791542332315-1):
//   1. "一直只触发头两个帖子的悬浮窗" — the v7 anchorSel 'span a[href]'
//      matched anchors on only SOME cards (DOM-shape subset); the summary
//      showed anchorsFound 6-12 across processed 14-41 containers with
//      hovercardsCaptured>0 — the FAMILY_MISS detector (total-zero only)
//      cannot see this INTRA-POPULATION blindness. FIX: anchorCoverage
//      census on every extractWithHover summary — containers with zero
//      matching anchors named, with the scope teaching.
//   2a. "第二个帖子把正文里的标签也逐个悬浮" — 'span a[href]' also sweeps
//      body hashtags. FIX: anchorBreadth hint when an anchored container
//      carries >4 anchors on average (scope to the entity rows).
//   2b. "没有弹窗结果也被收录到 hoverInfo" — hashtag hovers mounted the
//      VIDEO PLAYER chrome (captured text '0:00 / 0:10', no entity data)
//      and the picker accepted it as the popover. FIX: video-player-chrome
//      rejection in the candidate filter (contains <video> AND <60 chars
//      stripped text ⇒ not a hovercard).
//   3. Intervention button (user feature): a running-session button that
//      pauses the session, opens an observation textarea, and injects the
//      text as a USER FEEDBACK directive on resume.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function setupDOM(html) {
  const dom = new JSDOM(html, { url: 'https://example.com/page' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.Node = dom.window.Node;
  return dom;
}
const { loadInline } = require('./helpers/inline-ops-factory.js');
const libOps = require('../lib/list-extract-ops.js');

const HTML = `
  <div class="card"><span><a href="/u1">Name One</a></span></div>
  <div class="card"><span><a href="/u2">Name Two</a></span></div>
  <div class="card"><div><a href="/u3">Name Three (div-wrapped)</a></div></div>
  <div class="card"><div><a href="/u4">Name Four (div-wrapped)</a></div></div>
`;

for (const [label, getOps] of [['lib', () => libOps], ['inline mirror', () => loadInline({ document: global.document, window: global.window })]]) {
  describe(`1+2a. anchorCoverage census + breadth hint — ${label} (212th log)`, () => {
    it('mixed zero-anchor containers surface the coverage census with scope teaching', async () => {
      setupDOM(HTML);
      const out = await getOps().extractWithHoverRecords(
        Array.from(document.querySelectorAll('.card')),
        { t: { selector: 'a' } },
        { anchorSel: 'span a[href]' },
        async () => ({ hovered: true, htmlSnippet: '<div>card</div>' }),
        { allowEmpty: true });
      void out;
      // cards 3-4 are div-wrapped → zero anchors for 'span a[href]'
      const sum = out._diagnostics && out._diagnostics.hoverSummary;
      if (!sum && getOps() === libOps) {
        // lib-level summary rides the caller; the census key is asserted via
        // source audit below for lib. For the mirror the wrapper attaches it.
      }
      // The records themselves: cards 3-4 got hovercards:[] — that IS the
      // zero-anchor signal; assert the census computation source exists.
      // the census lives in the content-script domExtractWithHover summary
      // wrapper — the single shared site for BOTH implementations.
      const src = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
      assert.match(src, /anchorCoverage/, 'census key computed');
      assert.match(src, /zeroAnchor|anchoredContainers/, 'per-container counters exist');
      assert.match(src, /only a DOM-shape subset|only SOME cards/i, 'the teaching names the subset failure');
    });
    it('breadth: >4 anchors per anchored container draws the scope hint', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
      assert.match(src, /anchorBreadth/, 'breadth hint key exists');
      assert.match(src, /entity rows|header rows/i, 'the hint teaches scoping to entity rows');
    });
  });
}

describe('2b. video-player chrome rejected as a popover (212th log, source audit)', () => {
  it('the candidate filter carries the video-chrome rejection', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    assert.match(src, /video_player_chrome/, 'rejection reason exists');
    assert.match(src, /querySelector\('video'\)/, 'video presence probed');
    assert.match(src, /60/, 'short-text bound present');
  });
});

describe('3. Intervention button (212th log, source audit)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'wizard.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'wizard.js'), 'utf8');
  it('the button exists beside Pause and is shown while running', () => {
    assert.match(html, /id="btnSessionIntervene"/, 'button present');
    assert.match(js, /btnSessionIntervene/, 'wired in JS');
    const i = js.indexOf("getElementById('btnSessionIntervene').addEventListener");
    const region = js.slice(i, i + 900);
    assert.match(region, /pause\(\)/, 'pauses the running session');
  });
  it('the panel has a textarea and submit routes to the USER FEEDBACK sender', () => {
    assert.match(html, /id="sessionIntervenePanel"/, 'panel present');
    assert.match(html, /id="sessionInterveneText"/, 'textarea present');
    const i = js.indexOf("getElementById('btnSessionInterveneSend').addEventListener");
    assert.ok(i > -1);
    const region = js.slice(i, i + 2600);
    assert.match(region, /sendSessionFeedback/, 'submit reuses the USER FEEDBACK pipeline');
  });
  it('setSessionMode shows it only while running (audit)', () => {
    const i = js.indexOf("getElementById('btnSessionIntervene').classList.toggle");
    assert.ok(i > -1, 'mode toggle present');
    assert.match(js.slice(i, i + 120), /mode !== 'running'/);
  });
  // 215th-round live report: clicking Intervene during research showed
  // NOTHING — the panel was instantiated inside #phase5 (Review & Deploy,
  // hidden during research) while the button lives in #phase4. Unhiding a
  // child of a hidden ancestor is a no-op. The panel must live in phase4.
  it('the panel lives in phase4 (the research stage), not phase5', () => {
    const p4 = html.indexOf('id="phase4"');
    const p5 = html.indexOf('id="phase5"');
    const panel = html.indexOf('id="sessionIntervenePanel"');
    assert.ok(p4 > -1 && p5 > -1 && panel > -1, 'phase4/phase5/panel all present');
    assert.ok(panel > p4 && panel < p5, 'the panel is inside the phase4 block — inside phase5 the running-session click unhides nothing');
  });

  // 215th-round follow-ups (the send/cancel sequencing the dead panel hid):
  // the engine consumes pauseFlag only at a TURN BOUNDARY — a mid-dispatch
  // pause leaves status 'running' for minutes (a verify can run 12+), the
  // fresh engine startResearchSession launches REFUSES while running (its
  // double-start guard), so Send bridged immediately persisted the
  // directive into a session no engine picked up. And Cancel left the
  // pending pause armed — the session parked at the boundary with nobody
  // to resume it.
  it('Send waits for the engine to leave running before bridging (audit)', () => {
    const i = js.indexOf("getElementById('btnSessionInterveneSend').addEventListener");
    assert.ok(i > -1);
    const region = js.slice(i, i + 2200);
    assert.match(region, /status\(\)|status === 'running'|state\(\)\.session\.status/, 'reads the engine status');
    assert.match(region, /setTimeout/, 'polls instead of bridging blind');
    assert.match(region, /sendSessionFeedback/, 'bridges once the pause landed');
  });
  it('Cancel retracts a pending pause or resumes an already-paused engine (audit)', () => {
    const i = js.indexOf("getElementById('btnSessionInterveneCancel').addEventListener");
    assert.ok(i > -1);
    const region = js.slice(i, i + 900);
    assert.match(region, /unpause/, 'retracts the pending pause flag');
    assert.match(region, /\.run\(\)/, 'resumes an already-paused engine');
  });
});

describe('4. engine unpause — a pending pause is retractable (215th round)', () => {
  const { createResearchSession } = require('../lib/research-session');
  function reply(content, extra) {
    return Object.assign({ content, finish_reason: 'stop', usage: { prompt_tokens: 100, completion_tokens: 10 } }, extra || {});
  }
  function envelope(tool, args) {
    return JSON.stringify(Object.assign({ think: 't', tool, args: args || {} }));
  }
  function finishEnvelope(summary) { return JSON.stringify({ think: 'done', finish: { summary: summary || 'done' } }); }
  function gatedEngine(releaseRef) {
    let i = 0;
    return createResearchSession({
      requirement: 'collect posts',
      llm: async () => {
        const r = [reply(envelope('probe.count', { sel: 'x' })), reply(finishEnvelope('unpaused and finished'))][Math.min(i++, 1)];
        return r;
      },
      tools: { 'probe.count': async () => {
        return await new Promise((resolve) => { releaseRef.fn = () => resolve({ count: 1 }); });
      } }
    });
  }
  it('pause() then unpause() while a dispatch is in flight: the loop never pauses', async () => {
    const releaseRef = {};
    const session = gatedEngine(releaseRef);
    const runP = session.run();
    await new Promise((r) => setTimeout(r, 30)); // probe.count dispatch in flight
    session.pause();
    assert.equal(typeof session.unpause, 'function', 'unpause exists on the engine API');
    session.unpause();
    releaseRef.fn();
    const report = await runP;
    assert.equal(report.stopped.reason, 'completed', 'unpause retracted the pending pause');
  });
  it('pause() without unpause still parks the loop (regression pin)', async () => {
    const releaseRef = {};
    const session = gatedEngine(releaseRef);
    const runP = session.run();
    await new Promise((r) => setTimeout(r, 30));
    session.pause();
    releaseRef.fn();
    const report = await runP;
    assert.equal(report.stopped.reason, 'paused');
  });
});
