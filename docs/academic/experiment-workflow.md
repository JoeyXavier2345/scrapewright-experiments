# E1 Experiment Workflow

## Branching and publication

Use one independent branch per experimental build. Name branches `experiment/e1-build-N`, replacing `N` with the build number. Start each build branch from the same latest published base; do not base a build branch on another unpublished build branch. This keeps each build's commits isolated.

Before beginning a build, create its branch and record the branch and base commit in the preregistration. Keep each build's report, observations, screenshots, sanitized console evidence, and aggregate token row with that build's branch. Include a prior-build report amendment only when it directly records the new build's follow-up analysis.

Keep unredacted console captures and other private evidence in ignored local storage such as `.tmp/build-N-private/`. Before staging, review every publishable log, screenshot, and document for provider endpoints, credentials, extension identifiers, and unrelated personal or page data. Sanitize publishable copies and verify the private originals are not staged.

After the report and accounting are complete, commit the build's evidence on its branch, push it, and open a separate pull request against the default branch. Do not combine multiple new builds into one branch or push experiment evidence directly to the default branch. Review and merge the pull requests in numerical order; the branches themselves remain independent.
