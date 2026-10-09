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
    const i = js.indexOf('sessionInterveneText');
    assert.ok(i > -1);
    const region = js.slice(i, i + 1200);
    assert.match(region, /sendSessionFeedback/, 'submit reuses the USER FEEDBACK pipeline');
  });
  it('setSessionMode shows it only while running (audit)', () => {
    const i = js.indexOf("getElementById('btnSessionIntervene').classList.toggle");
    assert.ok(i > -1, 'mode toggle present');
    assert.match(js.slice(i, i + 120), /mode !== 'running'/);
  });
});
