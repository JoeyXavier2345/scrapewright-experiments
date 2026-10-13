// extension/lib/selector-ledger-render.js
//
// [SELECTOR LEDGER] renderer — session-memory architecture (2026-10-13
// spec §3.2, plan Task 2; the §3.3 update-time dead-family WARNING matcher
// lives here too — the ledger's home). The READ path of the
// validated-facts ledger:
// aggregates the observation log's structured `outcomes` rows (the write
// path landed with the same spec) into epoch-layered PROVEN / PROVEN-DEAD
// families that the evidence dossier injects EVERY turn, BEFORE the
// container skeleton. The ledger's primary job is the MODEL'S PER-TURN
// VISIBILITY (the transcription-loss fix): a family this session measured
// alive must never be re-guessed, and one measured dead must never be
// retried — unless the page epoch moved and the measurement is stale.
//
// Semantics (spec §3.2 + MA1 review note):
//   - per selector, MAX matched wins: a selector the verify field census
//     measured 0 INSIDE containers but pageWide n>0 elsewhere is PROVEN,
//     not dead.
//   - 254th review (#7): when the winning observation carries the
//     pageWide scope tag AND an inside-containers 0 exists at the same
//     selector+epoch, the row renders with the "N matches page-wide,
//     0 INSIDE containers" caveat instead of plain PROVEN reuse — the
//     count is a page-wide fact, not a card-scoped binding. Legacy
//     scope-less outcomes keep the plain rendering.
//   - PROVEN rows sort by cross-epoch survivor count desc (a family that
//     survived a page reload is the session's most-trusted measurement),
//     then matched desc; ≤8 rows, survivor count disclosed on the row.
//   - PROVEN-DEAD rows (max matched === 0 in the current epoch) ≤6 rows,
//     tool named.
//   - selectors whose ONLY observations predate the current epoch render
//     under their own `[epoch N — page reopened, stale]` layer and never
//     mix into the live groups; a survivor renders ONCE (live) — old
//     epochs only credit its survivor count.
//   - counts are deliberately UNIT-LESS (`→ N matches`): census coverage
//     numerators (k of n sampled docs) and element counts are mixed
//     across tools, and a unit word would lie about one of them.
//   - overflow trims whole stale layers oldest-first, then dead rows from
//     the oldest current-epoch observations; every dropped row (including
//     cap-dropped ones) is disclosed at the tail — never silent
//     (76th-round discipline).
//   - empty ledger → '' (the dossier omits the section entirely).
//
// Pure module: no DOM, no chrome.*, no IO. IIFE-wrapped per RC30.

