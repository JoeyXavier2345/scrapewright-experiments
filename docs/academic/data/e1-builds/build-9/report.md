# E1 Service A — Build 9 Report

## Status

**Terminal outcome: targeted resolver behavior observed to pass; semantic output failed; protocol deviation.** No service was deployed. The automatic repair opened two GitHub topic pages outside the preregistered page set, which triggered the stop condition.

The user-reported Research start boundary was `2026-10-19T15:25:27+08:00`; terminal semantic/protocol assessment was recorded at `2026-10-19T17:43:42+08:00`, an observed window of 8,295 seconds. The exact Research click time was not supplied.

## Design

Build 9 repeated Build 8's GitHub public-repository search workflow and added the frozen instruction to pass each repository link's raw DOM `href` directly to `$openTab`, without rewriting it. The intended targeted observation was whether the background resolver normalized relative repository hrefs against the GitHub search page.

## Observed execution

1. Research generated two steps, `extract search results` and `enrich first three repos`, with the test input `{"query":"web scraping"}`.
2. The initial run passed raw `/scrapy/scrapy` to `$openTab`; the background resolved it to `https://github.com/scrapy/scrapy`, and the detail tab completed. The run stopped after one detail result because step 2 terminated before iterating, returning `{records,currentIndex,query}` instead of `{query,repositories}`.
3. A user-invoked Auto-Fix changed the step flow. In the completed execution, the first three raw relative hrefs (`/scrapy/scrapy`, `/h4ckf0r0day/obscura`, `/lorien/awesome-web-scraping`) were passed directly to `$openTab`; the background resolved each to its matching HTTPS repository URL, and all three detail tabs completed.
4. The resulting top-level output had five records and the expected `query` and `repositories` keys, but records one through three omitted `about`, `topics`, and `defaultBranch`. The wizard's “All steps passed!” status did not reflect semantic compliance.
5. A second user-invoked Auto-Fix timed out in step 2 after the first detail tab became ready. A Retry Test later ran a generated repair after step 1 timed out. The repair split absolute URLs incorrectly, yielding empty repository names and `https:` owners. It selected topic-page links as records two and three, then opened `https://github.com/topics/python` and `https://github.com/topics/crawler`. These pages were outside the allowed page set. Build 9 stopped at this protocol deviation; no further repair or retry was performed.

## Targeted resolver assessment

**Classification: targeted behavior observed to pass in the live workflow.** The runtime trace shows raw relative repository hrefs reaching the background handler and being normalized to their corresponding GitHub repository URLs. This is a live behavior observation; the browser's exact loaded-from extension path was not established in the retained screenshots, so attribution to a particular checkout revision is not proven.

## Semantic and protocol assessment

| Criterion | Result |
|---|---|
| Five ordered repository records | Initial output had five entries; final retry preserved five positions but selected topic links for records two and three |
| Repository names and owners | Fail; final retry produced empty names and owner `https:` |
| First three detail pages | Resolver passed for valid repo hrefs in the prior completed execution; final retry opened two topic pages |
| First-three `about`, `topics`, `defaultBranch` | Fail; absent in the completed execution |
| Results four and five left unopened | No fourth/fifth repository detail page was opened; the retry did open two out-of-scope topic pages |
| Query/schema | Top-level keys matched in one execution; nested semantic requirements failed |
| Read-only/page boundary | Protocol deviation: opened two pages outside the permitted page set |
| Eligible for deployment | No |

## Repair and token accounting

The user invoked Auto-Fix twice. The first invocation was followed by two automatic failure-repair attempts; the second invocation produced a step-2 timeout. A later Retry Test triggered one automatic repair after a step-1 timeout. No third user-invoked Auto-Fix was used.

The complete saved console contains nine successful LLM request/usage pairs. Aggregate measured usage is 197,611 prompt tokens, 44,433 completion tokens, and 242,044 total tokens. These figures reconcile across all nine responses. The corresponding measured row is recorded in `../../e1-tokens.csv`.

## Evidence

- Preregistration: `preregistration.md`
- Contemporaneous notes: `observations.md`
- Sanitized consoles: `console.log`, `console-after-autofix.log`, `console-after-autofix-2.log`, and `console-after-retry.log`
- Final retry console SHA-256: `D4F13D9ED2C284D7CB1B9A4F715EA431F99CCE21B705A4A3ED4C9941A2976CC7`
- Screenshot evidence: `phase1-research-start.png`, `phase2-generated-steps.png`, `phase3-schema-test-input.png`, `phase5-initial-test-result.png`, `phase5-after-autofix.png`, `phase5-autofix-2-timeout.png`, and `phase5-retry-result.png`
- Raw consoles remain only in ignored `.tmp/build-9-private/` storage.

## Bounded conclusion

Build 9 provides live evidence that the background resolver handles raw relative repository hrefs correctly. The generated workflow did not satisfy the strict extraction requirements, and its later automatic repair opened two non-permitted topic pages. The run is terminal under the preregistered stop condition, semantically unsuccessful, and not deployable. Any further attempt requires a separately preregistered build with improved safeguards against topic links being mistaken for repository results.
