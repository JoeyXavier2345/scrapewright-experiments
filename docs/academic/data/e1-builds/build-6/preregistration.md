# E1 Service A — Build 6 Preregistration

## Status

Build 6 preparation began at `2026-08-27T14:32:30.778+08:00`. This record was created before Phase 1 Research; at creation time, the official interactive start was unset.

At preparation time, the native host on port 8765 reported healthy, the extension connected, and the job queue idle.

The user confirmed activating Research at `2026-08-27T14:44:26.459+08:00`; this is the official interactive Build 6 start. At that boundary, the native host reported healthy and the extension connected.

## Design

Build 6 is a controlled replication of Build 5. It changes no experimental task, model, endpoint, effective timeout, effective output budget, test input, acceptance rule, or read-only boundary.

The implementation now uses 300 seconds and 16,384 tokens as its built-in LLM defaults (commit `4ddaf08`), matching the effective values already used by Builds 4 and 5. This code-default change is recorded as environment provenance but does not change Build 6's effective LLM settings relative to Build 5.

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
| Browser | User's already-running authenticated Chrome session through Scrapewright |
| Data scope | Public repository data only |
| Account-changing actions | Prohibited |

The API key, account identity, and workspace-specific endpoint identifier must not be recorded in publishable artifacts.

## Exact Phase 1 wizard input

Build 6 must reuse the four Phase 1 fields in `../build-5/preregistration.md` under **Exact Phase 1 wizard input**, verbatim and without character-level edits:

1. Target URL
2. Input parameters
3. Page operations and data to collect
4. Output structure

This cross-reference freezes the complete strengthened input rather than introducing a paraphrased variant.

## Semantic decision rule

A test succeeds only if it returns exactly five repository records in displayed order and every record contains every declared key. Records one through three must directly contain detail-page-grounded `about`, `topics`, and `defaultBranch`. Records four and five must contain `about: null`, `topics: []`, and `defaultBranch: null`. Extra `result` nesting, fabricated values, omitted keys, visibly incorrect values, or operational success with semantically empty enrichment fails acceptance.

The workflow must remain strictly read-only. It must not be deployed unless the semantic rule passes. Failed generation, testing, or repair remains first-class evidence.

## Evidence procedure

- Reload the unpacked extension before opening the Build 6 wizard so commit `4ddaf08` is active.
- After confirming the Build 5 log is saved, clear DevTools Console before Build 6 Research.
- Enable Preserve log and retain unfiltered console history for the entire build.
- Record the official start at Research-button activation.
- Capture Phase 1/Research, Phase 4, and Phase 5 evidence when available.
- Save the complete console log before navigating away or writing the final report.
- Reconcile token totals against Alibaba Model Studio usage; browser logs are supporting evidence.
