// extension/test/selector-ledger.test.js
//
// Session-memory architecture (2026-10-13 spec §3.1, plan Task 1): the
// validated-facts ledger's WRITE path. observationLog entries gain a
// structured `outcomes` array [{selector, matched}] — whitelist-validated
// (pollution dropped field-wise, old seeds pass with []), zeros kept
// (dead is as valuable as alive). Pinned recording sites: probe.count,
// probe.scrollUntil (final count), probe.census (per-field lane rows),
// and the verify.run landing in session-tools (detectFieldMatchZero rows
// + the 244 pageWide counts, epoch stamped like every other receipt).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const __dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.DOMParser = __dom.window.DOMParser;
global.NodeFilter = __dom.window.NodeFilter;
global.Node = __dom.window.Node;

const { createObservationLog } = require('../lib/observation-log');
const { createProbeTools } = require('../lib/probe-tools');

describe('ledger — observationLog outcomes', () => {
  it('records and whitelists outcomes (pollution dropped field-wise, old seeds pass)', () => {
    const log = createObservationLog();
    log.record({ tool: 'probe.count', selectors: ['div.a'], summary: 'counted 8', epoch: 1,
      outcomes: [{ selector: 'div.a', matched: 8 }, { selector: '', matched: 3 }, { selector: 'x', matched: 'nine' }] });
    log.record({ tool: 'probe.census', selectors: ['div.a'], summary: 'census', epoch: 1,
      outcomes: [{ selector: 'span.ts', matched: 0 }] });
    const got = log.recent(10);
    assert.deepEqual(got[0].outcomes, [{ selector: 'div.a', matched: 8 }], 'valid rows kept, pollution dropped');
    assert.deepEqual(got[1].outcomes, [{ selector: 'span.ts', matched: 0 }], 'dead rows kept (dead is as valuable)');
    const seeded = createObservationLog({ entries: [{ id: 1, tool: 't', selectors: ['s'], summary: 'x', at: 1, epoch: 1 }] });
    assert.deepEqual(seeded.recent(1)[0].outcomes, [], 'old seed without outcomes passes with []');
  });
});

// ---- probe recording-site pins (drive the REAL probe tools with a stubbed
// rail, exactly like test/probe-census.test.js's makeCensusTools) ----

function cardHtml(n, opts) {
  const o = opts || {};
  return '<div class="card">' +
    '<a class="ttl" href="/post/' + n + '?story=' + (1000 + n) + '">Title ' + n + '</a>' +
    (o.noTs ? '' : '<span class="ts">' + (o.ts || (n + ' days ago')) + '</span>') +
    '<span class="cnt">' + (o.cnt || (10 * n)) + '</span>' +
    (o.noTs ? '' : '<span class="tip" aria-labelledby="tt' + n + '">' + (o.ts || (n + ' days ago')) + '</span>') +
    '<span class="pid" data-id="p' + n + '"></span>' +
    '</div>';
}

