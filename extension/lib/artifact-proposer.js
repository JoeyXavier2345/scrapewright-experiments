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

function synthesizeFromEvidence(pack, requirementText, outputSchema) {
  const clauses = parseRequirementClauses(requirementText);
  const census = (pack && pack.census) || null;
  const unfilled = [];
  const urlLane = census ? laneTop_246(census.lanes, 'url') : null;
  const timeLane = census ? laneTop_246(census.lanes, 'time') : null;
  const countLane = census ? laneTop_246(census.lanes, 'count') : null;
  const textLane = census ? laneTop_246(census.lanes, 'text') : null;
  const hrefTokens = (census && Array.isArray(census.hrefIdentity)) ? census.hrefIdentity.map((h) => h.token) : [];

  const baseCard = (census && census.containerSel) || BOOTSTRAP_CONTAINERS_246[0];
  const identitySel = urlLane ? urlLane.selector : null;
  const CARD = identitySel ? baseCard + ':has(' + identitySel + ')' : baseCard;
  if (!identitySel) unfilled.push({ slot: 'postUrl', reason: 'no url-like census lane — the population filter and the link field have no measured selector; run probe.census or hand-bind' });

  // Identity regex DERIVED from the page's own href-identity tokens (red line:
  // no vendor tokens — the page census names the id parameter). The emitted
  // string must carry ONE backslash before w so the generated script's regex
  // reads \w (word chars), matching the single-level fallback form below.
  const idRe = hrefTokens.length
    ? '/(?:' + hrefTokens.map(escRe_246).join('=|') + '=)(\\w{3,})/'
    : '/[?&]([A-Za-z0-9_-]{6,})/';

  const steps = [];
  steps.push({ id: 'wait', name: 'wait for cards', script: 'await $wait(' + JSON.stringify(CARD) + ', 3000);\nreturn { done: true };', onSuccess: clauses.scroll ? 'collect' : (clauses.expand ? 'expand' : 'extract'), onFailure: 'TERMINATE', maxIterations: 1 });
  if (clauses.scroll) {
    steps.push({
      id: 'collect', name: 'scroll until enough cards', maxIterations: 15,
      script: 'const CARD = ' + JSON.stringify(CARD) + ';\nconst r = await $collectUntil(CARD, { targetCount: __input__.count || 5, idAttr: \'href\' });\nreturn { done: true, count: r.count, certified: r.certified || null };',
      onSuccess: clauses.expand ? 'expand' : 'extract', onFailure: 'extract'
    });
  }
  if (clauses.expand) {
    steps.push({
      id: 'expand', name: 'expand collapsed text', maxIterations: 1,
      script: 'await $clickInList(' + JSON.stringify(CARD) + ', \'div[role=button], span[role=button]\', { textFilter: \'~see more|展开\', delayMs: 400 }).catch(function () {});\nawait new Promise(function (r) { setTimeout(r, 1200); });\nreturn { done: true };',
      onSuccess: 'extract', onFailure: 'extract'
    });
  }

  const item = schemaItemFields_246(outputSchema);
  const schemaFields = item ? item.fields : [];
  const slotFor = (laneKind) => {
    for (const pair of VOCAB_SLOT_246) { if (pair[0] === laneKind && schemaFields.indexOf(pair[1]) > -1) return pair[1]; }
    return null;
  };
  const urlSlot = slotFor('url') || 'postUrl';
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
    for (const s of ['likeCount', 'commentCount', 'shareCount']) {
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

  const markerGuards = clauses.exclusionMarkers.length
    ? '  if (' + JSON.stringify(clauses.exclusionMarkers) + '.some(function (m) { return String(r.tsAria || \'\').trim().toLowerCase() === m; })) continue;\n'
    : '';
  const extractScript = [
    'const CARD = ' + JSON.stringify(CARD) + ';',
    'const rs = await $extractWithHover(CARD, {',
    '  ' + fm.concat(timeFm).join(',\n  '),
    '}, { hover: { anchorSel: ' + JSON.stringify(anchorSel) + ' }, maxContainers: Math.min(__input__.count || 10, 50) });',
    'const num = function (s) { const m = String(s || \'\').match(/[\\d.,]+[KMkm]?/); return m ? m[0] : \'\'; };',
    'const posts = [];',
    'for (const r of rs) {',
    '  if (!r.' + urlSlot + ') continue;',
    markerGuards +
    '  const idm = String(r.' + urlSlot + ').match(' + idRe + ');',
    '  const times = [r.tsAria, r.tsLabel, r.tsHover].map(function (t) { return String(t || \'\').trim(); }).filter(Boolean);',
    '  const abs = times.find(function (t) { return /(19|20)\\d{2}/.test(t); });',
    '  const labs = (r.labels || []).map(function (x) { return String(x || \'\').trim(); });',
    '  const like = (labs.find(function (l) { return /^like\\s*:/i.test(l); }) || \'\').replace(/^like\\s*:\\s*/i, \'\').replace(/\\s+people.*$/i, \'\');',
    '  const commL = labs.find(function (l) { return /comment/i.test(l) && /\\d/.test(l); }) || \'\';',
    '  const shrL = labs.find(function (l) { return /share/i.test(l) && /\\d/.test(l); }) || \'\';',
    '  posts.push({',
    '    postId: idm ? idm[1] : \'\',',
    '    ' + urlSlot + ': r.' + urlSlot + ',',
    '    postTime: abs || times[0] || \'\',',
    '    content: r.content || \'\',',
    '    likeCount: like, commentCount: num(commL), shareCount: num(shrL),',
    '    mediaUrls: (r.mediaUrls || []).filter(function (u) { return /^https?:/.test(String(u)); }),',
    '    htmlSnippet: String(r.htmlSnippet || \'\').slice(0, 5000)',
    '  });',
    '  if (posts.length >= (__input__.count || 5)) break;',
    '}',
    'return { posts: posts };'
  ].join('\n');
  steps.push({ id: 'extract', name: 'extract cards with hover', script: extractScript, onSuccess: 'TERMINATE', onFailure: 'TERMINATE', maxIterations: 1 });
  if (!census) unfilled.push({ slot: 'census', reason: 'no census evidence in this session — selectors fell back to web-generic ARIA conventions; re-run artifact.propose after probe.census for measured lanes' });
  return { steps: steps, unfilled: unfilled };
}

// Phase-3 renderers: decisive red receipts carry COPY-READY fix fragments —
// the model pastes instead of composing (every composition slip costs a
// 90s verify). Pure string builders, unit-testable.
function renderExpandStepFragment(cardSel) {
  return 'await $clickInList(' + JSON.stringify(String(cardSel)) + ', \'div[role=button], span[role=button]\', { textFilter: \'~see more|展开\', delayMs: 400 });';
}
function renderHoverPopoverFragment(fieldName, anchorSel) {
  return fieldName + ': { selector: ' + JSON.stringify(String(anchorSel)) + ', read: \'hoverPopover\', match: /(19|20)\\d{2}/ },';
}
function renderExclusionGuardFragment(fieldName, marker) {
  return '.filter(function (p) { return String(p.' + fieldName + ' || \'\').toLowerCase() !== \'' + String(marker).toLowerCase() + '\'; })';
}

// Sweep: bootstrap the container by counting generic families, then ONE
// census (hover:true). Every hop is try/catch — a failed hop is an evidence
// gap, never a crash. Synthesis is pure (above); application goes through
// ctx.applyArtifact so EVERY update gate (chain validation, syntax
// construction, schema checks) still applies — the joint solver never
// bypasses the same gates service.update faces.
async function proposeArtifact(ctx) {
  const t0 = Date.now();
  const mergeNote = (ctx && ctx.currentArtifact) ? 'regenerated-from-fresh-sweep (hand-tuned slots are NOT preserved — re-check any slot you had fixed by hand)' : 'fresh';
  const probes = (ctx && ctx.probes) || {};
  let containerSel = null;
  for (const cand of BOOTSTRAP_CONTAINERS_246) {
    try {
      const c = await probes.count({ sel: cand });
      const n = c && typeof c.count === 'number' ? c.count : 0;
      if (n >= 3 && n <= 200) { containerSel = cand; break; }
    } catch (e) { /* next candidate */ }
  }
  let census = null;
  if (containerSel) {
    try { census = await probes.census({ containerSel: containerSel, samples: 5, hover: true }); }
    catch (e) { census = { error: String((e && e.message) || e) }; }
  }
  const pack = { census: census, currentArtifact: (ctx && ctx.currentArtifact) || null };
  const synth = synthesizeFromEvidence(pack, (ctx && ctx.requirementText) || '', (ctx && ctx.outputSchema) || null);
  try {
    const applied = await ctx.applyArtifact({ steps: synth.steps });
    return {
      applied: true,
      version: (applied && applied.version) || null,
      merge: mergeNote,
      unfilled: synth.unfilled,
      sweepCostMs: Date.now() - t0,
      next: 'verify.run'
    };
  } catch (eApply) {
    return {
      applied: false,
      error: String((eApply && eApply.message) || eApply),
      merge: mergeNote,
      unfilled: synth.unfilled,
      sweepCostMs: Date.now() - t0,
      next: 'fix the rejection or call artifact.propose again after probe.census'
    };
  }
}

const JT_API_246 = {
  parseRequirementClauses, synthesizeFromEvidence, proposeArtifact,
  renderExpandStepFragment, renderHoverPopoverFragment, renderExclusionGuardFragment,
  BOOTSTRAP_CONTAINERS: BOOTSTRAP_CONTAINERS_246
};
// Dual export (probe-tools pattern): Node tests use require, the wizard
// page loads this as a plain script tag — session-tools.js resolves it via
// the __artifactProposerModuleMarker__ global (check wizard.html load order).
if (typeof module !== 'undefined' && module.exports) module.exports = JT_API_246;
else (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : self)).__artifactProposerModuleMarker__ = JT_API_246;
