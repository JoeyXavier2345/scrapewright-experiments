// lib/session-journal.js
//
// 158th round: three consecutive sessions (154/156/157) lost the middle
// hours of EVERY manual console capture — wizard page, service worker,
// and offscreen amputated identically (head minutes + tail minutes
// survived). The debug-logger is console-only by design, so the whole
// diagnostic trail trusted a DevTools save that demonstrably drops the
// turns where the model authors, verifies, and fails.
//
// This journal is the extension-owned replacement: a durable rolling
// buffer of every [session] mirror line (plus optional LLM bodies),
// persisted through page reloads (chrome.storage.local — the manifest
// carries unlimitedStorage) and exportable with one click merged with
// the service-worker ring (GET_DEBUG_JOURNAL).
//
// The backend is injectable: the default uses chrome.storage.local when
// present; tests pass an in-memory backend. Append is synchronous
// (in-memory array); flush is debounced and best-effort — losing the
// last debounce window to a hard reload is acceptable, losing four
// hours is not.

const JOURNAL_STORAGE_KEY = 'sessionJournalRolling';
// 201st round (user: "session log 是不是限制了条数还是长度？"): the journal
// sat AT the 40MB/40k cap and line-level trimming silently fragmented the
// oldest sessions — ~1.1k lines of 10-04 history vanished from an export
// with one orphaned "12 oldest line(s) dropped" marker the only trace
// (earlier markers had themselves been trimmed). The manifest carries
// unlimitedStorage, so the caps now hold whole-session histories for
// months; trimming is SESSION-GRANULAR (drop the oldest whole session,
// named in the marker) and only falls back to line-level when a single
// session alone exceeds the cap.
const DEFAULT_MAX_LINES = 200000;
const DEFAULT_MAX_CHARS = 150 * 1024 * 1024;
const BIG_JOURNAL_FLUSH_DEBOUNCE_MS = 30000;
const BIG_JOURNAL_THRESHOLD_CHARS = 20 * 1024 * 1024;
// 211st-round review: flush failures were swallowed entirely — warn once
// per module lifetime so a persistently broken backend is at least visible.
let failedFlushCount = 0;

