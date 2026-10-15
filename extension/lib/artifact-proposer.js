// extension/lib/artifact-proposer.js
//
// Joint solver (2026-10-13 spec, docs/superpowers/specs/…-joint-solver-design.md):
// compiles the session's EVIDENCE into a complete artifact — the mechanized
// version of what the 245th-round post-mortem did by hand. Three layers:
//   parseRequirementClauses   — pure: requirement text → step directives
//   synthesizeFromEvidence   — pure: evidence pack → full step graph
//   proposeArtifact          — (Task 4) sweep + synthesize + apply
// Red line: every selector comes from MEASURED evidence (census lanes,
// hrefIdentity tokens) or web-generic ARIA fallbacks — never vendor tokens.

const RE_SCROLL_246 = /滚动|加载更多|条数不足|翻页|scroll|load\s*more|until\s+(?:enough|count)/i;
const RE_EXPAND_246 = /展开|see\s*more|expand|read\s*more|显示更多|查看更多/i;
const RE_HOVER_246 = /悬浮窗|悬浮|悬停|hover|tooltip|popover/i;
const RE_EXCL_SEG_246 = /剔除|排除|过滤|不含|去掉|exclude|filter\s*out|remove/i;
const STOP_TOKENS_246 = new Set(['exclude', 'filter', 'out', 'remove', 'and', 'or', 'the', 'a', 'an', 'of', 'with', 'without', 'entries', 'entry', 'items', 'item', 'posts', 'post', 'cards', 'card', 'dom']);
// Review batch (joint-solver #5): single-sourced clause lexicon. The
// verify-runner requirement gates (REQUIREMENT_EXPAND_DROPPED,
// REQUIREMENT_EXCLUSION_LEAKED, REQUIREMENT_TIME_SOURCE_DROPPED) test the
// SAME clause families through this export — verify-runner used to carry
// near-identical inline copies (the exclusion one had already drifted to
// filter\s+out) and every future lexicon edit would drift again.
const CLAUSE_RES_246 = { scroll: RE_SCROLL_246, expand: RE_EXPAND_246, hover: RE_HOVER_246, exclSeg: RE_EXCL_SEG_246 };
// Review batch (joint-solver #P1-A): the DSL's ~regex takes NO flags
// (content-script/list-extract-ops do new RegExp(tf.slice(1))), so the old
// '~see more|展开' could never match the canonical 'See more' capitalization
// (the form the repo's own gate prose uses). Case-tolerant classes + \s*
// spacing tolerance + word boundaries so 'seemorex' prose does not match.
// The runtime value carries DOUBLED backslashes: it is spliced into the
// emitted script's STRING literal, where \\b evaluates to the regex \b the
// DSL constructor needs.
const EXPAND_TEXT_FILTER_246 = '~\\\\b[Ss]ee\\\\s*[Mm]ore\\\\b|展开|查看更多';

function parseRequirementClauses(requirementText) {
  const req = String(requirementText || '');
  const exclusionMarkers = [];
  for (const seg of req.split(/[。；;.\n]/)) {
    if (!RE_EXCL_SEG_246.test(seg)) continue;
    const toks = String(seg).match(/[A-Za-z][A-Za-z0-9]+/g) || [];
    for (const t of toks) {
      const low = t.toLowerCase();
      if (STOP_TOKENS_246.has(low)) continue;
      if (exclusionMarkers.indexOf(low) === -1) exclusionMarkers.push(low);
    }
  }
  return {
    scroll: RE_SCROLL_246.test(req),
    expand: RE_EXPAND_246.test(req),
    hover: RE_HOVER_246.test(req),
    exclusionMarkers: exclusionMarkers
  };
}

// Web-generic bootstrap containers (ARIA conventions only — tried in order
// by the sweep until one counts 3..200 cards).
const BOOTSTRAP_CONTAINERS_246 = ['[role=article]', 'div[role=feed] > div', 'article', 'li'];
const VOCAB_SLOT_246 = [
  // 248th round (FIX 3): plural/short schema names FIRST — the second live
  // run's schema named likes/comments/shares and every count slot went
  // unmapped (the vocab only knew likeCount/commentCount/shareCount), so
  // the assembly emitted keys the schema never declared. slotFor picks the
  // field that EXISTS in schemaFields, so the plural pair wins only when
  // the schema itself named it that.
  ['like', 'likes'], ['comment', 'comments'], ['share', 'shares'],
  ['like', 'likeCount'], ['comment', 'commentCount'], ['share', 'shareCount'],
  ['forward', 'shareCount'], ['time', 'postTime'], ['date', 'postTime'],
  ['url', 'postUrl'], ['link', 'postUrl'], ['content', 'content'], ['text', 'content'],
  ['media', 'mediaUrls'], ['image', 'mediaUrls'], ['photo', 'mediaUrls'], ['video', 'mediaUrls'],
  ['html', 'htmlSnippet'], ['snippet', 'htmlSnippet'], ['id', 'postId']
];

function schemaItemFields_246(outputSchema) {
  try {
    const props = (outputSchema && outputSchema.properties) || {};
    for (const k of Object.keys(props)) {
      const p = props[k];
      if (p && p.type === 'array' && p.items && p.items.properties) {
        return { arrayKey: k, fields: Object.keys(p.items.properties), required: (p.items.required || []) };
      }
    }
  } catch (e) { /* best-effort */ }
  return null;
}

function laneTop_246(lanes, type) {
  try {
    const arr = (lanes && Array.isArray(lanes[type])) ? lanes[type] : [];
    return arr.length ? arr[0] : null; // lanes arrive coverage-sorted
  } catch (e) { return null; }
}

function escRe_246(s) { return String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }

