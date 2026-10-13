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

// ---- Task 2 (2026-10-13 spec §3.2): the ledger's READ path — the pure
// renderer + the dossier wiring. [SELECTOR LEDGER] rides the evidence
// dossier EVERY turn, BEFORE [CONTAINER SKELETON] (§2 emphasis: the
// ledger's primary job is the MODEL'S PER-TURN visibility of validated
// facts, so an authoring turn reads outcomes before shapes). ----

const { renderSelectorLedger } = require('../lib/selector-ledger-render');

function obsEntry(epoch, tool, outcomes, at) {
  return {
    id: at || 1, tool: tool, selectors: outcomes.map((o) => o.selector), attrs: [],
    summary: '', at: at || 1, epoch: epoch, outcomes: outcomes
  };
}

describe('ledger — renderSelectorLedger (pure helper, spec §3.2)', () => {
  it('aggregates per selector with MAX matched winning — 0-inside-containers + pageWide n>0 is PROVEN, never dead (MA1 review note)', () => {
    const entries = [
      obsEntry(2, 'verify.run', [{ selector: 'a.ttl', matched: 0 }, { selector: 'a.ttl', matched: 7 }], 1),
      obsEntry(2, 'probe.census', [{ selector: 'a.ttl', matched: 3 }], 2)
    ];
    const text = renderSelectorLedger(entries, 2, 800);
    assert.match(text, /\[SELECTOR LEDGER\]/);
    assert.match(text, /a\.ttl → 7 matches \(verify\.run, epoch 2\)/,
      'row shape: sel → N matches (tool, epoch) — the WINNING observation names the tool, no unit word (units are mixed across tools)');
    assert.ok(!/PROVEN-DEAD[\s\S]*?a\.ttl/.test(text), 'a.ttl never renders in the dead group');
  });

  it('sorts PROVEN by cross-epoch survivor count desc, then matched desc; a survivor renders ONCE (live), with its survivor count disclosed', () => {
    const entries = [
      obsEntry(1, 'probe.count', [{ selector: 'div.stable', matched: 2 }], 1),
      obsEntry(2, 'probe.count', [{ selector: 'div.stable', matched: 2 }], 2),
      obsEntry(2, 'probe.count', [{ selector: 'div.big', matched: 50 }], 3)
    ];
    const text = renderSelectorLedger(entries, 2, 800);
    const iStable = text.indexOf('div.stable');
    const iBig = text.indexOf('div.big');
    assert.ok(iStable !== -1 && iBig !== -1, 'both families render');
    assert.ok(iStable < iBig, 'the 2-epoch survivor outranks the bigger single-epoch match');
    assert.match(text, /div\.stable → 2 matches[\s\S]{0,60}survives 2 epochs/, 'survivor count disclosed on the row');
    assert.equal(text.indexOf('div.stable'), text.lastIndexOf('div.stable'),
      'a survivor never duplicates under a stale layer — old epochs only credit the survivor count');
  });

  it('renders stale-only selectors under their own epoch header, never in the live groups', () => {
    const entries = [
      obsEntry(1, 'probe.count', [{ selector: 'div.old', matched: 4 }], 1),
      obsEntry(2, 'probe.count', [{ selector: 'div.live', matched: 6 }], 2)
    ];
    const text = renderSelectorLedger(entries, 2, 800);
    const iStale = text.indexOf('[epoch 1 — page reopened, stale]');
    assert.ok(iStale !== -1, 'stale layer header present');
    assert.ok(text.indexOf('div.old') > iStale, 'the stale-only row sits under the stale header');
    assert.ok(text.indexOf('div.live') < iStale, 'the live row sits above the stale layer');
    assert.ok(!/PROVEN[^\n]*div\.old/.test(text), 'stale rows never leak into the live PROVEN group');
  });

  it('PROVEN-DEAD rows include the tool name', () => {
    const text = renderSelectorLedger([obsEntry(2, 'verify.run', [{ selector: 'span.nope', matched: 0 }], 1)], 2, 800);
    assert.match(text, /PROVEN-DEAD/);
    assert.match(text, /span\.nope → 0 matches \(verify\.run, epoch 2\)/);
  });

  it('legacy null-epoch observations render in the live layer (C3: epoch-agnostic receipts never go stale)', () => {
    const text = renderSelectorLedger([obsEntry(null, 'probe.count', [{ selector: 'div.legacy', matched: 3 }], 1)], 2, 800);
    assert.match(text, /div\.legacy → 3 matches/);
    assert.ok(text.indexOf('[epoch') === -1, 'no stale header for epoch-agnostic rows');
  });

  it('caps PROVEN at 8 / DEAD at 6 rows and counts the capped rows as trimmed (never silent)', () => {
    const outcomes = [];
    for (let i = 0; i < 10; i++) outcomes.push({ selector: 'div.p' + i, matched: i + 1 });
    for (let i = 0; i < 8; i++) outcomes.push({ selector: 'div.d' + i, matched: 0 });
    const text = renderSelectorLedger([obsEntry(2, 'probe.count', outcomes, 1)], 2, 2000);
    assert.ok(text.includes('div.p9') && !text.includes('div.p0') && !text.includes('div.p1'),
      'PROVEN keeps the top 8 by matched');
    assert.ok(text.includes('div.d5') && !text.includes('div.d6'),
      'DEAD capped at 6');
    assert.match(text, /\[\+4 rows trimmed\]/, '2 proven + 2 dead capped rows disclosed');
  });

  it('overflow trims whole stale layers oldest-first (sweep: an older layer never outlives a newer one)', () => {
    const entries = [
      obsEntry(1, 'probe.count', [{ selector: 'div.e1', matched: 4 }], 1),
      obsEntry(2, 'probe.count', [{ selector: 'div.e2', matched: 4 }], 2),
      obsEntry(3, 'probe.count', [{ selector: 'div.live', matched: 5 }], 3)
    ];
    const full = renderSelectorLedger(entries, 3, 800);
    assert.ok(full.includes('div.e1') && full.includes('div.e2'), 'fixture sanity: full budget renders both layers');
    assert.ok(!/rows trimmed/.test(full), 'no trim note when nothing was trimmed');
    for (let b = 60; b <= 800; b += 7) {
      const t = renderSelectorLedger(entries, 3, b);
      assert.ok(t.length <= b, 'budget respected at ' + b + ' (got ' + t.length + ')');
      if (t.includes('div.e1')) {
        assert.ok(t.includes('div.e2'), 'budget ' + b + ': the OLDEST layer drops first');
      }
      // The live PROVEN row survives every layer/dead trim — only a budget
      // too small to physically contain it (header + row ≈ 110 chars) may
      // hard-slice it away.
      if (b >= 130) {
        assert.ok(t.includes('div.live'), 'budget ' + b + ': the live PROVEN row survives every trim');
      }
    }
    const tight = renderSelectorLedger(entries, 3, 120);
    assert.ok(!tight.includes('div.e1'), 'a tight budget drops stale layers');
    assert.match(tight, /\[\+\d+ rows trimmed\]/, 'trim disclosed');
  });

  it('after stale layers are gone, dead rows trim from the OLDEST current-epoch observation (sweep)', () => {
    const entries = [
      obsEntry(2, 'verify.run', [{ selector: 'div.dead_old', matched: 0 }], 1),
      obsEntry(2, 'verify.run', [{ selector: 'div.dead_mid', matched: 0 }], 2),
      obsEntry(2, 'verify.run', [{ selector: 'div.dead_new', matched: 0 }], 3)
    ];
    const full = renderSelectorLedger(entries, 2, 800);
    assert.ok(full.includes('div.dead_old') && full.includes('div.dead_new'), 'fixture sanity');
    for (let b = 60; b <= 800; b += 7) {
      const t = renderSelectorLedger(entries, 2, b);
      assert.ok(t.length <= b, 'budget respected at ' + b);
      if (t.includes('div.dead_old')) {
        assert.ok(t.includes('div.dead_mid') && t.includes('div.dead_new'),
          'budget ' + b + ': an older dead row never outlives newer ones');
      }
    }
    const tight = renderSelectorLedger(entries, 2, 120);
    assert.ok(!tight.includes('div.dead_old'), 'a tight budget drops the OLDEST dead row');
    assert.match(tight, /\[\+\d+ rows trimmed\]/);
  });

  it('truncates over-long selectors to ≤80 chars on the row', () => {
    const longSel = 'div.' + 'x'.repeat(140);
    const text = renderSelectorLedger([obsEntry(2, 'probe.count', [{ selector: longSel, matched: 1 }], 1)], 2, 800);
    const line = text.split('\n').find((l) => l.indexOf('div.xxx') !== -1);
    assert.ok(line, 'row present');
    const m = line.match(/^- (.*?) → /);
    assert.ok(m, 'row parses');
    assert.ok(m[1].length <= 80, 'rendered selector ≤80 chars (got ' + m[1].length + ')');
  });

  it('empty ledger → empty string (the dossier omits the section entirely)', () => {
    assert.equal(renderSelectorLedger([], 1, 800), '');
    assert.equal(renderSelectorLedger([obsEntry(1, 'probe.count', [], 1)], 1, 800), '',
      'entries without outcomes are not ledger material');
    assert.equal(renderSelectorLedger(undefined, 1, 800), '');
    assert.equal(renderSelectorLedger(null, 1), '');
  });
});