function createSessionJournal(backend, opts) {
  const o = opts || {};
  const maxLines = typeof o.maxLines === 'number' ? o.maxLines : DEFAULT_MAX_LINES;
  const maxChars = typeof o.maxChars === 'number' ? o.maxChars : DEFAULT_MAX_CHARS;
  let lines = null; // null = not yet loaded
  let flushTimer = null;
  // Running totals — recomputed only on wholesale hydration; append/shift
  // keep them current so trimming never rescans the whole buffer (the old
  // totalChars() walk made every append O(n) — quadratic across a session).
  let charTotal = 0;

  function entryChars(e) {
    return (e.text || '').length + (e.label || '').length;
  }
  function recomputeTotals(arr) {
    let n = 0;
    for (let i = 0; i < arr.length; i++) n += entryChars(arr[i]);
    charTotal = n;
  }
  function isOverCap() {
    return lines.length > maxLines || charTotal > maxChars;
  }
  function isSessionStart(e) {
    return e && e.kind === 'marker' && String(e.label || '').indexOf('=== SESSION ') === 0;
  }

  function trimInPlace() {
    // Session-granular pass: while over cap AND at least two sessions are
    // present, drop everything before the SECOND-oldest session start (the
    // oldest session whole, plus any pre-session noise).
    let droppedSessions = 0;
    let droppedLines = 0;
    let lastNameDropped = '';
    for (;;) {
      if (!isOverCap()) break;
      let secondIdx = -1;
      let firstIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (!isSessionStart(lines[i])) continue;
        if (firstIdx === -1) { firstIdx = i; continue; }
        secondIdx = i;
        break;
      }
      // Need a session we can drop whole AND a surviving session after it.
      if (secondIdx === -1 || secondIdx <= firstIdx) break;
      lastNameDropped = String(lines[firstIdx].label || '').replace(/^=== SESSION (\S+) START.*===$/, '\$1') || '(unnamed)';
      for (let i = 0; i < secondIdx; i++) {
        charTotal -= entryChars(lines[i]);
        droppedLines += 1;
      }
      lines.splice(0, secondIdx);
      droppedSessions += 1;
    }
    // Line-level fallback: a single session alone exceeds the cap.
    let lineDropped = 0;
    while (isOverCap() && lines.length > 1) {
      charTotal -= entryChars(lines[0]);
      lines.shift();
      lineDropped += 1;
    }
    if (droppedSessions > 0) {
      lines.unshift({ t: Date.now(), kind: 'marker',
        label: '[journal trimmed: dropped ' + droppedSessions + ' whole session(s) (' + droppedLines + ' line(s), oldest ' + (lastNameDropped || '(unnamed)') + ') — session-granular, nothing fragmented]',
        text: '' });
    } else if (lineDropped > 0) {
      lines.unshift({ t: Date.now(), kind: 'marker',
        label: '[journal trimmed: ' + lineDropped + ' oldest line(s) dropped — a single session exceeds the cap]',
        text: '' });
    }
  }

  function ensureLoaded() {
    if (lines === null) { lines = []; charTotal = 0; }
  }

  function scheduleFlush() {
    if (flushTimer !== null) return;
    // Adaptive debounce: a 100MB+ array serialized every 2s would dominate
    // the page; big journals flush on a slower cadence (losing the last
    // window to a hard reload stays acceptable — losing hours does not).
    const debounce = (o.flushDebounceMs != null)
      ? o.flushDebounceMs
      : (charTotal > BIG_JOURNAL_THRESHOLD_CHARS ? BIG_JOURNAL_FLUSH_DEBOUNCE_MS : 2000);
    flushTimer = setTimeout(function () {
      flushTimer = null;
      flush();
    }, debounce);
  }

  function flush() {
    if (lines === null || !backend) return Promise.resolve();
    return backend.save(lines.slice()).catch(function (err) {
      // best-effort persistence — the in-memory journal stays authoritative
      failedFlushCount += 1;
      if (failedFlushCount === 1) {
        console.warn('[session-journal] flush failed — the in-memory journal is authoritative until a successful write', err);
      }
    });
  }

  return {
    __hydrate: function (stored) {
      if (Array.isArray(stored) && (lines === null || stored.length >= lines.length)) {
        lines = stored.slice();
        recomputeTotals(lines);
      }
    },
    append: function (kind, label, text) {
      ensureLoaded();
      lines.push({ t: Date.now(), kind: kind || 'mirror', label: String(label || ''), text: String(text == null ? '' : text) });
      charTotal += entryChars(lines[lines.length - 1]);
      trimInPlace();
      scheduleFlush();
    },
    markSessionStart: function (sessionId, resumed) {
      this.append('marker', '=== SESSION ' + String(sessionId) + ' START' + (resumed ? ' (resumed)' : '') + ' ===', '');
      flush();
    },
    all: function () {
      if (lines === null) { lines = []; charTotal = 0; }
      if (backend) return backend.load().then(function (stored) {
        if (Array.isArray(stored) && stored.length >= lines.length) {
          lines = stored;
          recomputeTotals(lines);
        } else if (Array.isArray(stored) && stored.length < lines.length && lines.length > 0) {
          // fresher-wins: a shorter store is stale (e.g. after a failed
          // flush) — keep the in-memory copy, disclose the mismatch.
          console.warn('[session-journal] all(): stored journal (' + stored.length + ' line(s)) is shorter than the in-memory buffer (' + lines.length + ') — keeping the fresher in-memory copy');
        }
        return lines.slice();
      }).catch(function () { return lines.slice(); });
      return Promise.resolve(lines.slice());
    },
    flush: flush
  };
}

function createChromeStorageBackend() {
  const area = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
  if (!area) return null;
  return {
    load: function () {
      return new Promise(function (resolve) {
        try {
          area.get(JOURNAL_STORAGE_KEY, function (res) {
            resolve(Array.isArray(res && res[JOURNAL_STORAGE_KEY]) ? res[JOURNAL_STORAGE_KEY] : []);
          });
        } catch (e) { resolve([]); }
      });
    },
    save: function (lines) {
      return new Promise(function (resolve, reject) {
        try {
          const bag = {};
          bag[JOURNAL_STORAGE_KEY] = lines;
          area.set(bag, function () {
            if (chrome.runtime && chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
          });
        } catch (e) { reject(e); }
      });
    }
  };
}

// Wizard page instance: load the persisted journal on boot so a reload
// (or a resumed session) continues the same rolling buffer.
function initDefaultSessionJournal() {
  const backend = createChromeStorageBackend();
  const j = createSessionJournal(backend || undefined);
  if (backend) {
    backend.load().then(function (stored) {
      // Hydration happens lazily on first append/all via the backend;
      // eager-load here so all() reflects history immediately.
      j.__hydrate(stored || []);
    }).catch(function () { /* best-effort */ });
  }
  return j;
}

const mod = {
  createSessionJournal: createSessionJournal,
  createChromeStorageBackend: createChromeStorageBackend,
  initDefaultSessionJournal: initDefaultSessionJournal,
  JOURNAL_STORAGE_KEY: JOURNAL_STORAGE_KEY
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = mod;
} else if (typeof window !== 'undefined') {
  window.SessionJournalMod = mod;
} else if (typeof self !== 'undefined') {
  self.SessionJournalMod = mod;
}
