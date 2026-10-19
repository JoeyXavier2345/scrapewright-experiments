# E1 Experiment Workflow

## Branching and publication

Use one branch per experimental build. Name branches `experiment/e1-build-N`, replacing `N` with the build number. Start the first branch from the latest published experiment branch; start each later build branch from the preceding build branch so build history remains reviewable in order.

Before beginning a build, create its branch and record the branch and base commit in the preregistration. Keep each build's report, observations, screenshots, sanitized console evidence, and aggregate token row with that build's branch. Include a prior-build report amendment only when it directly records the new build's follow-up analysis.

Keep unredacted console captures and other private evidence in ignored local storage such as `.tmp/build-N-private/`. Before staging, review every publishable log, screenshot, and document for provider endpoints, credentials, extension identifiers, and unrelated personal or page data. Sanitize publishable copies and verify the private originals are not staged.

After the report and accounting are complete, commit the build's evidence on its branch and push that branch for review. Do not combine multiple new builds into one branch or push experiment evidence directly to the default branch. Merge or publish builds in numerical order so each later branch has the preceding build's evidence as its base.
