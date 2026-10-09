// extension/test/two-hundred-seventeenth-log.test.js
//
// 217th log: the user's review-panel feedback listed THREE detectors
// rendering the fallback placeholder (未编目的检测器发现): emptyFieldDiagnostics,
// nestedDuplicates, identityMirror — identityMirror was added the round
// BEFORE without its catalog entry. The full diff shows FOURTEEN verify
// detector keys missing from DETECTOR_PLAIN (the panel only surfaced the
// three that fired that run). The panel's plain-language layer is the
// user's primary surface for verify findings — every key the report can
// carry needs an entry, and a drift guard keeps future detectors honest.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WU = require('../lib/wizard-utils');

const MISSING_NOW = [
  'junkValues', 'emptyFieldDiagnostics', 'nestedDuplicates', 'shellHovercards',
  'capturedValueUnbound', 'inventedIdFallbacks', 'seeMoreUnexpanded',
  'hovercardUnparsed', 'mediaHygiene', 'resultStrayKeys', 'hardcodedNestedRoles',
  'hoverEntityCoverage', 'repeatedTokenFields', 'identityMirror'
];

describe('DETECTOR_PLAIN completeness (217th log)', () => {
  it('every key that was missing now has a plain entry with level/title/explain', () => {
    for (const k of MISSING_NOW) {
      const spec = WU.DETECTOR_PLAIN[k];
      assert.ok(spec, k + ' cataloged');
      assert.match(spec.level, /^(action|advisory)$/, k + ' level');
      assert.ok(spec.title && spec.title.length > 3, k + ' title');
      assert.equal(typeof spec.explain, 'function', k + ' explain');
      const rendered = String(spec.explain([{ path: 'posts.x', field: 'x', count: 2, indexA: 1, indexB: 2, totalRecords: 3, token: 'tok', mirroredIn: ['posts.h'], sample: 'abc', maxLen: 9 }]));
      assert.ok(!/未编目/.test(rendered), k + ' explains concretely');
    }
  });
  it('explain() never throws on null/undefined values', () => {
    for (const k of Object.keys(WU.DETECTOR_PLAIN)) {
      const spec = WU.DETECTOR_PLAIN[k];
      let out = '';
      try { out = String(spec.explain(null)); } catch (e) { assert.fail(k + ' explain(null) threw: ' + e.message); }
      assert.ok(typeof out === 'string', k);
    }
  });
  it('drift guard: every detector key verify-runner can emit has a catalog entry', () => {
    const vr = fs.readFileSync(path.join(__dirname, '..', 'lib', 'verify-runner.js'), 'utf8');
    const initMatch = vr.match(/const detectors = \{ ([\s\S]*?)\};/);
    assert.ok(initMatch, 'detectors init literal found');
    const keys = new Set(Array.from(initMatch[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*):/g), (m) => m[1]));
    for (const m of vr.matchAll(/detectors\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) keys.add(m[1]);
    const cat = new Set(Object.keys(WU.DETECTOR_PLAIN));
    const missing = Array.from(keys).filter((k) => !cat.has(k));
    assert.deepEqual(missing, [], 'all report detector keys cataloged — missing: ' + missing.join(', '));
  });
});
