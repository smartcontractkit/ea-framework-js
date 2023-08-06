# Github workflows for EAv3 Framework

**Please note that this work is in progress. The README may not be kept up to date as the CI process changes. This message will be removed when we're somewhat stable.**

## Actions
### setup
Runs yarn install, then yarn build. Split into an action to avoid boilerplate in jobs.

### validate-version-labels
Checks that all PRs have a version bump label (major, minor, patch, or none). Used as a part of our basic chechs and when we close a PR

### set-git-credentials
Sets a common git configuration for the rare instances where we need to run raw git commands, such as when pushing tags after `npm --version

## Workflows


### [main](workflows/main.yaml)
Builds, tests, and lints the code. Triggered by any pull request action or a push on the main branch.

This workflow does not run against branches prefixed with version-bump/**. Those branches, which are automatically created by close-pr.yaml, have their own validation method.

### [pinned-dependencies](workflows/pinned-dependencies.yaml)
Checks for un-pinned versions of dependencies in package.json file and reports errors if any are found. 
It helps ensure that all dependencies have explicit version constraints, promoting reproducibility and stability in the project.

### [publish](workflows/publish.yaml)
The workflow is triggered either manually or when a push event occurs on the "main" branch with modified "package.json" file. It compares the current version of the package with the published version on NPM and proceeds with publishing if they're different.

### [add-or-validate-labels](workflows/add-or-validate-labels.yaml)
Checks if the PR contains version bump instructions. Triggered by any changes to a PR's labels.

This validation work is captured outside of `main` because `main` doesn't reliably execute after open-pr is complete. This can be fixed later.

### [open-version-bump-pr.yaml](workflows/open-version-bump-pr.yaml)
Runs when any PR is closed by merging with the base branch.Does the following things
1. Checks if there is existing branch named 'version-bump', if not creates it from main (remember, the original PR is merged at this point) and runs NPM version with the original PR's version label. 
2. Compares the version of package.json from 'version-bump' branch with new version change produced by NPM version command. If the exsiting version in 'version-bump' is equal or higher, it skips the third and fifth steps.
3. Creates a new commit in package.json with version change.
4. Checks and updates the code-coverage badge in Readme.md if the coverage report from original PR is different from the coverage report in 'version-bump' branch.
5. Creates or updates the PR from 'version-bump' branch to 'main'. 

## Testing
Most workflows have the manual_dispatch flag, which lets you trigger a manual run in the UI or, preferably, the GitHub cli.  
You can trigger workflows using the CLI by running commands in this form
```bash
gh workflow run --repo smartcontractkit/ea-framework-js --ref main main.yaml -F dry-run=true
```