describe('ledger — probe recording sites', () => {
  it('probe.count records {sel, count} as an outcome', async () => {
    const observationLog = createObservationLog();
    const tools = createProbeTools({ executeDsl: async () => 7, observationLog });
    const r = await tools.count('div.card');
    assert.equal(r.count, 7);
    assert.equal(observationLog.size(), 1);
    const entry = observationLog.serialize().entries[0];
    assert.equal(entry.tool, 'probe.count');
    assert.deepEqual(entry.outcomes, [{ selector: 'div.card', matched: 7 }]);
  });

  it('probe.count records the honest zero too (dead is as valuable)', async () => {
    const observationLog = createObservationLog();
    const tools = createProbeTools({ executeDsl: async () => 0, observationLog });
    await tools.count('div.nope');
    assert.deepEqual(observationLog.serialize().entries[0].outcomes, [{ selector: 'div.nope', matched: 0 }]);
  });

  it('probe.scrollUntil records the final population count as an outcome (both exit paths)', async () => {
    // Scroll path: initial count 2, one round grows to 5 = target.
    const logA = createObservationLog();
    const toolsA = createProbeTools({
      executeDsl: async (snippet) => {
        if (/\$scrollBy\(/.test(snippet)) return { c0: 2, c1: 5, scrolled: true, y: 900, h: 5000 };
        return 2; // the initial $count
      },
      observationLog: logA
    });
    const rA = await toolsA.scrollUntil({ sel: 'div.card', targetCount: 5 });
    assert.equal(rA.satisfied, true);
    assert.equal(rA.finalCount, 5);
    const entryA = logA.serialize().entries[0];
    assert.equal(entryA.tool, 'probe.scrollUntil');
    assert.deepEqual(entryA.outcomes, [{ selector: 'div.card', matched: 5 }], 'final count, not the target');

    // Already-satisfied path (0 rounds) — the measured count still lands.
    const logB = createObservationLog();
    const toolsB = createProbeTools({ executeDsl: async () => 30, observationLog: logB });
    const rB = await toolsB.scrollUntil({ sel: 'div.card', targetCount: 20 });
    assert.equal(rB.rounds, 0);
    assert.deepEqual(logB.serialize().entries[0].outcomes, [{ selector: 'div.card', matched: 30 }]);
  });

  it('probe.census records per-field lane rows as outcomes (coverage NUMERATOR, zeros kept shape-valid)', async () => {
    // Mixed population: card 1 carries span.ts, cards 2-3 do not — span.ts
    // lands in the time lane with coverage 1/3, proving the outcome is the
    // NUMERATOR (matches across sampled docs), never the denominator.
    const observationLog = createObservationLog();
    const records = [cardHtml(1), cardHtml(2, { noTs: true }), cardHtml(3, { noTs: true })];
    const tools = createProbeTools({
      executeDsl: async (snippet) => {
        if (/\$extractWithHover\(/.test(snippet)) return [{ __t_label: '', __t_aria: '', __t_text: '', hovercards: [] }];
        if (/\$count\(/.test(snippet)) return records.length;
        return records.map((h) => ({ __c_html: h }));
      },
      observationLog
    });
    const r = await tools.census({ containerSel: 'div.card' });
    assert.ok(r.lanes && r.lanes.time && r.lanes.time.some((c) => c.selector === 'span.ts' && c.coverage === '1/3'),
      'fixture sanity: span.ts censused at 1/3');
    const entry = observationLog.serialize().entries.find((e) => e.tool === 'probe.census');
    assert.ok(entry, 'census observation recorded');
    assert.ok(Array.isArray(entry.outcomes) && entry.outcomes.length, 'outcomes present');
    const ts = entry.outcomes.find((o) => o.selector === 'span.ts');
    assert.ok(ts, 'span.ts outcome present');
    assert.equal(ts.matched, 1, 'coverage numerator (1 of 3 sampled docs), not the denominator');
    const ttl = entry.outcomes.find((o) => o.selector === 'a.ttl');
    assert.ok(ttl && ttl.matched === 3, 'a.ttl matched all 3 sampled docs');
    for (const o of entry.outcomes) {
      assert.ok(typeof o.selector === 'string' && o.selector.length > 0, 'every row carries a real selector');
      assert.ok(Number.isInteger(o.matched) && o.matched >= 0, 'every row carries a non-negative integer count');
    }
  });
});

// ---- verify-side recording (session-tools result landing) ----

describe('ledger — verify.run field-census recording', () => {
  function makeVerifyDeps(runVerify) {
    const state = { draft: null };
    const deps = {
      rail: {
        pageOpen: async () => ({ tabId: 1, url: 'https://example.com', ready: true }),
        pageState: async () => ({ open: true, tabId: 1, url: 'https://example.com' }),
        executeDsl: async () => 5,
        ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1,
        epoch: 3
      },
      runVerify: runVerify,
      getDraftService: () => state.draft,
      applyArtifact: (a) => { state.draft = { targetUrl: 'https://example.com', steps: a.steps }; },
      getTestInput: () => ({}),
      getOutputSchema: () => ({ type: 'object' }),
      getSteps: () => (state.draft ? state.draft.steps : []),
      annotationBridge: null,
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: (cfg) => {
        const base = createProbeTools(cfg);
        if (!base.snippet) base.snippet = async () => ({ result: 'dry-run ok' });
        return base;
      }
    };
    return { deps, state };
  }

  it('lands ONE outcome-bearing record from the zeroMatchFields census (+ pageWide rows, rail-epoch stamped)', async () => {
    const { createSessionTools } = require('../lib/session-tools');
    const observationLog = createObservationLog();
    const { deps, state } = makeVerifyDeps(async () => ({
      report: {
        ok: false,
        error: { message: 'REQUIRED_FIELD_EMPTY: posts[].postId empty in 5/5 records' },
        events: [],
        detectors: {
          zeroMatchFields: [
            { stepId: 's1', field: 'postId', subSelector: 'a.ttl', containerSelector: 'div.card', api: 'extractList', calls: 2, zeroCalls: 2, containerMatches: 5, pageWideMatches: 7 },
            { stepId: 's1', field: 'ts', subSelector: 'span.ts', containerSelector: 'div.card', api: 'extractList', calls: 2, zeroCalls: 2, containerMatches: 5, pageWideMatches: 0 }
          ]
        }
      },
      events: [],
      raw: { testResult: { steps: [] } }
    }));
    state.draft = { targetUrl: 'https://example.com', steps: [
      { id: 's1', name: 'extract', script: 'return $extractList("div.card", {t:{selector:".t"}});', onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }
    ] };
    const t = createSessionTools(deps);
    t.bindEngine({ observationLog });
    await t.tools['verify.run']({});
    const entries = observationLog.serialize().entries.filter((e) => e.tool === 'verify.run');
    assert.equal(entries.length, 1, 'exactly ONE verify.run ledger record');
    const entry = entries[0];
    assert.deepEqual(entry.selectors, ['a.ttl', 'span.ts'], 'selectors = the censused sub-selectors');
    assert.deepEqual(entry.outcomes, [
      { selector: 'a.ttl', matched: 0 },   // measured dead INSIDE every processed container
      { selector: 'a.ttl', matched: 7 },   // the 244 pageWide count — alive elsewhere on the page
      { selector: 'span.ts', matched: 0 }  // pageWide 0 → no duplicate second row
    ], 'dead rows + pageWide rows');
    assert.equal(entry.epoch, 3, 'epoch stamped from the rail like every other session-tools receipt');
  });

  it('records nothing extra when the census has no zero-match rows', async () => {
    const { createSessionTools } = require('../lib/session-tools');
    const observationLog = createObservationLog();
    const { deps, state } = makeVerifyDeps(async () => ({
      report: { ok: true, error: null, events: [], detectors: { zeroMatchFields: null } },
      events: [],
      raw: { testResult: { steps: [] } }
    }));
    state.draft = { targetUrl: 'https://example.com', steps: [
      { id: 's1', name: 'extract', script: 'return 1;', onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }
    ] };
    const t = createSessionTools(deps);
    t.bindEngine({ observationLog });
    await t.tools['verify.run']({});
    assert.equal(observationLog.serialize().entries.filter((e) => e.tool === 'verify.run').length, 0,
      'a clean verify writes no dead-family record');
  });
});