// 248th round (FIX 2, joint-solver second live run): churn-proof identity
// selector. Every synthesized selector was obfuscated-class anchored
// (a.x1i10hfl) and died cross-tab on class churn, while the census's OWN
// hrefIdentity tokens named the churn-proof attribute binding. When query
// tokens exist and the url-lane selector is class-anchored only (no '['
// attribute clause), the identity selector becomes an attribute union
// capped at 3 tokens — shared by the synthesis AND the sweep's P2-F
// attr-grounding hop so the receipts always describe the EMITTED card.
function queryTokensOf_248(census) {
  const raw = (census && Array.isArray(census.hrefIdentity)) ? census.hrefIdentity.map((h) => h && h.token) : [];
  const toks = [];
  for (const t of raw) {
    if (typeof t === 'string' && t.indexOf('query:') === 0 && t.length > 6 && toks.indexOf(t) === -1) toks.push(t);
  }
  return toks;
}
function classAnchoredOnly_248(sel) {
  const s = String(sel || '');
  if (!s) return false;
  // 256th round (shape-family audit): the second arm used to be
  // `s.indexOf('[') === -1` — EVERY attribute-less selector counted as
  // "class-anchored only", including pure-STRUCTURAL lanes like 'h3 a'
  // (flagged over-wide in review: tag/descendant anchoring is stable
  // cross-tab, obfuscated-class churn was never part of its binding, and
  // replacing a measured structural lane burned the census evidence).
  // Churn-prone iff the selector rides a CLASS clause, or is a BARE tag
  // (no combinator, no scoping — the measured token union is strictly more
  // precise there, so replacement stays).
  if (s.indexOf('[') > -1) return false; // attribute binding is already churn-resistant
  if (/\.[A-Za-z0-9_-]/.test(s)) return true; // a class clause rides the binding
  return /^[a-z][a-z0-9]*$/i.test(s); // bare tag: maximally wide, tokens beat it
}
// 249th round (FIX 2, joint-solver run 3): path-form identity. The incident
// page's permalinks were PATH-form (/{dir}/{id}) — query-token identity came
// back empty and the identity selector fell back to the churn-prone class
// anchor. When the sweep derives a stable path prefix from live href samples
// (derivePathIdentity_249), the identity selector becomes the churn-proof
// a[href*="<prefix>"] attribute form with the id regex derived from the SAME
// prefix. Priority: query tokens > pathIdentity > url-lane.
function chooseIdentitySelector_249(census, pathIdentity) {
  const urlLane = census ? laneTop_246(census.lanes, 'url') : null;
  const urlLaneSel = urlLane ? urlLane.selector : null;
  const tokens = queryTokensOf_248(census);
  if (urlLaneSel && tokens.length && classAnchoredOnly_248(urlLaneSel)) {
    const union = tokens.slice(0, 3)
      .map((t) => 'a[href*=' + JSON.stringify(t.slice(6) + '=') + ']')
      .join(', ');
    return { selector: union, source: 'hrefIdentity-tokens' };
  }
  if (pathIdentity && typeof pathIdentity.prefix === 'string' && pathIdentity.prefix) {
    return {
      selector: 'a[href*=' + JSON.stringify(pathIdentity.prefix) + ']',
      source: 'path-prefix',
      idRegex: (pathIdentity && typeof pathIdentity.idRegex === 'string' && pathIdentity.idRegex) ? pathIdentity.idRegex : null
    };
  }
  return { selector: urlLaneSel || null, source: urlLaneSel ? 'url-lane' : 'none' };
}
// 249th round (FIX 1): the CARD computation is single-sourced so the sweep's
// affordance counts and the P2-F attr-grounding hop scope against EXACTLY the
// card synthesizeFromEvidence emits (a drifting copy here would measure one
// selector and emit another — the exact P2-F failure shape the 248th round
// fixed for the token union, re-introduced by any new identity source).
function computeCard_249(pack) {
  const census = (pack && pack.census) || null;
  const baseCard = (census && census.containerSel) || BOOTSTRAP_CONTAINERS_246[0];
  const identity = chooseIdentitySelector_249(census, (pack && pack.pathIdentity) || null);
  return identity.selector ? baseCard + ':has(' + identity.selector + ')' : baseCard;
}

// 249th round (FIX 1, joint-solver run 3): measured affordance selector. The
// synthesized expand step hardcoded the ARIA fallback family as its
// $clickInList sub-selector — on a page with NO role=button affordances the
// verify died CLICK_TARGET_NOT_FOUND every time (the textFilter only narrows
// matches that exist). The sweep now COUNTS each generic family scoped to the
// emitted CARD and takes the first that exists; all zero → the caller keeps
// the ARIA default. Web-generic families only — no vendor tokens.
const BUTTON_FAMILIES_249 = ['div[role=button], span[role=button]', 'button', '[aria-expanded]', '[tabindex]:not([tabindex="-1"])'];
function chooseAffordanceSelector_249(counts) {
  const c = (counts && typeof counts === 'object') ? counts : {};
  for (const fam of BUTTON_FAMILIES_249) {
    const n = c[fam];
    if (typeof n === 'number' && n > 0) return fam;
  }
  return null;
}

