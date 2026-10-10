// extension/test/two-hundred-twenty-third-log.test.js
//
// 223rd round (user page observation: "during verify the hover popovers
// fire for the 3rd or 4th post and then STOP"). The 222nd session's batch
// summaries name the mechanism: processed 5-9 containers with
// anchor_not_hoverable ×4-6 per batch — 83 of the session's 168 skips were
// "attached, box-less after scroll retry (virtualized)".
//
// Root cause: the hover batch enumerates a container's anchors ONCE and
// then hovers the ELEMENT HANDLES sequentially. On a virtualized feed the
// previous anchor's dwell/dismiss recycles the card — the pre-enumerated
// handle is replaced (detached or permanently box-reclaimed), the domHover
// G1 remount retry re-measures the SAME STALE HANDLE after only 250ms, and
// every later anchor is refused as anchor_not_hoverable with no mouse
// movement — the visible hovering stops while the batch "processes" the
// remaining containers with empty hovercards.
//
//   A. re-resolve each anchor by index right before its hover (fresh
//      handle per anchor — one qsa per anchor is negligible).
//   B. the domHover remount-retry wait rises 250ms → 700ms (cold-tab
//      virtualizer remount needs longer than 250ms to lay out).
//   C. the maxWallMs DEFAULT scales with the declared work — the 25s flat
//      default covered ~3-4 cold hovers (4.5s timeout each × ~2 anchors);
//      now max(25s, 8s × containers) capped at 90s (the hover-aware step
//      budget is 120s).
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

const HTML = `
  <div class="card">
    <a class="anc" href="/a1">one</a>
    <a class="anc" href="/a2">two</a>
  </div>
`;

for (const [label, getOps] of [['lib', () => require('../lib/list-extract-ops.js')], ['inline mirror', () => require('./helpers/inline-ops-factory.js').loadInline({ document: global.document, window: global.window })]]) {
  describe(`A. per-anchor re-resolution kills the stale handle — ${label} (223rd round)`, () => {
    it('a virtualizer remount during the first dwell does not detach the second hover', async () => {
      setupDOM(HTML);
      const seen = [];
      const hoverFn = async (anchorEl) => {
        seen.push({ href: anchorEl.getAttribute('href'), connected: anchorEl.isConnected });
        // Simulate the virtualizer: during EVERY dwell the card is
        // re-rendered — the enumerated nodes are replaced by fresh clones.
        const card = document.querySelector('.card');
        if (seen.length === 1) {
          card.innerHTML = '<a class="anc" href="/a1">one</a><a class="anc" href="/a2">two</a>';
        }
        return { hovered: true, htmlSnippet: '<div>pop</div>', popoverSelector: 'div.pop' };
      };
      const out = await getOps().extractWithHoverRecords(
        Array.from(document.querySelectorAll('.card')),
        { t: { selector: 'span.missing' } },
        { anchorSel: '.anc' },
        hoverFn,
        { allowEmpty: true });
      assert.equal(seen.length, 2, 'both anchors hovered');
      assert.ok(seen.every((s) => s.connected), 'every hovered anchor was a LIVE node: ' + JSON.stringify(seen));
      assert.equal(seen[1].href, '/a2');
      assert.equal(out[0].hovercards.length, 2);
    });
  });
}

describe('B. domHover remount retry wait (223rd round, source pin)', () => {
  it('the G1 retry waits 700ms, not 250ms', () => {
    const cs = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    const i = cs.indexOf('attached, box-less after scroll retry');
    assert.ok(i > -1, 'the retry block exists');
    // 225th: the retry block grew a post-wait deadline guard; the marker
    // text moved further from the wait — search the wider window.
    const region = cs.slice(Math.max(0, i - 2400), i + 400);
    assert.match(region, /setTimeout\(r,\s*700\)/, 'the remount wait is 700ms');
    assert.doesNotMatch(region, /setTimeout\(r,\s*250\)/, 'the old 250ms wait is gone from the retry');
  });
});

describe('C. maxWallMs default scales with the work (223rd round)', () => {
  const lib = require('../lib/list-extract-ops.js');
  it('the budget helper: 8s/container, floor 25s, cap 90s', () => {
    assert.equal(typeof lib.defaultHoverWallBudgetMs, 'function', 'exported');
    assert.equal(lib.defaultHoverWallBudgetMs(1), 25000);
    assert.equal(lib.defaultHoverWallBudgetMs(3), 25000);
    assert.equal(lib.defaultHoverWallBudgetMs(6), 48000);
    assert.equal(lib.defaultHoverWallBudgetMs(9), 72000);
    assert.equal(lib.defaultHoverWallBudgetMs(20), 90000);
    assert.equal(lib.defaultHoverWallBudgetMs(1000), 90000);
  });
  it('both batch sites use the helper (source pins)', () => {
    const libSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'list-extract-ops.js'), 'utf8');
    const csSrc = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    for (const [name, src] of [['lib', libSrc], ['content-script', csSrc]]) {
      assert.match(src, /defaultHoverWallBudgetMs\(/, name + ' uses the scaled default');
    }
  });
});
