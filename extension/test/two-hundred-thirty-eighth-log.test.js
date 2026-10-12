// extension/test/two-hundred-thirty-eighth-log.test.js
//
// 238th log (user adjudication): a tooltip that mounts as a narrow or
// zero-height strip IS a popover — many sites expose field extension info
// exactly that way — and the ARIA reference chain is the page author's own
// declaration of the relationship. The 237th incident's hover diagnostics
// showed the old cascade weighting that declaration zero: time anchors went
// 4x popover_timeout (the pre-mounted aria strip never entered the pool —
// not observer-added, zero-size → elementsFromPoint-blind) and 2x captured
// VIDEO CAPTION overlays (an unlinked sized mount beat the linked strip on
// the final area tiebreak). The fix is payload-agnostic and
// standard-semantics-driven (no site tokens, nothing timestamp-specific):
//   1. collectAnchorAriaRefIds238 — the anchor's aria-labelledby/
//      aria-describedby/aria-owns tokens, on the anchor AND its descendants
//      (the reference often lives on an inner span).
//   2. Referenced nodes enter the candidate pool every tick with source
//      'ariaRef' — pool-blind no longer possible.
//   3. The no-signal early-exit counts a live ARIA-referenced payload as
//      signal (a zero-height strip never fires the observer).
//   4. too_small exempts linked/role=tooltip candidates (the payload lives
//      in the accessible layer, not in paint).
//   5. The comparator's top tiers: linkedRef > roleTooltip > the legacy
//      cascade — the page author's declaration beats geometry.
//   6. The result discloses pickedVia ('ariaRef'|'role-tooltip'|'overlay').
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cs = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');

// Extract the comparator exactly as shipped: the function expression inside
// passingCandidates.sort(...). Brace-matched so later sorts cannot collide.
function extractComparator() {
  const anchorStr = 'passingCandidates.sort(';
  const start = cs.indexOf(anchorStr);
  assert.ok(start > -1, 'the comparator exists');
  let i = start + anchorStr.length;
  let depth = 0;
  for (; i < cs.length; i++) {
    if (cs[i] === '{') depth += 1;
    else if (cs[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const fnSrc = cs.slice(start + anchorStr.length, i + 1);
  return eval('(function () { return ' + fnSrc + '; })()');
}

// Extract the 238th collector as shipped (top-level named function).
function extractCollector() {
  const name = 'collectAnchorAriaRefIds238';
  const start = cs.indexOf('function ' + name);
  assert.ok(start > -1, 'the collector exists');
  const end = cs.indexOf('\n  }', start);
  const fnSrc = cs.slice(start, end + 4);
  const factory = eval('(function () { return ' + fnSrc.replace(/^function\s+\w+/, 'function') + '; })()');
  return factory;
}

function extractFnBody(name) {
  const start = cs.indexOf('function ' + name);
  assert.ok(start > -1, name + ' exists');
  return cs.slice(start, cs.indexOf('\n  }', start) + 4);
}

describe('238th round — ARIA-linked tooltip promotion in the hover picker', () => {
  it('the comparator: a linked narrow strip beats an unlinked sized caption mount', () => {
    const sortFn = extractComparator();
    const candidates = [
      { node: { tagName: 'DIV' }, source: 'added', posOverlay: true, z: 5, dist: 30, area: 12000, linkedRef: false, roleTooltip: false }, // video caption furniture
      { node: { tagName: 'DIV' }, source: 'ariaRef', posOverlay: false, z: 0, dist: 40, area: 0, linkedRef: true, roleTooltip: false } // the anchor's OWN referenced tooltip strip
    ];
    const ranked = candidates.slice().sort(sortFn);
    assert.equal(ranked[0].linkedRef, true, 'the ARIA-referenced strip ranks first');
    assert.equal(ranked[1].area, 12000, 'the unlinked caption loses despite its size');
  });
  it('the comparator: a fresh role=tooltip mount beats unlinked same-source mounts; the legacy cascade is intact below the new tiers', () => {
    const sortFn = extractComparator();
    const candidates = [
      { node: { tagName: 'DIV' }, source: 'added', posOverlay: true, z: 3, dist: 10, area: 500, linkedRef: false, roleTooltip: false },
      { node: { tagName: 'DIV' }, source: 'added', posOverlay: true, z: 1, dist: 20, area: 200, linkedRef: false, roleTooltip: true }
    ];
    let ranked = candidates.slice().sort(sortFn);
    assert.equal(ranked[0].roleTooltip, true, 'role=tooltip wins within the same source');
    // legacy tier unchanged: both unlinked → added beats efp regardless of geometry
    ranked = [
      { node: { tagName: 'DIV' }, source: 'efp', posOverlay: true, z: 9, dist: 1, area: 9999, linkedRef: false, roleTooltip: false },
      { node: { tagName: 'DIV' }, source: 'added', posOverlay: false, z: 0, dist: 500, area: 10, linkedRef: false, roleTooltip: false }
    ].sort(sortFn);
    assert.equal(ranked[0].source, 'added', 'legacy source tier preserved');
  });
  it('the collector: anchor + descendant references across all three attrs (jsdom)', () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<div><a id="lnk" href="#x"><span id="inner" aria-labelledby="tipA tipB"></span></a><span id="tipA">x</span></div>');
    const doc = dom.window.document;
    const lnk = doc.getElementById('lnk');
    lnk.setAttribute('aria-describedby', 'tipC');
    lnk.setAttribute('aria-owns', 'tipD tipE');
    const collect = extractCollector();
    const ids = collect(lnk);
    assert.ok(ids.has('tipA') && ids.has('tipB'), 'descendant span references collected');
    assert.ok(ids.has('tipC'), 'anchor aria-describedby collected');
    assert.ok(ids.has('tipD') && ids.has('tipE'), 'anchor aria-owns collected');
    assert.equal(ids.size, 5);
    assert.equal(collect(null).size, 0, 'null anchor degrades to an empty set');
  });
  it('the wiring: ariaRef pool push, early-exit signal, too_small exemption, pickedVia disclosure (source pins)', () => {
    assert.match(cs, /pushAriaRefCandidates238\(\)/, 'the pool push runs in the tick loop');
    assert.match(cs, /pushCandidate\(el, 'ariaRef'\)/, 'referenced nodes enter with source ariaRef');
    assert.match(cs, /anchor\.contains\(el\)/, 'reference targets INSIDE the anchor are excluded');
    assert.match(cs, /earlyAriaRefLive238/, 'a live referenced payload counts as hover signal');
    assert.match(cs, /if \(!exemptTinyText && !linkedRef238 && !roleTooltip238\)/, 'linked/role-tooltip candidates are never too_small');
    assert.match(cs, /a\.linkedRef !== b\.linkedRef/, 'linkage is the comparator\'s top tier');
    assert.match(cs, /result\.pickedVia = pickedVia238/, 'the result discloses the winning tier');
    assert.match(cs, /pickedVia238 = bestCandidate\.linkedRef \? 'ariaRef'/, 'the pick records the ariaRef tier');
  });
  it('no site tokens: the promotion references only standard ARIA attributes', () => {
    const region = cs.slice(cs.indexOf('238th log (user adjudication)'), cs.indexOf('function collectRejectedAddedTexts'));
    assert.ok(region.length > 500, 'the 238th region exists');
    for (const vendor of ['facebook', 'fbid', 'fbcdn', '\\bfb\\b', 'instagram', 'twitter']) {
      assert.doesNotMatch(region, new RegExp(vendor, 'i'), 'no vendor token: ' + vendor);
    }
  });
});