// 249th round (FIX 2): pure derivation of the stable path prefix from live
// href samples (fed by probe.attrStats over the url-lane selector). Longest
// common DIRECTORY prefix across samples, then the NEXT path segment must
// VARY across ≥2 samples — that is the per-record id. Returns
// {prefix:'/dir/', idRegex:'/\\/dir\\/([A-Za-z0-9_-]{3,})/'} (regex built
// from the escaped prefix so it matches the exact directory spelling), or
// null when the samples cannot prove a varying id (<2 samples, identical
// paths, query-only URLs, or a root-scope prefix that would match every
// link on the page).
function derivePathIdentity_249(hrefSamples) {
  const raw = Array.isArray(hrefSamples) ? hrefSamples : [];
  const paths = [];
  for (const h of raw) {
    const s = String(h == null ? '' : h).trim();
    if (!s) continue;
    let p = null;
    const mScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]+([^?#]*)/.exec(s);
    if (mScheme) p = mScheme[1];
    else if (s.charCodeAt(0) === 47) p = s.split(/[?#]/)[0]; // root-relative href
    if (!p || p.charCodeAt(0) !== 47) continue; // opaque/relative junk
    const segs = p.split('/').filter(Boolean);
    if (!segs.length) continue;
    paths.push(segs);
  }
  if (paths.length < 2) return null;
  // Longest common directory prefix (case-insensitive compare; the emitted
  // prefix keeps the first sample's original casing).
  const lower = paths.map((segs) => segs.map((x) => String(x).toLowerCase()));
  const maxCommon = Math.min.apply(null, lower.map((segs) => segs.length));
  let common = 0;
  while (common < maxCommon) {
    const seg = lower[0][common];
    if (!lower.every((segs) => segs[common] === seg)) break;
    common += 1;
  }
  if (common < 1) return null; // a root-scope '/' prefix matches every link — vacuous
  const nextVals = [];
  for (const segs of paths) { if (segs.length > common) nextVals.push(segs[common]); }
  if (new Set(nextVals).size < 2) return null; // no varying id segment after the shared prefix
  // 256th round (shape-family audit): the varying segment must be id-SHAPED
  // — digit-bearing, the same heuristic the census's own idishValue and the
  // 255b generic fallback apply. An ALL-pure-word varying segment is the
  // TITLE/slug family: deriving an idRegex from it ships slugs as postId.
  // Reject so the caller degrades to the digit-bearing generic fallback;
  // one pure-word nav link among digit-bearing permalinks must not kill
  // the derivation (≥1 digit-bearing value is enough).
  if (!nextVals.some((v) => /\d/.test(String(v)))) return null;
  const prefix = '/' + paths[0].slice(0, common).join('/') + '/';
  return { prefix: prefix, idRegex: '/' + escRe_246(prefix) + '([A-Za-z0-9_-]{3,})/' };
}

// Review batch (joint-solver #P2-F): the grounding gate demands an
// attribute-distribution receipt (observationLog.coversAttr) for every attr
// inside :has()/:not() spans of a claimed selector. The synthesized CARD
// carries `:has(a[href*=…])`, so a fresh-session propose was deterministically
// grounding-rejected on 'href' — the sweep never produced the receipt. The
// sweep now runs probe.attrStats for exactly the gate's own filter-attr set
// (resolved from the gate's exported extractor — grounding-gate.js loads
// before this file in wizard.html; Node resolves via require). Observation
// recording lives INSIDE probe-tools (attrStats records through the same
// lateBoundLog the probe.attrStats TOOL uses, epoch-stamped) — NOT in
// wrapProbe — so calling the probe from the sweep lands the receipt.
let GroundingGateRef_246 = null;
try {
  if (typeof GroundingGate !== 'undefined' && GroundingGate && typeof GroundingGate.extractFilterAttributes === 'function') {
    GroundingGateRef_246 = GroundingGate;
  } else if (typeof require === 'function') {
    const ggMod = require('./grounding-gate');
    if (ggMod && typeof ggMod.extractFilterAttributes === 'function') GroundingGateRef_246 = ggMod;
  }
} catch (eGG) { GroundingGateRef_246 = null; }

// Review batch (#5): quote-aware top-level comma splitter for comma-union
// families — selector-ledger-render owns the canonical walk (the same rule
// computeSelectorDifferential applies page-side); a naive split would break
// [data-x="a,b"] arms on the comma INSIDE the attribute value.
let SelectorLedgerRef_253 = null;
try {
  if (typeof SelectorLedgerRender !== 'undefined' && SelectorLedgerRender && typeof SelectorLedgerRender.splitTopLevelSegments === 'function') {
    SelectorLedgerRef_253 = SelectorLedgerRender;
  } else if (typeof require === 'function') {
    const slMod = require('./selector-ledger-render');
    if (slMod && typeof slMod.splitTopLevelSegments === 'function') SelectorLedgerRef_253 = slMod;
  }
} catch (eSL) { SelectorLedgerRef_253 = null; }
// Scope EVERY arm of a comma-union family to the card: 'CARD + " " + fam'
// concatenation leaves later arms counting PAGE-WIDE (the union splits at
// the top-level comma the moment the browser parses it). Each arm gets its
// own CARD prefix; quoted/bracketed commas never split an arm.
function scopeFamilyToSelector_253(cardSel, fam) {
  const splitter = (SelectorLedgerRef_253 && typeof SelectorLedgerRef_253.splitTopLevelSegments === 'function')
    ? SelectorLedgerRef_253.splitTopLevelSegments : null;
  const arms = splitter ? splitter(String(fam || '')) : String(fam || '').split(',');
  const card = String(cardSel || '');
  return arms
    .map((seg) => (card ? card + ' ' + seg.trim() : seg.trim()))
    .filter((s) => s)
    .join(', ');
}

// 253b (P3-E): paste-ready labels carrier + family parse line for the count
// slots — the exact shape the synthesis emits when a count lane exists, so
// the model pastes one block instead of composing the carrier/parse split
// blind. Web-generic alternates only (like/赞/点赞, comment/评论,
// share/转发/分享); the digit requirement stays so label-shaped prose never
// poses as a count. Review batch (#13): the assembly half ships as RAW code
// (`assemblyFragment` — compiles standalone), never comment-wrapped — a
// '// parse in the assembly:' prefix made every pasteable line inert.
function countSlotTemplate253b(slot) {
  const kind = /^like/.test(slot) ? 'like' : (/^comment/.test(slot) ? 'comment' : 'share');
  const finder = kind === 'like'
    ? "/^like\\s*:|^[赞点][赞]?\\s*\\d|^\\d+\\s*人.*赞/i.test(l)"
    : (kind === 'comment'
        ? "/comment|评论/i.test(l) && /\\d/.test(l)"
        : "/share|转发|分享/i.test(l) && /\\d/.test(l)");
  const fieldMapFragment = "labels: { selector: '[aria-label]', attr: 'aria-label', multi: true }, // into the fieldMap";
  const assemblyFragment = "const labs = (r.labels || []).map(function (x) { return String(x || '').trim(); }); const m = labs.find(function (l) { return " + finder + "; }) || ''; // value = num(m)";
  return { fieldMapFragment: fieldMapFragment, assemblyFragment: assemblyFragment };
}

function synthesizeFromEvidence(pack, requirementText, outputSchema) {
  const clauses = parseRequirementClauses(requirementText);
  const census = (pack && pack.census) || null;
  const unfilled = [];
  const timeLane = census ? laneTop_246(census.lanes, 'time') : null;
  const countLane = census ? laneTop_246(census.lanes, 'count') : null;
  const textLane = census ? laneTop_246(census.lanes, 'text') : null;
  // Review batch (joint-solver #P1-B): census-lanes emits href-identity
  // tokens in the PRODUCTION shape 'query:<param>' / 'path:<seg>' (pinned by
  // probe-census tests). Splicing them RAW produced a regex alternation that
  // can never match a URL (the literal 'query:' prefix rides inside the
  // pattern), so every production postId came back empty. Keep ONLY query:*
  // tokens, STRIP the prefix, ignore path:* (path position is not a
  // query-param binding), and anchor each alternative at a [?&] so it
  // matches real query strings.
  const hrefTokens = queryTokensOf_248(census);
  // 249th round: pack-carried sweep evidence — the measured affordance
  // selector (FIX 1) and the derived path-form identity (FIX 2). Both stay
  // optional; a direct pack caller omitting them keeps the 248 behavior.
  const pathIdentity = (pack && pack.pathIdentity && typeof pack.pathIdentity.prefix === 'string' && pack.pathIdentity.prefix &&
    typeof pack.pathIdentity.idRegex === 'string' && pack.pathIdentity.idRegex) ? pack.pathIdentity : null;
  const affordanceSel = (pack && typeof pack.affordanceSelector === 'string' && pack.affordanceSelector) ? pack.affordanceSelector : null;

  // 248th round (FIX 2): the identity selector is the churn-proof token
  // union whenever the url lane is class-anchored only — obfuscated classes
  // (a.x1i10hfl) churn cross-tab; the page's own href-identity tokens do
  // not. Attribute/structural lane selectors are kept as measured.
  // 249th round (FIX 2): a derived path prefix outranks the raw url lane for
  // the same reason — it is measured AND churn-proof.
  const identityChoice = chooseIdentitySelector_249(census, pathIdentity);
  const identitySel = identityChoice.selector;
  const CARD = computeCard_249(pack);
  if (!identitySel) unfilled.push({ slot: 'postUrl', reason: 'no url-like census lane — the population filter and the link field have no measured selector; run probe.census or hand-bind' });

  // Identity regex DERIVED from the page's own href-identity tokens (red line:
  // no vendor tokens — the page census names the id parameter). The emitted
  // string must carry ONE backslash before w so the generated script's regex
  // reads \w (word chars), matching the single-level fallback form below.
  // 249th round (FIX 2): the path-prefix form is derived by
  // derivePathIdentity_249 from live href samples (priority: query tokens >
  // pathIdentity > generic fallback).
  // 256th round (shape-family audit): the 255b generic form anchored the
  // capture directly after a [/?#&] delimiter — that only ever matches the
  // PATH-segment family, because a query-param permalink carries '='
  // between the delimiter and the value and can never match. The optional
  // `param=` arm extends the SAME digit-bearing capture to the query family
  // (?tok=v / &tok=v); pure-word segments still never match in either
  // family (the digit requirement rides the capture itself).
  const idRe = hrefTokens.length
    ? '/(?:' + hrefTokens.map((t) => '[?&]' + escRe_246(t.slice(6)) + '=').join('|') + ')(\\w{3,})/'
    : (identityChoice.idRegex || '/[/?#&](?:[A-Za-z0-9_-]+=)?([A-Za-z0-9_-]*\\d[A-Za-z0-9_-]{5,})/');

  const steps = [];
  steps.push({ id: 'wait', name: 'wait for cards', script: 'await $wait(' + JSON.stringify(CARD) + ', 3000);\nreturn { done: true };', onSuccess: clauses.scroll ? 'collect' : (clauses.expand ? 'expand' : 'extract'), onFailure: 'TERMINATE', maxIterations: 1 });
  if (clauses.scroll) {
    steps.push({
      id: 'collect', name: 'scroll until enough cards', maxIterations: 15,
      // Review batch (joint-solver #7): read the receipt contract
      // $collectUntil actually returns — {collected, satisfied,
      // exhaustion:{certified,evidence}} — never r.count/r.certified (keys
      // the primitive does not expose; the old reads shipped undefined
      // count/certified into the step result forever).
      script: 'const CARD = ' + JSON.stringify(CARD) + ';\nconst r = await $collectUntil(CARD, { targetCount: __input__.count || 5, idAttr: \'href\' });\nreturn { done: true, count: r.collected, certified: (r.exhaustion && r.exhaustion.certified) || null, satisfied: r.satisfied || null };',
      onSuccess: clauses.expand ? 'expand' : 'extract', onFailure: 'extract'
    });
  }
  if (clauses.expand) {
    steps.push({
      id: 'expand', name: 'expand collapsed text', maxIterations: 1,
      // 249th round (FIX 1): the sub-selector is the MEASURED affordance
      // family when the sweep counted one scoped to the CARD — the hardcoded
      // ARIA default stays only as the no-evidence fallback (it counted zero
      // or the sweep never ran). JSON.stringify emits the double-quoted
      // literal the P1-A quote-style scan expects.
      script: 'await $clickInList(' + JSON.stringify(CARD) + ', ' + JSON.stringify(affordanceSel || BUTTON_FAMILIES_249[0]) + ', { textFilter: \'' + EXPAND_TEXT_FILTER_246 + '\', delayMs: 400 }).catch(function () {});\nawait new Promise(function (r) { setTimeout(r, 1200); });\nreturn { done: true };',
      onSuccess: 'extract', onFailure: 'extract'
    });
  }

  const item = schemaItemFields_246(outputSchema);
  const schemaFields = item ? item.fields : [];
  // Review batch (joint-solver #P1-E): the return key follows the SCHEMA's
  // declared array (default 'posts' when the schema is unreadable) — the old
  // hardcoded `return { posts: posts }` made every non-`posts` contract
  // (e.g. an `items` array) verify against a shape the script never emitted.
  const arrayKey = (item && typeof item.arrayKey === 'string' && item.arrayKey) ? item.arrayKey : 'posts';
  const slotFor = (laneKind) => {
    for (const pair of VOCAB_SLOT_246) { if (pair[0] === laneKind && schemaFields.indexOf(pair[1]) > -1) return pair[1]; }
    return null;
  };
  const urlSlot = slotFor('url') || 'postUrl';
  // 248th round (FIX 3): the count assembly keys follow the SCHEMA's own
  // field names — plural/short names (likes/comments/shares) resolve
  // through the plural vocab pairs; the canonical likeCount family stays
  // the default when the schema named those (or named none).
  const likeSlot = slotFor('like') || 'likeCount';
  const commentSlot = slotFor('comment') || 'commentCount';
  const shareSlot = slotFor('share') || 'shareCount';
  const fm = [];
  if (identitySel) fm.push(urlSlot + ': { selector: ' + JSON.stringify(identitySel) + ', attr: \'href\' }');
  const timeFm = [];
  // 252nd round (FIX B): the sweep's census runs {hover:true} and carries
  // the probe.timestamp receipt in `timeHover` — candidates[] with the
  // absolute dates the hover dance captured plus the anchorSel it actually
  // hovered. synthesizeFromEvidence used to read ONLY the lanes: when no
  // time-ish leaf lane existed, postTime shipped unfilled three live
  // sessions straight while the receipt's own absolute date sat in the
  // pack. When the lanes carry no time selector BUT the receipt proves a
  // FULL absolute (non-relative, year-bearing), the anchor family is
  // MEASURED evidence — bind the ts triple from the receipt's anchorSel
  // (web-generic union fallback when the receipt carries none). A lane, if
  // present, still outranks the receipt (cross-sample coverage beats one
  // card's dance).
  const th252 = census ? census.timeHover : null;
  const thAbs252 = !!(th252 && Array.isArray(th252.candidates) &&
    th252.candidates.some(function (c) { return c && !c.relative && /(19|20)\d{2}/.test(String(c.value || '')); }));
  // 253b (P3-A): the hover clause was a dead knob — parseRequirementClauses
  // parsed it but nothing read it, so EVERY synthesis ran $extractWithHover
  // (hover wall budget per extract) even when the requirement asked for no
  // hover source and no hover evidence existed. Degrade to $extractList when
  // BOTH the clause is absent AND the timeHover receipt proves no absolute.
  // The tsHover (read:'hoverPopover') field is dropped from the fieldMap —
  // $extractList hard-rejects hoverPopover specs by contract — while
  // tsAria/tsLabel stay when a time selector exists (ARIA reads need no
  // hover phase). The hover option object is omitted entirely; the assembly
  // loop is already undefined-safe for absent fields.
  const useHoverExtract253b = !!(clauses.hover || thAbs252);
  const timeSel252 = timeLane
    ? timeLane.selector
    : (thAbs252
        ? ((th252 && typeof th252.anchorSel === 'string' && th252.anchorSel) ? th252.anchorSel : 'a:has(span[aria-labelledby]), [aria-labelledby], abbr[aria-label], time')
        : null);
  if (timeSel252) {
    timeFm.push('tsAria: { selector: ' + JSON.stringify(timeSel252) + ', attr: \'aria-label\' }');
    timeFm.push('tsLabel: { selector: ' + JSON.stringify(timeSel252) + ', labelledby: true }');
    if (useHoverExtract253b) {
      timeFm.push('tsHover: { selector: ' + JSON.stringify(timeSel252) + ', read: \'hoverPopover\', match: /(19|20)\\d{2}/ }');
    }
  } else {
    // 253b (P3-E): paste-ready binding template for the recurring postTime
    // slot — built from the best available evidence like the 252 binding:
    // the timeHover receipt's own anchorSel when the dance ran (even
    // relative-only — the anchor is MEASURED), the web-generic
    // span[aria-label] family otherwise. The model pastes instead of
    // composing the fieldMap shape blind.
    const tmplSel253b = (th252 && typeof th252.anchorSel === 'string' && th252.anchorSel) ? th252.anchorSel : 'span[aria-label]';
    // Review batch (#2): the template follows the SAME degradation as the
    // fieldMap — a degraded ($extractList) synthesis must never paste a
    // read:'hoverPopover' spec ($extractList hard-rejects those by
    // contract). The hover line rides only the hover-form template, with a
    // note line teaching the switch otherwise.
    const tmplNote253 = '// add tsHover only after switching the call to $extractWithHover (hoverPopover specs are rejected by $extractList)';
    const tsAriaLine253 = 'tsAria: { selector: ' + JSON.stringify(tmplSel253b) + ', attr: \'aria-label\' }';
    const tsLabelLine253 = 'tsLabel: { selector: ' + JSON.stringify(tmplSel253b) + ', labelledby: true }';
    const tsHoverLine253 = 'tsHover: { selector: ' + JSON.stringify(tmplSel253b) + ', read: \'hoverPopover\', match: /(19|20)\\d{2}/ }';
    unfilled.push({
      slot: 'postTime',
      reason: 'no time-like census lane — run probe.census {hover:true} or bind the timestamp anchor by hand',
      template: useHoverExtract253b
        ? tsAriaLine253 + ', ' + tsLabelLine253 + ', ' + tsHoverLine253 + ','
        : tsAriaLine253 + ', ' + tsLabelLine253 + ',\n' + tmplNote253
    });
  }
  if (countLane) {
    fm.push('labels: { selector: \'[aria-label]\', attr: \'aria-label\', multi: true }');
  } else {
    // 248th round (FIX 3): the plural schema names are checked too — a
    // schema declaring likes/comments/shares must see THOSE slots named as
    // the gaps, not the canonical likeCount family it never declared.
    // 253b (P3-E): each count-family gap carries the paste-ready labels
    // carrier + its own family parse line — the same shape the synthesis
    // emits when a count lane exists (CJK alternates included).
    for (const s of ['likeCount', 'likes', 'commentCount', 'comments', 'shareCount', 'shares']) {
      if (schemaFields.indexOf(s) > -1) {
        // Review batch (#13): two clearly-separated RAW snippets — the
        // fieldMap carrier and the assembly parse line (compiles as-is, no
        // '// parse in the assembly:' comment wrapper swallowing the code).
        const t253 = countSlotTemplate253b(s);
        unfilled.push({
          slot: s,
          reason: 'no count-like census lane on this page — renegotiate via io.confirm or bind the count carrier by hand',
          template: t253.fieldMapFragment + '\n// assembly:\n' + t253.assemblyFragment,
          assemblyFragment: t253.assemblyFragment
        });
      }
    }
  }
  if (textLane) {
    fm.push('content: { selector: ' + JSON.stringify(textLane.selector) + ' }');
    fm.push('htmlSnippet: { selector: ' + JSON.stringify(textLane.selector) + ', attr: \'outerHTML\' }');
  } else if (schemaFields.indexOf('content') > -1) {
    unfilled.push({ slot: 'content', reason: 'no text-like census lane — bind the content container by hand' });
  }
  fm.push('mediaUrls: { selector: \'img, video\', attr: \'src\', multi: true }');
  const anchorSel = identitySel ? identitySel + ', h3 a' : 'h3 a';

  // Review batch (joint-solver #P2-H): the guard tests the ASSEMBLED postTime
  // (abs || times[0]), not r.tsAria alone — the incident page carried the Ad
  // marker in tsLabel while tsAria read empty, so every Ad card shipped. The
  // guard line is spliced AFTER the `const abs` line (it reads abs/times).
  const markerGuards = clauses.exclusionMarkers.length
    ? '  if (' + JSON.stringify(clauses.exclusionMarkers) + '.some(function (m) { return String(abs || times[0] || \'\').trim().toLowerCase() === m; })) continue;\n'
    : '';
  // Review batch (joint-solver #P2-I): the per-record url skip-guard is
  // emitted ONLY when the fieldMap actually binds the url slot (identitySel
  // measured). With no url lane the guard would skip EVERY record (r.postUrl
  // is undefined) and the extract deterministically returned {posts:[]}.
  const urlGuardLine = identitySel ? '  if (!r.' + urlSlot + ') continue;' : null;
  // 253b (P3-A): the degraded form swaps $extractWithHover for $extractList —
  // no hover option object, no maxContainers (the assembly loop already caps
  // at __input__.count), no tsHover field in the fieldMap.
  const extractHead253b = useHoverExtract253b
    ? ['const rs = await $extractWithHover(CARD, {',
       '  ' + fm.concat(timeFm).join(',\n  '),
       '}, { hover: { anchorSel: ' + JSON.stringify(anchorSel) + ' }, maxContainers: Math.min(__input__.count || 10, 50) });']
    : ['const rs = await $extractList(CARD, {',
       '  ' + fm.concat(timeFm).join(',\n  '),
       '});'];
  const extractScript = [
    'const CARD = ' + JSON.stringify(CARD) + ';'
  ].concat(extractHead253b, [
    'const num = function (s) { const m = String(s || \'\').match(/[\\d.,]+[KMkm]?/); return m ? m[0] : \'\'; };',
    'const posts = [];',
    'for (const r of rs) {',
    urlGuardLine,
    '  const idm = String(r.' + urlSlot + ').match(' + idRe + ');',
    '  const times = [r.tsAria, r.tsLabel, r.tsHover].map(function (t) { return String(t || \'\').trim(); }).filter(Boolean);',
    '  const abs = times.find(function (t) { return /(19|20)\\d{2}/.test(t); });',
    markerGuards + '  const labs = (r.labels || []).map(function (x) { return String(x || \'\').trim(); });',
    // 253b (P3-B): web-generic CJK alternates for the count labels — 赞/点赞
    // (like), 评论 (comment), 转发/分享 (share). The digit requirement rides
    // every CJK branch so prose like 点赞过的朋友 never poses as a count; the
    // like value is num()-wrapped so a CJK carrier ('赞 1.2万') parses to its
    // digit run exactly like the comm/shr lanes (English values are already
    // digit runs — num is a no-op there).
    '  const like = num((labs.find(function (l) { return /^like\\s*:|^[赞点][赞]?\\s*\\d|^\\d+\\s*人.*赞/i.test(l); }) || \'\').replace(/^like\\s*:\\s*/i, \'\').replace(/\\s+people.*$/i, \'\'));',
    '  const commL = labs.find(function (l) { return /comment|评论/i.test(l) && /\\d/.test(l); }) || \'\';',
    '  const shrL = labs.find(function (l) { return /share|转发|分享/i.test(l) && /\\d/.test(l); }) || \'\';',
    '  posts.push({',
    '    postId: idm ? idm[1] : \'\',',
    '    ' + urlSlot + ': r.' + urlSlot + ',',
    '    postTime: abs || times[0] || \'\',',
    '    content: r.content || \'\',',
    '    ' + likeSlot + ': like, ' + commentSlot + ': num(commL), ' + shareSlot + ': num(shrL),',
    '    mediaUrls: (r.mediaUrls || []).filter(function (u) { return /^https?:/.test(String(u)); }),',
    '    htmlSnippet: String(r.htmlSnippet || \'\').slice(0, 5000)',
    '  });',
    '  if (posts.length >= (__input__.count || 5)) break;',
    '}',
    'return { ' + JSON.stringify(arrayKey) + ': posts };'
  ]).filter(function (line) { return line != null; }).join('\n');
  steps.push({ id: 'extract', name: useHoverExtract253b ? 'extract cards with hover' : 'extract cards', script: extractScript, onSuccess: 'TERMINATE', onFailure: 'TERMINATE', maxIterations: 1 });
  if (!census) unfilled.push({ slot: 'census', reason: 'no census evidence in this session — selectors fell back to web-generic ARIA conventions; re-run artifact.propose after probe.census for measured lanes' });
  // 248th round (FIX 2): the identity-selector provenance — which selector
  // the CARD :has() filter and the postUrl field bind, and whether it came
  // from the measured url lane or the churn-proof hrefIdentity token union.
  // 249th round (FIX 1): when the sweep MEASURED an affordance family, the
  // receipt names it — the expand step's sub-selector is a claim about the
  // page and must be auditable like every other selector.
  const provenance = { identitySelector: identitySel, source: identityChoice.source };
  if (affordanceSel) provenance.affordanceSelector = affordanceSel;
  // 252nd round (FIX B): which measured source bound the ts triple — the
  // timeHover receipt's anchorSel (hover-dance evidence) vs the census time
  // lane. The lane path stays untagged (it is already the lanes' own
  // selector disclosure).
  if (!timeLane && thAbs252) provenance.timeSource = 'timeHover';
  return { steps: steps, unfilled: unfilled, selectorProvenance: provenance };
}

// Phase-3 renderers: decisive red receipts carry COPY-READY fix fragments —
// the model pastes instead of composing (every composition slip costs a
// 90s verify). Pure string builders, unit-testable.
function renderExpandStepFragment(cardSel) {
  return 'await $clickInList(' + JSON.stringify(String(cardSel)) + ', \'div[role=button], span[role=button]\', { textFilter: \'' + EXPAND_TEXT_FILTER_246 + '\', delayMs: 400 });';
}
function renderHoverPopoverFragment(fieldName, anchorSel) {
  return fieldName + ': { selector: ' + JSON.stringify(String(anchorSel)) + ', read: \'hoverPopover\', match: /(19|20)\\d{2}/ },';
}
function renderExclusionGuardFragment(fieldName, marker) {
  return '.filter(function (p) { return String(p.' + fieldName + ' || \'\').toLowerCase() !== \'' + String(marker).toLowerCase() + '\'; })';
}

// Sweep: bootstrap the container by counting generic families, then ONE
// census (hover:true). Every hop is try/catch — a failed hop is an evidence
// gap, never a crash. Synthesis is pure (above). Application has TWO
// contracts:
//   ctx.applyArtifact wired (unit tests / direct callers) — apply directly,
//     exactly as before.
//   ctx.applyArtifact absent (production wiring, C1 final review) — return
//     the synthesis UNAPPLIED as { applied:'engine-pending', steps } for the
//     ENGINE to route through the exact service.update pipeline (grounding
//     gates, staticLint/syntax/chain gates, applySessionArtifact,
//     artifactVersions lineage). The old production path applied through a
//     BARE setter with no gates and no version lineage — the first green
//     verify after a propose would stamp a stale executedArtifactVersion and
//     corrupt rollback/green-tracking/dossier lineage.
// Review batch (joint-solver #P1-D): aggregate sweep budget. The unbounded
// sweep (bootstrap counts + hover census on a pathological feed) could run
// ~7min. Three caps: the bootstrap loop stops admitting new candidates once
// it has burned bootstrapMs; the census hop passes a reduced timeoutMs
// derived from what remains of totalMs; and the post-census attrStats hop
// (P2-F) is skipped entirely past hardSkipMs. ctx.sweepBudget overrides the
// constants (tests / callers with tighter deadlines).
const SWEEP_BUDGET_246 = { totalMs: 120000, bootstrapMs: 30000, hardSkipMs: 110000, censusMinMs: 10000 };

async function proposeArtifact(ctx) {
  const t0 = Date.now();
  const budget = Object.assign({}, SWEEP_BUDGET_246, (ctx && ctx.sweepBudget) || {});
  const elapsedMs = function () { return Date.now() - t0; };
  const mergeNote = (ctx && ctx.currentArtifact) ? 'regenerated-from-fresh-sweep (hand-tuned slots are NOT preserved — re-check any slot you had fixed by hand)' : 'fresh';
  const probes = (ctx && ctx.probes) || {};
  let containerSel = null;
  let bootstrapCapped = false;
  for (const cand of BOOTSTRAP_CONTAINERS_246) {
    if (elapsedMs() > budget.bootstrapMs) { bootstrapCapped = true; break; }
    try {
      const c = await probes.count({ sel: cand });
      const n = c && typeof c.count === 'number' ? c.count : 0;
      if (n >= 3 && n <= 200) { containerSel = cand; break; }
    } catch (e) { /* next candidate */ }
  }
  let census = null;
  if (containerSel) {
    // 247th round: scrollRounds:2 — the sweep's census runs the bounded
    // mount phase when the identity diff comes back empty over the mounted
    // window (the maiden live session's top-of-SERP correction strip).
    // 250th round: 2→5 — the 249th session's recommendation headers
    // spanned multiple viewports (the 243rd showed 3→12 only with deep
    // scroll), and the mount loop is now persistent (it keeps hopping
    // while the trigger holds), so depth is what finds the organic
    // population. 254th review (#3): the mount wall is NOT hop-count
    // arithmetic — every growth hop re-runs the full population read
    // ($count + up to 5 sampled $extractList legs, each bounded by
    // timeoutMs), so the sweep passes its REMAINING budget as mountWallMs
    // and the phase can never outrun the sweep.
    const censusArgs = { containerSel: containerSel, samples: 5, hover: true, scrollRounds: 5 };
    const remaining = budget.totalMs - elapsedMs();
    if (typeof remaining === 'number' && remaining > 0) {
      censusArgs.timeoutMs = Math.max(budget.censusMinMs, remaining - 10000);
      censusArgs.mountWallMs = remaining;
    }
    try { census = await probes.census(censusArgs); }
    catch (e) { census = { error: String((e && e.message) || e) }; }
  }
  // Review batch (joint-solver #13): a census hop that FAILED (threw, or
  // returned an error-bearing object) used to flow into synthesis as
  // pseudo-evidence — and being truthy it SUPPRESSED the no-census unfilled
  // disclosure, so the receipt looked fully sourced while every lane
  // silently fell back to web-generic ARIA conventions. Null it (synthesis
  // degrades to the honest no-census path) and keep the digest for an
  // explicit unfilled entry below.
  let censusErrorDigest = null;
  if (census && typeof census === 'object' && typeof census.error === 'string' && census.error) {
    censusErrorDigest = census.error;
    census = null;
  }
  // 249th round (FIX 2, joint-solver run 3): path-form identity derivation.
  // When the census's hrefIdentity carries path: entries but NO query:
  // tokens, the page's per-record ids live in a PATH segment — sample the
  // live hrefs (attrStats over the url-lane selector, same arg shape as the
  // P2-F hop) and derive the stable prefix + id regex. Bounded by the sweep
  // budget; a failed hop leaves pathIdentity absent (the synthesis falls
  // back to the url lane exactly as before — an evidence gap, never a
  // crash).
  let pathIdentity = null;
  if (census && typeof probes.attrStats === 'function') {
    try {
      const rawTokens = (Array.isArray(census.hrefIdentity) ? census.hrefIdentity.map((h) => h && h.token) : []);
      const hasQuery = rawTokens.some((t) => typeof t === 'string' && t.indexOf('query:') === 0);
      const hasPath = rawTokens.some((t) => t === 'path:last');
      const urlLane = laneTop_246(census.lanes, 'url');
      if (!hasQuery && hasPath && urlLane && urlLane.selector && elapsedMs() <= budget.hardSkipMs) {
        const rHref = await probes.attrStats({ containerSel: urlLane.selector, attr: 'href' });
        if (rHref && typeof rHref.error !== 'string' && Array.isArray(rHref.values)) {
          pathIdentity = derivePathIdentity_249(rHref.values.map((v) => (v && typeof v.value === 'string') ? v.value : null).filter(Boolean));
        }
      }
    } catch (ePath) { pathIdentity = null; /* evidence gap — url lane fallback */ }
  }
  // 249th round (FIX 1): measured affordance selector. Count each generic
  // button family scoped to the EMITTED card (computeCard_249 — same helper
  // the synthesis uses) and take the first that exists. Skipped when the
  // census never landed (nothing measured to scope against) or past the
  // hard-skip time; a skip is disclosed, never silent.
  let affordanceSelector = null;
  let affordanceSkipped = null;
  if (census && typeof probes.count === 'function') {
    const affordanceCard = computeCard_249({ census: census, pathIdentity: pathIdentity });
    const affordanceCounts = {};
    for (const fam of BUTTON_FAMILIES_249) {
      if (elapsedMs() > budget.hardSkipMs) {
        affordanceSkipped = 'sweep budget (>' + budget.hardSkipMs + 'ms elapsed) — the web-generic ARIA default was kept unmeasured';
        break;
      }
      try {
        // Review batch (#5): every ARM of the family union is scoped — a
        // bare 'CARD + fam' concat splits at the top-level comma and the
        // later arms count page-wide.
        const c = await probes.count({ sel: scopeFamilyToSelector_253(affordanceCard, fam) });
        const n = c && typeof c.count === 'number' ? c.count : 0;
        affordanceCounts[fam] = n;
        if (n > 0) break; // first existing family wins — no need to count the rest
      } catch (eCnt) { affordanceCounts[fam] = 0; }
    }
    affordanceSelector = chooseAffordanceSelector_249(affordanceCounts);
  }
  // Review batch (joint-solver #P2-F): produce the attribute-distribution
  // receipts the grounding gate demands for the CARD's :has() filter attrs
  // BEFORE the synthesis is applied. The descendant form (container + '
  // [attr]') reads the attr on the carriers the :has() clause filters by —
  // the polarity evidence the gate wants, and the recorded attrs[] entry
  // satisfies coversAttr. A failed hop is an evidence gap (disclosed in the
  // receipt), never a crash — the gate will then reject with its own
  // teaching, which is the honest outcome.
  let attrGrounding = null;
  if (census && containerSel && typeof probes.attrStats === 'function' && GroundingGateRef_246) {
    try {
      // 248th round (FIX 2) + 249th round (FIX 2): derive the card through
      // the SAME identity choice the synthesis emits — computeCard_249 is
      // the single source (class-only lanes replaced by the token union, and
      // path-form pages by the derived prefix, both change what :has()
      // carries, and the sweep must produce the href receipt the gate will
      // demand for the EMITTED selector).
      const cardSel = computeCard_249({ census: census, pathIdentity: pathIdentity });
      const attrList = GroundingGateRef_246.extractFilterAttributes(cardSel) || [];
      const seen = [];
      for (const at of attrList) { if (seen.indexOf(at) === -1) seen.push(at); }
      for (const attr of seen) {
        if (elapsedMs() > budget.hardSkipMs) {
          if (!attrGrounding) attrGrounding = [];
          attrGrounding.push({ attr: attr, skipped: 'sweep budget (>' + budget.hardSkipMs + 'ms elapsed)' });
          break;
        }
        try {
          const rAttr = await probes.attrStats({ containerSel: containerSel + ' [' + attr + ']', attr: attr });
          if (!attrGrounding) attrGrounding = [];
          attrGrounding.push({
            attr: attr,
            ok: !(rAttr && typeof rAttr.error === 'string'),
            absentPct: (rAttr && typeof rAttr.absentPct === 'number') ? rAttr.absentPct : null
          });
        } catch (eAttr) {
          if (!attrGrounding) attrGrounding = [];
          attrGrounding.push({ attr: attr, ok: false, error: String((eAttr && eAttr.message) || eAttr) });
        }
      }
    } catch (eHop) { /* attr grounding is best-effort; a rejection teaches */ }
  }
  const pack = { census: census, currentArtifact: (ctx && ctx.currentArtifact) || null, affordanceSelector: affordanceSelector, pathIdentity: pathIdentity };
  // 253rd (spec §2, binding emphasis): conflicts between fresh lanes and
  // ledger-PROVEN families are DISCLOSED — fresh measurement wins by
  // construction (synthesis reads fresh evidence), but the session's
  // validated history is surfaced in the receipt, never silently dropped.
  // Review batch (dead code): pathIdentity is a plain local two lines up —
  // the old typeof/try-catch wrapper defended against a TDZ that cannot
  // happen here and read like a load-order guard.
  const ledgerConflicts253 = [];
  try {
    const lg = ctx && ctx.ledger;
    if (lg && Array.isArray(lg.entries)) {
      // 254th review (#11): keep the WINNING outcome's tool alongside its
      // count — the conflict row carries its evidence, not just a selector
      // string that reads as "swap to this".
      const proven = new Map();
      for (const en of lg.entries) {
        if (!(en && Array.isArray(en.outcomes))) continue;
        if (lg.currentEpoch != null && en.epoch != null && en.epoch !== lg.currentEpoch) continue;
        for (const o of en.outcomes) {
          if (!o || !(o.matched > 0)) continue;
          const prev = proven.get(o.selector);
          if (!prev || o.matched > prev.matched) {
            proven.set(o.selector, { matched: o.matched, tool: en.tool });
          }
        }
      }
      const chosenIdentity = chooseIdentitySelector_249(census, pathIdentity);
      if (proven.size && chosenIdentity && chosenIdentity.selector) {
        const chosen = String(chosenIdentity.selector);
        for (const [sel253, prov253] of proven) {
          if (sel253 === chosen) continue;
          // conflict = a ledger-PROVEN link-family selector that is NOT part
          // of the chosen identity union but shares link-ish shape (a[href…])
          if (/^a\[href/.test(sel253) && chosen.indexOf(sel253) === -1) {
            ledgerConflicts253.push({
              selector: sel253,
              matched: prov253.matched,
              tool: (prov253.tool && typeof prov253.tool === 'string') ? prov253.tool : 'unknown',
              note: 'fresh census wins — union this family only if verify confirms a shortfall'
            });
            if (ledgerConflicts253.length >= 3) break;
          }
        }
      }
    }
  } catch (eC253) { /* disclosure is best-effort */ }
  const synth = synthesizeFromEvidence(pack, (ctx && ctx.requirementText) || '', (ctx && ctx.outputSchema) || null);
  // 255c: unfilled slots carry the renegotiation exit — empty required
  // fields burn verify cycles on guaranteed reds; io.confirm FIRST when the
  // page genuinely lacks the field.
  // 256th round (FIX B): THREE-WAY next route, applied to every receipt
  // shape. populationHint (population not grounded as organic) outranks the
  // unfilled slots — nothing else matters until the population itself is
  // grounded, so binding slots against a rec-dominated window is wasted
  // work; the 255c renegotiation exit keeps the middle rank; a fully-bound
  // synthesis falls through to the shape's base (engine-pending names the
  // engine apply pipeline, the applied shape goes straight to verify, and
  // the error shape keeps its fix-the-rejection teaching as the base).
  const NEXT_ROUTE_ANNOTATE_256 = 'annotate.request (mark one organic card — containerSel is in populationHint) or verify.run to test as-is';
  const nextWithReneg255c = synth && Array.isArray(synth.unfilled) && synth.unfilled.length
    ? 'verify.run (unfilled slots above may RED — bind them via their templates, or renegotiate via io.confirm FIRST if the page genuinely lacks them)'
    : null;
  if (censusErrorDigest) {
    synth.unfilled.push({ slot: 'census', reason: 'census hop failed: ' + censusErrorDigest.slice(0, 140) + ' — selectors fell back to web-generic ARIA conventions; the failing probe error above is the gap' });
  }
  // 249th round (FIX 3): surface the census mount phase on EVERY receipt
  // shape — whether the bounded mount (scrollRounds) actually ran is the
  // first question a mounted-window-bias post-mortem asks, and the old
  // receipt never answered it.
  const censusMount = (census && census.mount && typeof census.mount === 'object') ? census.mount : undefined;
  // 251st round: EARLY population-uncertainty hint. The annotate.request
  // escalation family (208th/230th) fired only on CONSECUTIVE verify
  // failures — the live session had 2 differently-classed reds and finished
  // without a third verify, while THIS receipt already knew the population
  // was not grounded as organic. Weak identity = the CARD's identity filter
  // came from NEITHER measured hrefIdentity tokens NOR a derived path
  // prefix (a churn-prone class/url-lane fallback instead) AND (the census
  // mount never reached an identity-bearing window OR no identity tokens
  // exist at all) — the rec-dominated-window fingerprint. Route to the
  // user's two minutes of marking BEFORE selector archaeology.
  const hrefTokens251 = queryTokensOf_248(census);
  const weakIdentity251 = !(synth.selectorProvenance && synth.selectorProvenance.source === 'hrefIdentity-tokens')
    && !(synth.selectorProvenance && synth.selectorProvenance.source === 'path-prefix')
    && ((censusMount && censusMount.goalMet === false) || (hrefTokens251.length === 0 && !pathIdentity));
  let populationHint251 = null;
  if (weakIdentity251) {
    const cardSel251 = computeCard_249({ census: census, pathIdentity: pathIdentity });
    populationHint251 = 'the population is NOT grounded as organic (mount '
      + (censusMount && censusMount.goalMet === false ? 'did not reach an identity-bearing window' : 'found no identity tokens')
      + ') — before tuning selectors, ask the user to MARK one organic card: annotate.request({containerSel: '
      + JSON.stringify(cardSel251) + ', why: "mark the real post cards once"}) — two minutes of user marking beats selector archaeology on a rec-dominated window';
  }
  // 256th round (FIX B): the three-way resolver — populationHint wins over
  // everything, then the 255c renegotiation exit, then the shape's base.
  const nextRoute256 = function (base) {
    if (populationHint251) return NEXT_ROUTE_ANNOTATE_256;
    return nextWithReneg255c || base;
  };
  if (!(ctx && typeof ctx.applyArtifact === 'function')) {
    return {
      applied: 'engine-pending',
      steps: synth.steps,
      unfilled: synth.unfilled,
      ledgerConflicts: ledgerConflicts253.length ? ledgerConflicts253 : undefined,
      selectorProvenance: synth.selectorProvenance,
      merge: mergeNote,
      sweepCostMs: Date.now() - t0,
      bootstrapCapped: bootstrapCapped || undefined,
      attrGrounding: attrGrounding || undefined,
      censusMount: censusMount,
      populationHint: populationHint251 || undefined,
      affordanceSkipped: affordanceSkipped || undefined,
      next: nextRoute256('engine applies + verify.run')
    };
  }
  try {
    const applied = await ctx.applyArtifact({ steps: synth.steps });
    return {
      applied: true,
      ledgerConflicts: ledgerConflicts253.length ? ledgerConflicts253 : undefined,
      version: (applied && applied.version) || null,
      merge: mergeNote,
      unfilled: synth.unfilled,
      selectorProvenance: synth.selectorProvenance,
      sweepCostMs: Date.now() - t0,
      bootstrapCapped: bootstrapCapped || undefined,
      attrGrounding: attrGrounding || undefined,
      censusMount: censusMount,
      populationHint: populationHint251 || undefined,
      affordanceSkipped: affordanceSkipped || undefined,
      next: nextRoute256('verify.run')
    };
  } catch (eApply) {
    return {
      applied: false,
      ledgerConflicts: ledgerConflicts253.length ? ledgerConflicts253 : undefined,
      error: String((eApply && eApply.message) || eApply),
      merge: mergeNote,
      unfilled: synth.unfilled,
      selectorProvenance: synth.selectorProvenance,
      sweepCostMs: Date.now() - t0,
      bootstrapCapped: bootstrapCapped || undefined,
      attrGrounding: attrGrounding || undefined,
      censusMount: censusMount,
      populationHint: populationHint251 || undefined,
      affordanceSkipped: affordanceSkipped || undefined,
      next: nextRoute256('fix the rejection or call artifact.propose again after probe.census')
    };
  }
}

const JT_API_246 = {
  parseRequirementClauses, synthesizeFromEvidence, proposeArtifact,
  renderExpandStepFragment, renderHoverPopoverFragment, renderExclusionGuardFragment,
  BOOTSTRAP_CONTAINERS: BOOTSTRAP_CONTAINERS_246,
  BUTTON_FAMILIES: BUTTON_FAMILIES_249,
  chooseAffordanceSelector_249, derivePathIdentity_249, computeCard_249,
  scopeFamilyToSelector_253, countSlotTemplate253b,
  CLAUSE_RES: CLAUSE_RES_246
};
// Dual export (probe-tools pattern): Node tests use require, the wizard
// page loads this as a plain script tag — session-tools.js resolves it via
// the __artifactProposerModuleMarker__ global (check wizard.html load order).
if (typeof module !== 'undefined' && module.exports) module.exports = JT_API_246;
else (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : self)).__artifactProposerModuleMarker__ = JT_API_246;