// ---- integration: the section rides the assembled dossier, BEFORE the
// container skeleton (mirror the engine harness shape used by
// test/graduated-activation.test.js / test/skeleton-dossier.test.js) ----

describe('ledger — dossier [SELECTOR LEDGER] section (integration)', () => {
  const { createResearchSession } = require('../lib/research-session');

  function scriptedLlm(replies, calls) {
    let i = 0;
    return async (req) => {
      calls.push(req);
      const r = replies[Math.min(i, replies.length - 1)];
      i++;
      return r;
    };
  }
  const reply = (content) => ({ content, finish_reason: 'stop', usage: { prompt_tokens: 100, completion_tokens: 10 } });
  const finishEnvelope = () => JSON.stringify({ think: 'done', finish: { summary: 'done' } });

  it('renders [SELECTOR LEDGER] BEFORE [CONTAINER SKELETON] from the session observationLog + rail epoch', async () => {
    const calls = [];
    const session = createResearchSession({
      requirement: 'r',
      llm: scriptedLlm([reply(finishEnvelope())], calls),
      tools: {},
      epochOf: () => 2,
      dossierFeeds: {
        containerHtml: () => '<div class="card"><a class="ttl">t</a></div>',
        popovers: () => [],
        lastVerify: () => null
      },
      seed: { observation: { seq: 4, entries: [
        obsEntry(1, 'probe.count', [{ selector: 'div.stable', matched: 3 }], 1),
        obsEntry(2, 'probe.count', [{ selector: 'div.stable', matched: 4 }], 2),
        obsEntry(2, 'verify.run', [{ selector: 'span.dead', matched: 0 }], 3),
        obsEntry(1, 'probe.count', [{ selector: 'div.old', matched: 9 }], 4)
      ] } }
    });
    await session.run();
    const dossier = calls[calls.length - 1].messages
      .filter((m) => m.role === 'system' && m.content.includes('EVIDENCE DOSSIER'))[0].content;
    const iLedger = dossier.indexOf('[SELECTOR LEDGER]');
    const iSkel = dossier.indexOf('[CONTAINER SKELETON]');
    assert.ok(iLedger !== -1, 'ledger section rides the dossier');
    assert.ok(iSkel !== -1, 'skeleton present');
    assert.ok(iLedger < iSkel, 'ledger sits BEFORE the container skeleton (spec §2 emphasis)');
    assert.match(dossier, /div\.stable → 4 matches[\s\S]{0,60}survives 2 epochs/, 'live survivor row');
    assert.match(dossier, /span\.dead → 0 matches \(verify\.run, epoch 2\)/, 'live dead row');
    assert.match(dossier, /\[epoch 1 — page reopened, stale\]/, 'stale layer header');
  });

  it('omits the section entirely when the ledger is empty', async () => {
    const calls = [];
    const session = createResearchSession({
      requirement: 'r',
      llm: scriptedLlm([reply(finishEnvelope())], calls),
      tools: {},
      epochOf: () => 1,
      dossierFeeds: { containerHtml: () => null, popovers: () => [], lastVerify: () => null }
    });
    await session.run();
    const dossier = calls[calls.length - 1].messages
      .filter((m) => m.role === 'system' && m.content.includes('EVIDENCE DOSSIER'))[0].content;
    assert.ok(!dossier.includes('[SELECTOR LEDGER]'), 'no empty header');
  });
});

// ---- methodology rule (spec §2: the rules route "read the ledger before
// writing any selector") ----

describe('ledger — authoring-first methodology rule', () => {
  it('the session prompt rules array carries the read-ledger-first rule as rule 11', () => {
    const ST = require('../lib/session-tools');
    const p = ST.buildDslContractPrompt();
    assert.match(p, /11\. Before writing ANY selector, read \[SELECTOR LEDGER\] in the dossier — PROVEN rows are reusable as-is; PROVEN-DEAD rows must not be retried unless their epoch is stale\./,
      'the binding rule text rides the methodology rules');
    assert.match(p, /# 3 Methodology \(11 rules\)/, 'the section header counts the new rule');
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
