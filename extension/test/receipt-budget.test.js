// 89th-round plan T3 (D2): the model-facing verify.run receipt was compacted
// at the GLOBAL 4000-char budget with uniform insertion-order shares — long
// prose (scoreNote/shapeDistribution) ate budget while the rows the model
// acts on elided (`…[+7 keys elided: "path,sampleValue,…"]`,
// `…[+10 keys elided: "postTime,location,content,…"]`). Two changes:
//   (1) per-tool cap map (verify.run → 20000 — a verify costs 65-110s, a
//       20K receipt is affordable);
//   (2) priority key ordering inside compactObjectForLLM — error/ok/
//       detectors/finalResult/steps/schemaOk/score render BEFORE prose keys.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const Protocol = require('../lib/session-protocol.js');
const VRF = require('./fixtures/verify-report.js');

const RS_SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');

describe('T3: per-tool receipt budget + priority key ordering', () => {
  it('compactObjectForLLM orders decision keys FIRST (error/ok/detectors/finalResult before scoreNote/shapeDistribution)', () => {
    const obj = {
      executedArtifactVersion: 7,
      ok: false,
      error: { message: 'TIME_SOURCE_UNEXERCISED: posts.postTime …' },
      scoreNote: 'x'.repeat(3000),
      shapeDistribution: 'y'.repeat(3000),
      detectors: { relativeTimestamps: [{ field: 'postTime', sampleValue: 'August 2' }] },
      finalResult: { posts: [{ postTime: 'August 2' }] }
    };
    const out = Protocol.compactObjectForLLM(obj, 1200);
    const iErr = out.indexOf('"error"');
    const iDet = out.indexOf('"detectors"');
    const iFin = out.indexOf('"finalResult"');
    const iProse = out.indexOf('"scoreNote"');
    assert.ok(iErr !== -1 && iDet !== -1, 'decision keys render, got: ' + out.slice(0, 200));
    assert.ok(iErr < iProse && iDet < iProse, 'decision keys precede prose');
    if (iFin !== -1) assert.ok(iFin < iProse, 'finalResult precedes prose');
    assert.match(out, /August 2/, 'the census sample value survives at a tight budget');
  });

  it('a small object renders IDENTICALLY to the old uniform order when all keys fit (byte-stable for non-verify receipts)', () => {
    const obj = { a: 1, b: 'two', c: [1, 2], d: { e: 'f' } };
    const out = Protocol.compactObjectForLLM(obj, 4000);
    assert.deepEqual(JSON.parse(out), obj, 'small objects stay fully rendered and parse back identically');
  });

  it('research-session resolves a per-tool cap: verify.run receipts get the larger budget', () => {
    assert.match(RS_SRC, /toolResultCaps/, 'DEFAULTS carry a per-tool cap map');
    assert.match(RS_SRC, /'verify\.run':\s*\d+/, 'verify.run has an explicit cap');
    assert.match(RS_SRC, /capForTool|toolResultCapFor/, 'a resolver exists');
  });

  // 253b (P3-C): the joint-solver propose receipts carry new decision-bearing
  // fields (ledgerWarning / populationHint / censusMount / ledgerConflicts /
  // selectorProvenance, plus the large-nesting updateReceipt). Under the
  // 4000-char receipt cap the uniform insertion-order shares let generic keys
  // (merge/sweepCostMs/next prose) consume budget first and stubbed exactly
  // the rows the model acts on — the same class T3 fixed for verify receipts.
  it('253b C: propose-receipt decision keys render BEFORE generic keys under budget pressure', () => {
    const obj = {
      merge: 'regenerated-from-fresh-sweep (hand-tuned slots are NOT preserved — re-check any slot you had fixed by hand)',
      sweepCostMs: 87431,
      bootstrapCapped: false,
      attrGrounding: [{ attr: 'href', ok: true, absentPct: 0 }],
      next: 'x'.repeat(600),
      updateReceipt: { updated: true, version: 3, staticLint: ['l'.repeat(400)], note: 'n'.repeat(300) },
      ledgerWarning: 'ledger-proven link family conflicts with the fresh sweep',
      populationHint: 'population NOT grounded — annotate.request before selector archaeology',
      censusMount: { rounds: 2, countBefore: 3, countAfter: 9, goalMet: false },
      ledgerConflicts: ['a[href*="/x/"]'],
      selectorProvenance: { identitySelector: 'a[href*="id="]', source: 'hrefIdentity-tokens' }
    };
    const out = Protocol.compactObjectForLLM(obj, 1000);
    const iGeneric = out.indexOf('sweepCostMs');
    assert.ok(iGeneric > -1, 'sanity: a generic key renders or stubs');
    for (const k of ['updateReceipt', 'ledgerWarning', 'populationHint', 'censusMount', 'ledgerConflicts', 'selectorProvenance']) {
      const i = out.indexOf('"' + k + '"');
      assert.ok(i !== -1, k + ' key name survives the tight budget — got: ' + out.slice(0, 160));
      assert.ok(i < iGeneric, k + ' precedes the generic keys');
    }
    // The small decision fields carry their VALUES, not just names.
    assert.match(out, /annotate\.request/, 'populationHint value survives');
    assert.match(out, /hrefIdentity-tokens/, 'selectorProvenance value survives');
  });
});
