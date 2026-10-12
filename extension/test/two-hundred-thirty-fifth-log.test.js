// extension/test/two-hundred-thirty-fifth-log.test.js
//
// 235th round (user directive, two items):
//   A. probe.census default samples 3 → 5 — feeds whose top cards are
//      recommendation modules starved the samples:3 census (top/middle/last
//      of a short window saw mostly recommendations).
//   B. The sub-tab diagnostics relay, end to end: the sub-tab executor's
//      selectorDiagnostics used to die in background's TAB_RESULT unwrap
//      (only envelope.result was sent) — verify's FAMILY_MISS/BLIND/census
//      detectors never saw $openTab-internal work (the 232nd round taught
//      around the gap; this fixes the channel):
//      background TAB_RESULT carries selectorDiagnostics → content-script
//      TAB_RESULT handler resolves the whole message → domOpenTab resolves
//      {__otResult235, __otDiags235} → the openTab DOM case attaches them
//      as _diagnostics → the sandbox harvests them into
//      __selectorDiagnostics__ → EXECUTE_RESULT → STEP_ITERATION events.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('A. census default samples = 5 (235th round)', () => {
  it('the default and the spec text', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'probe-tools.js'), 'utf8');
    const i = src.indexOf('235th round (user directive): default 5');
    assert.ok(i > -1);
    assert.match(src, /a\.samples\)\) : 5;/, 'default 5');
    const st = fs.readFileSync(path.join(__dirname, '..', 'lib', 'session-tools.js'), 'utf8');
    assert.match(st, /default 5/, 'spec documents the default');
  });
});

describe('B. the sub-tab diagnostics relay (235th round)', () => {
  const cs = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
  const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

  it('background TAB_RESULT carries the sub-tab selectorDiagnostics', () => {
    const i = bg.indexOf('235th round (user directive: relay the sub-tab diagnostics');
    assert.ok(i > -1, 'marker exists');
    const region = bg.slice(i, i + 500);
    assert.match(region, /selectorDiagnostics:\s*\(envelope/, 'the envelope diagnostics ride the message');
  });
  it('the content-script TAB_RESULT handler resolves the WHOLE message', () => {
    assert.match(cs, /pending\.resolve\(\{ __openTabMsg235: message \}\)/, 'the envelope is passed to domOpenTab');
  });
  it('domOpenTab resolves {__otResult235, __otDiags235} and returns its promise', () => {
    const i = cs.indexOf('resolveOpenTab235({ __otResult235:');
    assert.ok(i > -1, 'the internal resolution shape');
    const j = cs.indexOf('async function domOpenTab');
    const region = cs.slice(j, j + 3000);
    assert.match(region, /return p;/, 'the promise is returned (not dropped)');
    assert.match(region, /let resolveOpenTab235 = null;/, 'the resolver capture');
  });
  it('the openTab DOM case attaches the sub-tab diagnostics as _diagnostics', () => {
    const i = cs.indexOf('__otDiags235');
    const region = cs.slice(cs.indexOf("case 'openTab':"), cs.indexOf("case 'openTab':") + 1200);
    assert.match(region, /_diagnostics = \(_diagnostics \|\| \[\]\)\.concat\(__ot235\.__otDiags235\)/, 'the case handler merges them');
  });
  it('functional: domOpenTab surfaces the sub-tab diagnostics end-to-end', async () => {
    const chromeStub = { runtime: { sendMessage: () => Promise.resolve({ ack: true }) } };
    const listeners = [];
    const start = cs.indexOf('const openTabPending = new Map();');
    const fnStart = cs.indexOf('async function domOpenTab');
    const fnEnd = cs.indexOf('// ===== Script Execution =====');
    assert.ok(start > -1 && fnStart > -1 && fnEnd > fnStart);
    const header = cs.slice(start, fnStart);
    const fnBody = cs.slice(fnStart, fnEnd);
    const factory = eval('(function (chrome, listeners) { let currentSenderTabId = 11; ' + header + ' ' + fnBody + '\n return { domOpenTab: domOpenTab, openTabPending: openTabPending }; })');
    const api = factory(chromeStub, listeners);
    const p = api.domOpenTab('https://example.com/item', 'return 1;', null);
    // simulate exactly what the TAB_RESULT handler (235th) now does: resolve
    // the WHOLE message envelope for reqId 1
    const entry = api.openTabPending.get(1);
    assert.ok(entry, 'pending entry registered');
    entry.resolve({ __openTabMsg235: { type: 'TAB_RESULT', reqId: 1, result: { posts: [{ id: 'p1' }] }, selectorDiagnostics: [{ api: 'extractWithHover', hoverSummary: { anchorsFound: 3, hovercardsCaptured: 0 } }] } });
    const out = await p;
    assert.equal(out.__otResult235.posts[0].id, 'p1', 'the result rides the envelope');
    assert.equal(Array.isArray(out.__otDiags235), true, 'the sub-tab diagnostics ride the envelope');
    assert.equal(out.__otDiags235[0].api, 'extractWithHover', 'the diagnostics are the sub-tab executor row');
  });
});
