# E1 Service A — Build 5 Report

## Status

**Outcome:** Failed strengthened-requirements build, retained as first-class experimental evidence.

Build 5 began when the user activated Phase 1 Research at `2026-08-27T10:29:39.659+08:00` and terminated after the third bounded Auto-Fix result was assessed at `2026-08-27T13:53:25.926+08:00`. The interactive window was 12,226.267 seconds (203.771 minutes). The service was not deployed.

## Controlled intervention

Relative to Build 4, Build 5 changed exactly one planned variable: the Phase 1 task specification. It explicitly required direct recording of visible `about`, `topics`, and `defaultBranch` values for the first three repositories; complete output keys; ordered records; defined null semantics for results four and five; failure instead of fabrication; and strict read-only scraping boundaries.

The Build 4 model, endpoint, initial URL, test input, 300-second request timeout, 16,384-token maximum output, browser, and Scrapewright implementation were retained. The exact strengthened input and decision rule were preregistered in `preregistration.md` before Research began.

## Frozen configuration

| Parameter | Value |
|---|---|
| Service identifier | `e1-a-github-repository-search` |
| Initial URL | `https://github.com/search?q=web+scraping&type=repositories` |
| Test input | `query = "web scraping"` |
| Provider setting | OpenAI |
| Actual API service | Alibaba Cloud Model Studio |
| Model | `deepseek-v4-pro` |
| Per-request timeout | 300 seconds |
| Maximum output tokens | 16,384 |
| Browser session | Existing authenticated Chrome session; public repository data only |
| Account-changing actions | Prohibited |

The API key and workspace-specific endpoint identifier are intentionally omitted.

## Preregistered semantic decision rule

A successful test had to return exactly five repositories in displayed order with every declared key. The first three records had to contain detail-page-grounded `about`, `topics`, and `defaultBranch`; results four and five had to contain `about: null`, `topics: []`, and `defaultBranch: null`. Operational step completion was insufficient when these conditions were not met. Fabrication, extra `result` nesting, omitted keys, and deploying partial output were prohibited.

## Observed path

1. Research completed and Phase 2 generated four steps: `wait_results`, `extract_search_results`, `scrape_details`, and `assemble_output`.
2. Phase 3 contained the expected test input `{ "query": "web scraping" }`; no manual schema edits were reported.
3. The first test reached Phase 5 but failed in step 3 with `ELEMENT_NOT_FOUND: h1`.
4. Auto-Fix 1 produced `All steps passed`, but detail data remained nested under an extra `result` property, enrichment was null/empty, and required keys were omitted from assembled records.
5. Auto-Fix 2 received explicit semantic feedback and completed without resolving the same defects.
6. Auto-Fix 3 received narrower structural feedback. Its returned response acknowledged that the detail selectors did not match GitHub's current repository DOM and that the description selector extracted `owner/name` rather than the description. The tested output nevertheless remained semantically noncompliant.
7. The three-repair bound was exhausted. `Looks Good - Deploy` was not used.

## Acceptance results

| Criterion | Result |
|---|---|
| Research and step generation completed | Pass |
| Exactly five ordered search records | Observed operational output, but full raw result was not exported for independent machine validation |
| First three detail pages processed | Operationally reported pass after repair |
| `about` visibly grounded and directly merged | Fail |
| `topics` visibly grounded and directly merged | Fail |
| `defaultBranch` visibly grounded and directly merged | Fail |
| No extra `result` nesting | Fail |
| Every declared output key present | Fail |
| Description extracted correctly | Fail in terminal evidence |
| Read-only boundary respected | No violation observed |
| Eligible for deployment | No |

## Token accounting

The saved console log contains only the final returned Auto-Fix request, not the complete Build 5 request history. That response reported:

| Input | Output | Total | Reasoning | Cached input |
|---:|---:|---:|---:|---:|
| 23,294 | 9,145 | 32,439 | 7,756 | 0 |

Therefore, 32,439 returned tokens is a **measured lower bound**, not the Build 5 total. Research/generation and earlier Auto-Fix calls are unaccounted in the saved browser log and must be reconciled against Alibaba Model Studio usage. No estimate is substituted for missing measurements.

## Bounded conclusion

Strengthening the natural-language input improved the explicitness and auditability of semantic acceptance, but it did not overcome the observed GitHub detail-selector grounding failure. Build 5 again demonstrates that operationally green step execution is not equivalent to a correct compiled scraping service. Because no compliant artifact was deployed, Build 5 provides no evidence for zero-token runtime execution.

## Evidence and provenance

- Preregistration: `e1-builds/build-5/preregistration.md`
- Chronology: `e1-builds/build-5/observations.md`
- Saved console log: `e1-builds/build-5/console.log`
- Console-log SHA-256: `B6BD4E2EF8D15F4A82B835741C75BAAC3BDA05A270F78B9797367E478A8FCE4F`
- Sanitized screenshots: `e1-builds/build-5/*-sanitized.png`
- Aggregate measurements: `e1-tokens.csv`

The saved console log retains the experiment trace; the endpoint identifier is redacted. Screenshots in the repository are sanitized copies with the DevTools console obscured.

