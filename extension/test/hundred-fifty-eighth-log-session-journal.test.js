// extension/test/hundred-fifty-eighth-log-session-journal.test.js
//
// 158th round — user-reported, three rounds of evidence (154/156/157):
// every captured console log (wizard page, service worker, offscreen —
// ALL THREE) showed the same amputation: the first ~13 minutes and the
// last few minutes survived while the middle hours vanished (157th: 152
// lines at 02:xx IDENTICAL across all three files, then a 4-hour gap,
// then the tail). The debug-logger is console-only BY DESIGN (the bugx
// cleanup removed its storage accumulation trusting DevTools capture),
// so the whole diagnostic trail depends on a manual DevTools save that
// demonstrably loses the middle of long sessions — exactly the turns
// where the model authors, verifies, and fails.
//
// Fix under test — the extension owns a durable rolling session journal
// with a one-click merged export:
//   A. lib/session-journal.js — append/cap/drop-oldest-with-marker,
//      session markers, injectable backend (chrome.storage.local by
//      default, memory in tests).
//   B. mirrorLines (the single funnel for every [session] console line)
//      journals every chunk it prints.
//   C. The service worker wraps debugLogger.log into a storage.session
//      ring and answers GET_DEBUG_JOURNAL.
//   D. wizard.html gains a Download Session Log button; the handler
//      merges the page journal with the SW journal and downloads a .log.
//   E. llm-client logContentChunks feeds an optional journal sink so the
//      full LLM bodies (86th-round directive) ride the journal too.
const { test, describe, it } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..');
const WJ = fs.readFileSync(path.join(EXT, 'wizard.js'), 'utf8');
const BG = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
const HTML = fs.readFileSync(path.join(EXT, 'wizard.html'), 'utf8');
const LLC = fs.readFileSync(path.join(EXT, 'lib', 'llm-client.js'), 'utf8');

