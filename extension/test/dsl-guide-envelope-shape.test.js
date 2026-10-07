// 201st round phrase-pins: the $extractWithHover return-shape teaching must
// stay coherent everywhere the model reads it. History: the 88th/92nd/200th
// incidents all had step scripts treating the result as an envelope
// ({records:[...]} wrapper expectations, {partial}-stub reads); the 201st
// relay fix made the annotations enumerable so they survive the sandbox
// hops. These pins guard the WORDING: the guide must teach the array return
// with zero wrapper examples, and the research-session contract entry must
// state the shape and contrast probe.extract's envelope.
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SCRIPT_DSL_GUIDE } = require('../lib/wizard-utils');
const ST = require('../lib/session-tools');

function hoverSection(guide) {
  const s = guide.indexOf('EXTRACT-WITH-HOVER (');
  assert.ok(s !== -1, 'EXTRACT-WITH-HOVER section exists in the DSL guide');
  const e = guide.indexOf('SCROLL-COLLECT RELIABILITY:', s);
  return guide.slice(s, e > s ? e : guide.length);
}

describe('201st round: SCRIPT_DSL_GUIDE $extractWithHover return shape', () => {
  it('teaches the array return and forbids the wrapper expectation', () => {
    assert.match(SCRIPT_DSL_GUIDE, /RETURNS THE RECORDS ARRAY ITSELF/,
      'the shape line teaches the array return');
    assert.match(SCRIPT_DSL_GUIDE, /NEVER expect \{records:\[\.\.\.\]\}/,
      'the wrapper-object expectation is explicitly forbidden');
  });

  it('hover section carries no partial-envelope wrapper wording or example', () => {
    const sec = hoverSection(SCRIPT_DSL_GUIDE);
    assert.ok(!/resolves to the partial envelope/.test(sec),
      'the old partial-envelope wrapper sentence must stay gone (200th-round contradiction)');
    assert.ok(!/\{ records: \[/.test(sec),
      'no literal "{ records: [" wrapper example may return to the section');
    // The replacement teaching must actually be present.
    assert.match(sec, /rs\.partial/, 'the rs.partial budget-hit disclosure is named');
    assert.match(sec, /rs\.partial is undefined/, 'the all-fit case is stated');
    assert.match(sec, /containerRange:\[K,N\]/, 'the resume route stays');
  });
});

describe('201st round: session-tools contract entry states the return shape', () => {
  it('carries the returns-the-array clause and the probe-contrast sentence', () => {
    const base = ST.buildDslContractPrompt();
    const line = (base.match(/\$extractWithHover\([^\n]*/) || [])[0] || '';
    assert.ok(line, 'the $extractWithHover contract entry exists');
    assert.match(line, /returns the records ARRAY itself/,
      'returns-the-array clause present');
    assert.match(line, /probe\.extract's \{total,records\} envelope is the PROBE's shape, never the primitive's/,
      'probe-contrast sentence present');
    assert.match(line, /do not write r\.records/,
      'the envelope-style read is explicitly forbidden');
  });
});
