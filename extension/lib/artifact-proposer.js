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
  return /^[a-z0-9]*\.[a-z0-9_-]+$/i.test(s) || s.indexOf('[') === -1;
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
  const idRe = hrefTokens.length
    ? '/(?:' + hrefTokens.map((t) => '[?&]' + escRe_246(t.slice(6)) + '=').join('|') + ')(\\w{3,})/'
    : (identityChoice.idRegex || '/[?&]([A-Za-z0-9_-]{6,})/');

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
  if (timeLane) {
    timeFm.push('tsAria: { selector: ' + JSON.stringify(timeLane.selector) + ', attr: \'aria-label\' }');
    timeFm.push('tsLabel: { selector: ' + JSON.stringify(timeLane.selector) + ', labelledby: true }');
    timeFm.push('tsHover: { selector: ' + JSON.stringify(timeLane.selector) + ', read: \'hoverPopover\', match: /(19|20)\\d{2}/ }');
  } else {
    unfilled.push({ slot: 'postTime', reason: 'no time-like census lane — run probe.census {hover:true} or bind the timestamp anchor by hand' });
  }
  if (countLane) {
    fm.push('labels: { selector: \'[aria-label]\', attr: \'aria-label\', multi: true }');
  } else {
    // 248th round (FIX 3): the plural schema names are checked too — a
    // schema declaring likes/comments/shares must see THOSE slots named as
    // the gaps, not the canonical likeCount family it never declared.
    for (const s of ['likeCount', 'likes', 'commentCount', 'comments', 'shareCount', 'shares']) {
      if (schemaFields.indexOf(s) > -1) unfilled.push({ slot: s, reason: 'no count-like census lane on this page — renegotiate via io.confirm or bind the count carrier by hand' });
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
  const extractScript = [
    'const CARD = ' + JSON.stringify(CARD) + ';',
    'const rs = await $extractWithHover(CARD, {',
    '  ' + fm.concat(timeFm).join(',\n  '),
    '}, { hover: { anchorSel: ' + JSON.stringify(anchorSel) + ' }, maxContainers: Math.min(__input__.count || 10, 50) });',
    'const num = function (s) { const m = String(s || \'\').match(/[\\d.,]+[KMkm]?/); return m ? m[0] : \'\'; };',
    'const posts = [];',
    'for (const r of rs) {',
    urlGuardLine,
    '  const idm = String(r.' + urlSlot + ').match(' + idRe + ');',
    '  const times = [r.tsAria, r.tsLabel, r.tsHover].map(function (t) { return String(t || \'\').trim(); }).filter(Boolean);',
    '  const abs = times.find(function (t) { return /(19|20)\\d{2}/.test(t); });',
    markerGuards + '  const labs = (r.labels || []).map(function (x) { return String(x || \'\').trim(); });',
    '  const like = (labs.find(function (l) { return /^like\\s*:/i.test(l); }) || \'\').replace(/^like\\s*:\\s*/i, \'\').replace(/\\s+people.*$/i, \'\');',
    '  const commL = labs.find(function (l) { return /comment/i.test(l) && /\\d/.test(l); }) || \'\';',
    '  const shrL = labs.find(function (l) { return /share/i.test(l) && /\\d/.test(l); }) || \'\';',
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
  ].filter(function (line) { return line != null; }).join('\n');
  steps.push({ id: 'extract', name: 'extract cards with hover', script: extractScript, onSuccess: 'TERMINATE', onFailure: 'TERMINATE', maxIterations: 1 });
  if (!census) unfilled.push({ slot: 'census', reason: 'no census evidence in this session — selectors fell back to web-generic ARIA conventions; re-run artifact.propose after probe.census for measured lanes' });
  // 248th round (FIX 2): the identity-selector provenance — which selector
  // the CARD :has() filter and the postUrl field bind, and whether it came
  // from the measured url lane or the churn-proof hrefIdentity token union.
  // 249th round (FIX 1): when the sweep MEASURED an affordance family, the
  // receipt names it — the expand step's sub-selector is a claim about the
  // page and must be auditable like every other selector.
  const provenance = { identitySelector: identitySel, source: identityChoice.source };
  if (affordanceSel) provenance.affordanceSelector = affordanceSel;
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
    // population. 5 hops x (900px scroll + 900ms settle + count) ≈ 9-12s
    // worst case — still inside the 120s sweep budget that gates the hop.
    const censusArgs = { containerSel: containerSel, samples: 5, hover: true, scrollRounds: 5 };
    const remaining = budget.totalMs - elapsedMs();
    if (typeof remaining === 'number' && remaining > 0) {
      censusArgs.timeoutMs = Math.max(budget.censusMinMs, remaining - 10000);
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
        const c = await probes.count({ sel: affordanceCard + ' ' + fam });
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
  const synth = synthesizeFromEvidence(pack, (ctx && ctx.requirementText) || '', (ctx && ctx.outputSchema) || null);
  if (censusErrorDigest) {
    synth.unfilled.push({ slot: 'census', reason: 'census hop failed: ' + censusErrorDigest.slice(0, 140) + ' — selectors fell back to web-generic ARIA conventions; the failing probe error above is the gap' });
  }
  // 249th round (FIX 3): surface the census mount phase on EVERY receipt
  // shape — whether the bounded mount (scrollRounds) actually ran is the
  // first question a mounted-window-bias post-mortem asks, and the old
  // receipt never answered it.
  const censusMount = (census && census.mount && typeof census.mount === 'object') ? census.mount : undefined;
  if (!(ctx && typeof ctx.applyArtifact === 'function')) {
    return {
      applied: 'engine-pending',
      steps: synth.steps,
      unfilled: synth.unfilled,
      selectorProvenance: synth.selectorProvenance,
      merge: mergeNote,
      sweepCostMs: Date.now() - t0,
      bootstrapCapped: bootstrapCapped || undefined,
      attrGrounding: attrGrounding || undefined,
      censusMount: censusMount,
      affordanceSkipped: affordanceSkipped || undefined,
      next: 'engine applies + verify.run'
    };
  }
  try {
    const applied = await ctx.applyArtifact({ steps: synth.steps });
    return {
      applied: true,
      version: (applied && applied.version) || null,
      merge: mergeNote,
      unfilled: synth.unfilled,
      selectorProvenance: synth.selectorProvenance,
      sweepCostMs: Date.now() - t0,
      bootstrapCapped: bootstrapCapped || undefined,
      attrGrounding: attrGrounding || undefined,
      censusMount: censusMount,
      affordanceSkipped: affordanceSkipped || undefined,
      next: 'verify.run'
    };
  } catch (eApply) {
    return {
      applied: false,
      error: String((eApply && eApply.message) || eApply),
      merge: mergeNote,
      unfilled: synth.unfilled,
      selectorProvenance: synth.selectorProvenance,
      sweepCostMs: Date.now() - t0,
      bootstrapCapped: bootstrapCapped || undefined,
      attrGrounding: attrGrounding || undefined,
      censusMount: censusMount,
      affordanceSkipped: affordanceSkipped || undefined,
      next: 'fix the rejection or call artifact.propose again after probe.census'
    };
  }
}

const JT_API_246 = {
  parseRequirementClauses, synthesizeFromEvidence, proposeArtifact,
  renderExpandStepFragment, renderHoverPopoverFragment, renderExclusionGuardFragment,
  BOOTSTRAP_CONTAINERS: BOOTSTRAP_CONTAINERS_246,
  BUTTON_FAMILIES: BUTTON_FAMILIES_249,
  chooseAffordanceSelector_249, derivePathIdentity_249, computeCard_249,
  CLAUSE_RES: CLAUSE_RES_246
};
// Dual export (probe-tools pattern): Node tests use require, the wizard
// page loads this as a plain script tag — session-tools.js resolves it via
// the __artifactProposerModuleMarker__ global (check wizard.html load order).
if (typeof module !== 'undefined' && module.exports) module.exports = JT_API_246;
else (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : self)).__artifactProposerModuleMarker__ = JT_API_246;