(function (global) {

  const DEFAULT_BUDGET_CHARS = 800;
  const PROVEN_MAX_ROWS = 8;
  const DEAD_MAX_ROWS = 6;
  const SELECTOR_MAX_CHARS = 80;
  // Aggregation window over the observation log (the log itself grows
  // unbounded across a long session; families measured hundreds of
  // receipts ago and never again are noise, and O(n) stays O(n)).
  const ENTRY_WINDOW = 300;

  function truncSel(s) {
    const t = String(s == null ? '' : s);
    return t.length <= SELECTOR_MAX_CHARS ? t : t.slice(0, SELECTOR_MAX_CHARS - 1) + '…';
  }

  function famRow(fam, survivorCount) {
    const ep = (typeof fam.epoch === 'number') ? fam.epoch : '?';
    // 254th review (#7, partial defensible): when the WINNING observation is
    // a pageWide-tagged count AND the same selector+epoch measured 0 INSIDE
    // the processed containers, the row must NOT read as plain PROVEN
    // "reuse as-is" — the count is a page-wide fact; a card-scoped binding
    // needs re-scoping. Legacy scope-less rows keep the plain rendering.
    let line;
    if (fam.winScope === 'pageWide' && fam.zeroEpochs && fam.zeroEpochs.has(fam.epoch)) {
      line = '- ' + truncSel(fam.selector) + ' → ' + fam.maxMatched + ' matches page-wide, 0 INSIDE containers (' + fam.tool + ', epoch ' + ep + ')';
    } else {
      line = '- ' + truncSel(fam.selector) + ' → ' + fam.maxMatched + ' matches (' + fam.tool + ', epoch ' + ep + ')';
    }
    if (survivorCount > 1) line += ' — survives ' + survivorCount + ' epochs';
    return line;
  }

  function bySel(a, b) { return a.selector < b.selector ? -1 : (a.selector > b.selector ? 1 : 0); }

  function renderSelectorLedger(entries, currentEpoch, budgetChars) {
    const budget = (typeof budgetChars === 'number' && budgetChars > 0) ? budgetChars : DEFAULT_BUDGET_CHARS;
    const list = Array.isArray(entries) ? entries : [];
    const hasCurrent = typeof currentEpoch === 'number';

    const live = new Map();          // selector -> family (current epoch)
    const staleByEpoch = new Map();  // epoch number -> Map(selector -> family)
    const epochsBySelector = new Map(); // selector -> Set(epoch numbers it was measured under)

    for (const e of list) {
      if (!e || !Array.isArray(e.outcomes)) continue;
      const tool = String(e.tool || 'unknown');
      const at = (typeof e.at === 'number') ? e.at : 0;
      for (const o of e.outcomes) {
        if (!o || typeof o.selector !== 'string' || !o.selector) continue;
        const matched = (typeof o.matched === 'number' && isFinite(o.matched) && o.matched >= 0) ? Math.floor(o.matched) : 0;
        // Live = current epoch. Legacy null-epoch rows are epoch-agnostic
        // (C3: they can never be marked stale) → live. Every other numeric
        // epoch layers under its own (older) epoch.
        const isLive = hasCurrent ? (e.epoch === currentEpoch || e.epoch == null) : true;
        let bucket;
        if (isLive) {
          bucket = live;
        } else {
          if (!staleByEpoch.has(e.epoch)) staleByEpoch.set(e.epoch, new Map());
          bucket = staleByEpoch.get(e.epoch);
        }
        let fam = bucket.get(o.selector);
        if (!fam) {
          fam = { selector: o.selector, maxMatched: -1, tool: tool, epoch: e.epoch, lastAt: at, winScope: null, zeroEpochs: new Set() };
          bucket.set(o.selector, fam);
        }
        // 254th review (#7): track WHERE the zero measurements live (by
        // epoch) and whether the winning observation was a pageWide count.
        if (matched === 0) fam.zeroEpochs.add(e.epoch);
        // MAX matched wins (MA1 review note) — the winning observation
        // names the tool and epoch the row renders.
        if (matched > fam.maxMatched) {
          fam.maxMatched = matched;
          fam.tool = tool;
          fam.epoch = e.epoch;
          fam.winScope = (o.scope === 'pageWide') ? 'pageWide' : null;
        }
        fam.lastAt = Math.max(fam.lastAt, at);
        if (typeof e.epoch === 'number') {
          if (!epochsBySelector.has(o.selector)) epochsBySelector.set(o.selector, new Set());
          epochsBySelector.get(o.selector).add(e.epoch);
        }
      }
    }

    // Stale layers: NEWEST-stale first (closest to current evidence), so
    // the tail IS the oldest layer — the trim loop pops the tail. A
    // selector that also has live observations is EXCLUDED here: it
    // already renders in the live group; the old epoch only credits its
    // survivor count.
    const layerList = [];
    for (const ep of Array.from(staleByEpoch.keys()).sort((x, y) => y - x)) {
      const fams = [];
      for (const fam of staleByEpoch.get(ep).values()) {
        if (!live.has(fam.selector)) fams.push(fam);
      }
      if (!fams.length) continue;
      fams.sort((a, b) => (b.maxMatched - a.maxMatched) || bySel(a, b));
      layerList.push({
        epoch: ep,
        rows: fams.length,
        text: '[epoch ' + ep + ' — page reopened, stale]\n' +
          fams.map((f) => famRow(f, (epochsBySelector.get(f.selector) || new Set()).size)).join('\n')
      });
    }

    const provenAll = [];
    const deadAll = [];
    for (const fam of live.values()) (fam.maxMatched > 0 ? provenAll : deadAll).push(fam);
    if (!provenAll.length && !deadAll.length && !layerList.length) return '';

    const survivors = (sel) => {
      const s = epochsBySelector.get(sel);
      return s ? s.size : 1;
    };
    provenAll.sort((a, b) => (survivors(b.selector) - survivors(a.selector)) || (b.maxMatched - a.maxMatched) || bySel(a, b));
    // Dead rows: most-recent measurement first, so the tail is the OLDEST
    // current-epoch observation — exactly what overflow trims first.
    deadAll.sort((a, b) => (b.lastAt - a.lastAt) || bySel(a, b));

    let trimmedRows = Math.max(0, provenAll.length - PROVEN_MAX_ROWS) + Math.max(0, deadAll.length - DEAD_MAX_ROWS);
    const provLines = provenAll.slice(0, PROVEN_MAX_ROWS).map((f) => famRow(f, survivors(f.selector)));
    const deadLines = deadAll.slice(0, DEAD_MAX_ROWS).map((f) => famRow(f, 1));

    const HEADER = '[SELECTOR LEDGER]';
    const PROVEN_HEAD = 'PROVEN — validated this epoch (reuse as-is):';
    const DEAD_HEAD = 'PROVEN-DEAD — measured 0 this epoch (do not re-probe):';

    const build = () => {
      const parts = [HEADER];
      if (provLines.length) parts.push(PROVEN_HEAD + '\n' + provLines.join('\n'));
      if (deadLines.length) parts.push(DEAD_HEAD + '\n' + deadLines.join('\n'));
      for (const L of layerList) parts.push(L.text);
      let txt = parts.join('\n\n');
      if (trimmedRows > 0) txt += '\n…[+' + trimmedRows + ' rows trimmed]';
      return txt;
    };

    // Overflow discipline (spec §3.2): whole stale layers oldest-first
    // (they sit LAST, newest-first), then dead lines from the oldest
    // observation (dead lines sort newest-first, tail = oldest). Only when
    // those are exhausted do the LOWEST-ranked PROVEN rows drop (each
    // disclosed) — the disclosure note itself must never be the thing the
    // final hard-slice cuts.
    while (build().length > budget && layerList.length > 0) {
      const dropped = layerList.pop();
      trimmedRows += dropped.rows;
    }
    while (build().length > budget && deadLines.length > 0) {
      deadLines.pop();
      trimmedRows += 1;
    }
    while (build().length > budget && provLines.length > 0) {
      provLines.pop();
      trimmedRows += 1;
    }
    let text = build();
    if (text.length > budget) text = text.slice(0, Math.max(1, budget - 1)) + '…';
    return text;
  }

  // Session-memory read net (2026-10-13 spec §3.3): the update-time
  // dead-family WARNING matcher. The ledger's SECONDARY job (the dossier
  // section is the primary one): when service.update (and artifact.propose
  // via the same pipeline) lands an artifact, its selector families are
  // matched against families measured DEAD in the CURRENT epoch. The match
  // is deliberately EXACT — full-string equality, or the dead selector
  // being one of the artifact selector's TOP-LEVEL comma segments. Never a
  // bare substring (`a` would match everything); never a segment split
  // inside :has(...)/:not(...) arguments (the standard inclusion-list
  // shape is ONE compound) — the split is a quote-aware paren-depth walk,
  // the same rule computeSelectorDifferential applies page-side.
  function splitTopLevelSegments(sel) {
    if (typeof sel !== 'string') return [];
    const out = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (quote) {
        if (ch === '\\' && i + 1 < sel.length) { i += 1; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') { if (depth > 0) depth -= 1; }
      else if (ch === ',' && depth === 0) {
        out.push(sel.slice(start, i).trim());
        start = i + 1;
      }
    }
    out.push(sel.slice(start).trim());
    return out.filter(Boolean);
  }

  // artifactSelectors: selector strings claimed by the incoming artifact.
  // deadEntries: [{selector, tool}] current-epoch dead rows (the caller
  // aggregates max matched === 0). Returns the HIT dead entries in
  // deadEntries order, each dead selector named once — a later entry for an
  // already-hit selector only refreshes its tool (the most recent
  // measurement names the tool, mirroring the renderer's aggregation).
  function ledgerDeadMatch(artifactSelectors, deadEntries) {
    const claims = [];
    if (Array.isArray(artifactSelectors)) {
      for (const s of artifactSelectors) {
        if (typeof s === 'string' && s.trim()) claims.push(s.trim());
      }
    }
    if (!claims.length || !Array.isArray(deadEntries) || !deadEntries.length) return [];
    const exact = new Set(claims);
    const claimSegments = claims.map((s) => new Set(splitTopLevelSegments(s)));
    const hits = [];
    const bySel = new Map();
    for (const e of deadEntries) {
      if (!e || typeof e.selector !== 'string' || !e.selector.trim()) continue;
      const dead = e.selector.trim();
      let hit = exact.has(dead);
      if (!hit) {
        for (const segs of claimSegments) {
          if (segs.has(dead)) { hit = true; break; }
        }
      }
      if (!hit) continue;
      const tool = (typeof e.tool === 'string' && e.tool) ? e.tool : 'unknown';
      const prior = bySel.get(dead);
      if (prior) prior.tool = tool;
      else { const row = { selector: dead, tool: tool }; bySel.set(dead, row); hits.push(row); }
    }
    return hits;
  }

  // Spec §3.3 wording: 'selector <X> was measured DEAD this epoch (0
  // matches via <tool>) — verify the family or drop it'. One string, each
  // hit selector once, at most 3 spelled out with the remainder disclosed.
  function ledgerDeadWarningText(hits) {
    const list = Array.isArray(hits) ? hits : [];
    if (!list.length) return '';
    const parts = list.slice(0, 3).map((h) =>
      'selector ' + truncSel(h.selector) + ' was measured DEAD this epoch (0 matches via ' +
      ((typeof h.tool === 'string' && h.tool) ? h.tool : 'unknown') +
      ') — verify the family or drop it');
    if (list.length > 3) {
      parts.push('+' + (list.length - 3) + ' more dead selector(s) — see [SELECTOR LEDGER] in the dossier');
    }
    return parts.join(' | ');
  }

  const api = { renderSelectorLedger, ledgerDeadMatch, ledgerDeadWarningText, splitTopLevelSegments, DEFAULT_BUDGET_CHARS, PROVEN_MAX_ROWS, DEAD_MAX_ROWS, SELECTOR_MAX_CHARS, ENTRY_WINDOW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SelectorLedgerRender = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : self));
