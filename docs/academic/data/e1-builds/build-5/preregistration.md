# E1 Service A — Build 5 Preregistration

## Status

Build 5 was initialized at `2026-08-27T09:56:18.521+08:00`. This record was created before starting wizard generation.

At `2026-08-27T10:16:34.756+08:00`, the native host reported healthy, the extension was connected, and the job queue was idle. A later screenshot showed that Phase 1 Research had not yet been initiated, so this timestamp is retained only as a preflight observation and is not the official interactive Build 5 start. The official start time must be recorded at the actual Research-button activation.

The user confirmed activating the Research button at `2026-08-27T10:29:39.659+08:00`; this is the official interactive Build 5 start time. At the recorded boundary, the native host reported healthy and the extension connected.

## Controlled intervention

Build 5 changes exactly one planned variable relative to Build 4: the Phase 1 task specification is strengthened to make semantic recording requirements, validation rules, and read-only scraping boundaries explicit.

The model, endpoint, initial URL, test value, 300-second LLM request timeout, 16,384-token maximum output, browser, and Scrapewright implementation remain unchanged. No generated selector or script is manually supplied in Phase 1.

## Frozen configuration

| Parameter | Value |
|---|---|
| Service identifier | `e1-a-github-repository-search` |
| Target | GitHub public repository search |
| Provider setting | OpenAI |
| Actual API service | Alibaba Cloud Model Studio |
| Model | `deepseek-v4-pro` |
| Per-request timeout | 300 seconds |
| Maximum output tokens | 16,384 |
| Browser | User's already-running Chrome through Scrapewright |
| Test input | `query = "web scraping"` |
| Account-changing actions | Prohibited |

The API key and workspace-specific endpoint identifier must not be recorded.

## Exact Phase 1 wizard input

### Target URL

```text
https://github.com/search?q=web+scraping&type=repositories
```

### Input parameters

```text
query — required non-empty string; GitHub public-repository search phrase. Test value: web scraping.
```

### Page operations and data to collect

```text
Search GitHub public repositories using the query input. Process exactly the first five repository results in their original displayed order. Do not reorder, replace, deduplicate, or skip results.

For each of the five results, record repository name, owner, description, absolute HTTPS repository URL, displayed star count, displayed primary language, and displayed last-updated text.

Open only the repository detail pages for the first three results. For each of these three repositories, explicitly inspect and record:

- about: the complete visible text in the repository's About section;
- topics: every visible repository topic as a separate string, preserving displayed order;
- defaultBranch: the repository's visibly identified default branch name.

For results four and five, do not open their detail pages. Record about as null, topics as [], and defaultBranch as null.

Strict extraction and validation rules:

1. Return exactly five repository records in search-result order.
2. Use only information visible on the permitted GitHub pages during this run. Do not use APIs, external sites, cached data, prior knowledge, or inferred values.
3. Preserve visible text faithfully, allowing only surrounding whitespace to be trimmed.
4. Separate owner and repository name even when displayed together as owner/name.
5. Record topics as an array of individual strings, not as combined text.
6. Never assume that the default branch is main or master; record only the value identified on the detail page.
7. For the first three results, about, topics, and defaultBranch must each be inspected. If a field is genuinely absent after the page has loaded, use null for about or defaultBranch and [] for topics.
8. If required data is visibly present but cannot be extracted, or exactly five compliant records cannot be produced, fail the run instead of returning partial, substituted, or fabricated data.
9. Every repository record must contain every field declared in the output structure. Do not add undeclared fields. Do not use empty strings for missing values.
10. The returned query must exactly match the supplied query input.

This is a strictly read-only task. Permitted actions are loading the specified public search page, reading the first five results, opening only the first three repository pages, scrolling as needed, and closing opened tabs.

Do not sign in, access private content, modify account or repository data, star, watch, follow, fork, sponsor, react, comment, create issues or pull requests, trigger workflows, or download content. Do not open detail pages for results four and five. Do not collect personal information or fields not requested. Do not bypass authentication, rate limits, CAPTCHAs, access controls, robots restrictions, or other protections. If GitHub presents a CAPTCHA, login requirement, abuse warning, or access restriction, stop and fail explicitly.
```

### Output structure

```text
{
  query: string,
  repositories: [{
    name: string,
    owner: string,
    description: string | null,
    url: string,
    stars: string,
    language: string | null,
    updatedText: string | null,
    about: string | null,
    topics: string[],
    defaultBranch: string | null
  }]
}
```

## Preregistered semantic decision rule

A wizard test is successful only if it returns exactly five ordered records with all declared keys; records one through three reflect explicit detail-page inspection of `about`, `topics`, and `defaultBranch`; records four and five contain `about: null`, `topics: []`, and `defaultBranch: null`; and all read-only boundaries are respected. Operationally green steps do not override this semantic rule.

If generation or testing fails, preserve the failure as Build 5 evidence. Save and verify the raw console log before writing the final report or updating aggregate token measurements.