describe('158th A — session journal unit', () => {
  const { createSessionJournal } = require('../lib/session-journal');

  function memBackend() {
    let store = [];
    return {
      load: async () => store.slice(),
      save: async (lines) => { store = lines.slice(); }
    };
  }

  it('appends entries with timestamps and round-trips through the backend', async () => {
    const j = createSessionJournal(memBackend(), { maxLines: 100, maxChars: 100000 });
    j.append('mirror', '[session] TOOL verify.run', '{}');
    j.append('mirror', '[session] TOOL RESULT verify.run ok', '{"ok":true}');
    await j.flush();
    const all = await j.all();
    assert.equal(all.length, 2);
    assert.ok(typeof all[0].t === 'number');
    assert.match(all[0].label, /TOOL verify\.run/);
  });

  it('caps the line count, dropping the OLDEST with a disclosure marker', async () => {
    const j = createSessionJournal(memBackend(), { maxLines: 5, maxChars: 1000000 });
    for (let i = 0; i < 9; i++) j.append('mirror', 'L' + i, 'x');
    await j.flush();
    const all = await j.all();
    const payload = all.filter((e) => e.kind !== 'marker');
    assert.ok(payload.length <= 5, 'cap holds at most 5 payload entries (marker may add one)');
    assert.ok(all.some((e) => /journal trimmed/i.test(String(e.label))), 'the drop is disclosed');
    assert.match(all[all.length - 1].label, /L8/, 'newest survives');
    assert.ok(!payload.some((e) => /^L0$/.test(String(e.label))), 'oldest dropped');
  });

  it('session markers ride the journal (start/resume boundaries survive reloads)', async () => {
    const j = createSessionJournal(memBackend(), { maxLines: 100, maxChars: 100000 });
    j.append('mirror', 'before', 'x');
    j.markSessionStart('sess-abc', true);
    j.append('mirror', 'after', 'y');
    const all = await j.all();
    const marker = all.find((e) => e.kind === 'marker');
    assert.ok(marker, 'marker entry present');
    assert.match(marker.label, /sess-abc/);
    assert.match(marker.label, /resume/i, 'the resumed flag rides the marker');
  });

  // 201st round (user question: "session log 是不是限制了条数还是长度？"):
  // the journal sat AT its 40MB cap and line-level trimming silently
  // fragmented the oldest sessions (~1.1k lines of 10-04 history gone,
  // a single orphaned "12 oldest line(s) dropped" marker the only trace —
  // earlier markers had themselves been trimmed). Trimming must be
  // SESSION-GRANULAR: drop the oldest WHOLE session with a marker naming
  // it, never fragment a session silently.
  it('over-cap drops the OLDEST WHOLE SESSION with a marker naming it — sessions are never fragmented', async () => {
    const j = createSessionJournal(memBackend(), { maxLines: 7, maxChars: 100000 });
    j.markSessionStart('rs-old', false);
    for (let i = 0; i < 5; i++) j.append('mirror', 'old-' + i, 'x');
    j.markSessionStart('rs-new', false);
    for (let i = 0; i < 5; i++) j.append('mirror', 'new-' + i, 'y');
    await j.flush();
    const all = await j.all();
    const labels = all.map((e) => String(e.label));
    assert.ok(!labels.some((l) => /=== SESSION rs-old/.test(l)), 'the over-cap oldest session start marker is gone');
    assert.ok(labels.some((l) => /=== SESSION rs-new/.test(l)), 'the newest session start survives whole');
    assert.ok(!labels.some((l) => /^old-\d$/.test(l)), 'no orphaned lines of the dropped session remain');
    assert.ok(labels.some((l) => /journal trimmed/i.test(l) && /rs-old/.test(l)), 'the trim marker NAMES the dropped session');
    assert.ok(labels.some((l) => /^new-4$/.test(l)), 'newest payload survives');
  });

  it('a SINGLE session larger than the cap falls back to line-level trim inside it (still disclosed)', async () => {
    const j = createSessionJournal(memBackend(), { maxLines: 4, maxChars: 100000 });
    j.markSessionStart('rs-solo', false);
    for (let i = 0; i < 9; i++) j.append('mirror', 's-' + i, 'x');
    const all = await j.all();
    const payload = all.filter((e) => e.kind !== 'marker');
    assert.ok(payload.length <= 4, 'cap holds');
    assert.ok(all.some((e) => /journal trimmed/i.test(String(e.label))), 'line-level fallback still disclosed');
    assert.match(all[all.length - 1].label, /s-8/, 'newest survives');
  });

  it('char-cap triggers the same session-granular trim (running total, no per-append full scan)', async () => {
    const j = createSessionJournal(memBackend(), { maxLines: 100000, maxChars: 45 });
    j.markSessionStart('rs-a', false);
    j.append('mirror', 'a-1', 'xxxxx'); // session A alone: 26+8 = 34 <= 45 (fits while alone)
    j.markSessionStart('rs-b', false);
    j.append('mirror', 'b-1', 'yyyyy'); // combined > 45 → drop session A WHOLE
    await j.flush();
    const all = await j.all();
    const labels = all.map((e) => String(e.label));
    assert.ok(!labels.some((l) => /=== SESSION rs-a/.test(l)), 'char over-cap drops the oldest whole session');
    assert.ok(labels.some((l) => /=== SESSION rs-b/.test(l)), 'newest session survives');
    assert.ok(labels.some((l) => /journal trimmed/i.test(l) && /rs-a/.test(l)), 'marker names rs-a');
  });

  it('201st round: defaults are raised for unlimitedStorage — 200k lines / 150MB chars', async () => {
    const src = fs.readFileSync(path.join(EXT, 'lib', 'session-journal.js'), 'utf8');
    assert.match(src, /DEFAULT_MAX_LINES\s*=\s*(\d{5,})/, 'line cap raised (was 40000)');
    assert.ok(Number(/DEFAULT_MAX_LINES\s*=\s*(\d+)/.exec(src)[1]) >= 100000, '>= 100k lines');
    assert.ok(Number(/DEFAULT_MAX_CHARS\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(src)[1]) >= 100, '>= 100MB chars (was 40MB)');
  });

  it('211th round: __hydrate recomputes char totals — an over-cap preloaded backend trims on the NEXT append', async () => {
    // Without recomputeTotals inside __hydrate, charTotal stays 0 after
    // hydration and the char cap never fires until the buffer is rescanned.
    const stored = [];
    for (let i = 0; i < 10; i++) stored.push({ t: 1, kind: 'mirror', label: 'L' + i, text: 'x'.repeat(60) });
    const backend = { load: async () => stored.slice(), save: async () => {} };
    const j = createSessionJournal(backend, { maxLines: 100000, maxChars: 500 });
    j.__hydrate(stored);
    j.append('mirror', 'after', 'y');
    const all = await j.all();
    assert.ok(all.length < 11 || all.some((e) => /journal trimmed/i.test(String(e.label))),
      'char-cap trim fired post-hydration (recomputeTotals in __hydrate), got ' + all.length + ' lines');
  });
});

describe('211th round — flush-failure honesty + fresher-wins all()', () => {
  const { createSessionJournal } = require('../lib/session-journal');

  it('a rejecting backend: flush RESOLVES (never throws) and warns on the FIRST failure only', async () => {
    const warns = [];
    const origWarn = console.warn;
    console.warn = function () { warns.push(Array.from(arguments)); };
    try {
      const backend = { load: async () => [], save: async () => { throw new Error('quota exceeded'); } };
      const j = createSessionJournal(backend, { maxLines: 10, maxChars: 100000, flushDebounceMs: 0 });
      j.append('mirror', 'a', 'x');
      await j.flush();
      await j.flush();
      const flushWarns = warns.filter((w) => /\[session-journal\] flush failed/.test(String(w[0])));
      assert.equal(flushWarns.length, 1, 'exactly one warn across two failures, got ' + flushWarns.length);
      assert.match(String(flushWarns[0][1] || ''), /quota/, 'the error rides the warn');
    } finally {
      console.warn = origWarn;
    }
  });

  it('all() keeps the FRESHER in-memory buffer when the store is shorter/stale', async () => {
    const stored = [{ t: 1, kind: 'mirror', label: 'only-stale', text: 's' }];
    const backend = { load: async () => stored.slice(), save: async () => {} };
    const j = createSessionJournal(backend, { maxLines: 100, maxChars: 100000 });
    j.append('mirror', 'l1', 'a');
    j.append('mirror', 'l2', 'b');
    j.append('mirror', 'l3', 'c');
    const all = await j.all();
    assert.equal(all.length, 3, 'in-memory (3 lines, fresher) wins over stored (1 line, stale)');
  });
});

