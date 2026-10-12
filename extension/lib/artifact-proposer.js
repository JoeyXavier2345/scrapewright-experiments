// extension/lib/artifact-proposer.js
//
// Joint solver (2026-10-13 spec, docs/superpowers/specs/…-joint-solver-design.md):
// compiles the session's EVIDENCE into a complete artifact — the mechanized
// version of what the 245th-round post-mortem did by hand. Three layers:
//   parseRequirementClauses   — pure: requirement text → step directives
//   synthesizeFromEvidence   — pure: evidence pack → full step graph
//   proposeArtifact          — sweep (drives existing probes) + synthesize + apply
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

module.exports = { parseRequirementClauses };
