// extension/lib/observation-log.js
//
// Observation receipts for a research session (2026-09-01 research-session
// architecture, spec §8). Every probe result is recorded here with the
// selector strings and attribute names it actually observed. The grounding
// gate consults this log as the PRIMARY receipt source: a selector entering
// the service artifact must have been observed in this session (or carry a
// ledger/annotation/override receipt instead).
//
// Coverage semantics are deliberately EXACT-STRING: if the session observed
// "div[role='feed']" that does NOT cover the derived compound
// "div[role='feed'] div[role='article']" — derived selectors go through the
// gate's cheap auto-verify probe instead. Exact matching keeps the receipt
// check deterministic and auditable; any fuzziness would let a guessed
// selector ride in on a similar observed one.
//
// Pure module: no DOM, no chrome.*, no IO. IIFE-wrapped per RC30.

(function (global) {

  function createObservationLog(initial) {
    const seed = initial && typeof initial === 'object' ? initial : {};
    const entries = Array.isArray(seed.entries) ? seed.entries.map(sanitizeEntry) : [];
    let seq = typeof seed.seq === 'number' ? seed.seq : entries.length;

    function sanitizeEntry(raw) {
      const e = raw && typeof raw === 'object' ? raw : {};
      return {
        id: typeof e.id === 'number' ? e.id : 0,
        tool: typeof e.tool === 'string' ? e.tool : 'unknown',
        selectors: Array.isArray(e.selectors)
          ? e.selectors.filter(s => typeof s === 'string' && s.length > 0)
          : [],
        attrs: Array.isArray(e.attrs)
          ? e.attrs
              .filter(a => a && typeof a === 'object' && typeof a.attr === 'string' && a.attr.length > 0)
              .map(a => ({ selector: typeof a.selector === 'string' ? a.selector : '', attr: a.attr }))
          : [],
        summary: typeof e.summary === 'string' ? e.summary : '',
        at: typeof e.at === 'number' ? e.at : 0,
        epoch: (typeof e.epoch === 'number') ? e.epoch : null,
        // Session-memory write path (2026-10-13 spec §3.1): structured
        // per-selector outcomes [{selector, matched}] — the raw material of
        // the SELECTOR LEDGER. Whitelist-validated row-wise: a polluted row
        // is dropped on its own, never takes the entry down, and old seeds
        // without the field pass through as []. Zeros are VALID rows — a
        // family measured dead is as valuable as one measured alive.
        outcomes: Array.isArray(e.outcomes)
          ? e.outcomes
              .filter(o => o && typeof o === 'object' && typeof o.selector === 'string' && o.selector.length > 0 && typeof o.matched === 'number' && isFinite(o.matched) && o.matched >= 0)
              .map(o => ({ selector: o.selector, matched: Math.floor(o.matched) }))
          : []
      };
    }

    function record(obs) {
      const e = sanitizeEntry({
        id: seq + 1,
        tool: obs && obs.tool,
        selectors: obs && obs.selectors,
        attrs: obs && obs.attrs,
        summary: obs && obs.summary,
        epoch: obs && obs.epoch,
        outcomes: obs && obs.outcomes,
        at: Date.now()
      });
      seq += 1;
      entries.push(e);
      return sanitizeEntry(e);
    }

    // Read accessor for the dossier's [SELECTOR LEDGER] section (and tests):
    // the last n entries in chronological order (oldest first), mirroring
    // serialize()'s entry order. Sanitized copies — callers can never mutate
    // the log through a returned entry.
    function recent(n) {
      const take = (typeof n === 'number' && n >= 0) ? Math.floor(n) : entries.length;
      return entries.slice(Math.max(0, entries.length - take)).map(sanitizeEntry);
    }

    // C3: when `epoch` is a number, only receipts recorded in exactly that
    // page epoch count — a reload of the research tab must invalidate every
    // earlier DOM observation. Non-number epoch (legacy callers) filters
    // nothing.
    function covers(selector, epoch) {
      if (typeof selector !== 'string' || !selector) return false;
      for (const e of entries) {
        if (e.selectors.indexOf(selector) === -1) continue;
        if (typeof epoch === 'number' && e.epoch !== epoch) continue;
        return true;
      }
      // Twenty-sixth log: a model writing div[role="none"] was rejected
      // against a probe.hover receipt that recorded div[role='none'] — the
      // SAME CSS selector, differing only in attribute-value quote style.
      // CSS treats both quote styles identically, so a quote-only
      // difference is not an unobserved selector. Fold single quotes to
      // double on both sides as a fallback; everything else stays
      // exact-match.
      const folded = selector.replace(/'/g, '"');
      for (const e of entries) {
        if (typeof epoch === 'number' && e.epoch !== epoch) continue;
        for (const s of e.selectors) {
          if (s !== selector && s.replace(/'/g, '"') === folded) return true;
        }
      }
      return false;
    }

    function coversAttr(attr, epoch) {
      if (typeof attr !== 'string' || !attr) return false;
      for (const e of entries) {
        if (typeof epoch === 'number' && e.epoch !== epoch) continue;
        for (const a of e.attrs) {
          if (a.attr === attr) return true;
        }
      }
      return false;
    }

    function size() { return entries.length; }

    function serialize() {
      return { entries: entries.map(sanitizeEntry), seq: seq };
    }

    return { record, covers, coversAttr, size, serialize, recent };
  }

  const api = { createObservationLog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ObservationLogLib = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : self));