describe('158th B — mirrorLines journals every chunk it prints', () => {
  it('the wizard mirror funnel feeds the journal (source audit)', () => {
    const i = WJ.indexOf('function mirrorLines(');
    assert.ok(i > -1);
    const body = WJ.slice(i, WJ.indexOf('function handleSessionEvent', i));
    assert.match(body, /SessionJournal\.append|journalAppend\(/, 'the funnel journals');
    const ci = body.indexOf('console.log(');
    const ji = body.indexOf('SessionJournal.append');
    assert.ok(ci > -1 && ji > -1, 'both console and journal paths present');
  });

  it('session_start marks the journal with the sessionId (source audit)', () => {
    const i = WJ.indexOf("case 'session_start':");
    assert.ok(i > -1);
    const block = WJ.slice(i, i + 1200);
    assert.match(block, /markSessionStart|markJournalSession/, 'the session boundary is journaled');
  });
});

describe('158th C — service worker debug journal', () => {
  it('debugLogger is wrapped into a storage.session ring (source audit)', () => {
    assert.match(BG, /swDebugJournal|SW_DEBUG_JOURNAL_KEY/, 'a SW journal key exists');
    assert.match(BG, /chrome\.storage\.session/, 'persisted in storage.session (survives SW suspension)');
    assert.match(BG, /debugLogger\.log =/, 'the logger is wrapped (no call-site changes needed)');
  });

  it('GET_DEBUG_JOURNAL answers with the ring', () => {
    assert.match(BG, /GET_DEBUG_JOURNAL/, 'the export message type exists');
    const i = BG.indexOf("'GET_DEBUG_JOURNAL'");
    const block = BG.slice(i, i + 800);
    assert.match(block, /sendResponse/, 'responds with the journal');
  });

  // 211th review F9: 20k lines x 4000 chars can exceed the storage.session
  // quota — the ring needs a byte budget with head-trim, and a flush failure
  // must surface once instead of being swallowed.
  it('the ring carries a byte budget with head-trim and warns on flush failure (source audit)', () => {
    const i = BG.indexOf('SW_DEBUG_JOURNAL_MAX');
    assert.ok(i > -1, 'ring code found');
    const wrapAt = BG.indexOf('wrapDebugLoggerWithJournal', i);
    const ring = BG.slice(i, BG.indexOf('})();', wrapAt));
    assert.match(ring, /SW_DEBUG_JOURNAL_BYTE_BUDGET/, 'a byte-budget constant exists');
    assert.match(ring, /8000000/, 'budget is 8MB (under the 10MB storage.session quota)');
    assert.match(ring, /swDebugRingBytes/, 'an approximate running byte total is tracked');
    assert.match(ring, /while \(swDebugRingBytes > SW_DEBUG_JOURNAL_BYTE_BUDGET/, 'a trim loop brings the ring back under budget');
    assert.match(ring, /sw ring over byte budget/, 'the trim discloses how many lines it dropped');
    const flush = BG.slice(BG.indexOf('function swDebugJournalFlush'), BG.indexOf('function swDebugJournalFlush') + 900);
    assert.match(flush, /chrome\.runtime\.lastError/, 'a flush failure is checked');
    assert.match(flush, /swDebugFlushWarned/, 'the warning fires once, not per flush');
  });
});

describe('158th D — one-click merged export', () => {
  it('the wizard has a Download Session Log button', () => {
    assert.match(HTML, /btnDownloadSessionLog/, 'button id present');
    assert.match(HTML, /Download Session Log/i, 'label present');
  });

  it('the handler merges the page journal with the SW journal and downloads (source audit)', () => {
    const i = WJ.indexOf('btnDownloadSessionLog');
    assert.ok(i > -1, 'handler wiring exists');
    const block = WJ.slice(i, i + 2500);
    assert.match(block, /GET_DEBUG_JOURNAL/, 'fetches the SW journal');
    assert.match(block, /Blob\(/, 'builds a file');
    assert.match(block, /download/, 'triggers a download');
  });
});

describe('158th E — llm-client full bodies ride the journal', () => {
  it('logContentChunks feeds the optional journal sink', () => {
    const i = LLC.indexOf('function logContentChunks');
    const body = LLC.slice(i, i + 900);
    assert.match(body, /__scrapewrightJournalSink|journalSink/, 'an optional sink hook exists');
  });
});
