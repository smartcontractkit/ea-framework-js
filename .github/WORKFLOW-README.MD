# Github workflows for EAv3 Framework

**Please note that this work is in progress. The README may not be kept up to date as the CI process changes. This message will be removed when we're somewhat stable.**

## Actions
### setup
Runs yarn install, then yarn build. Split into an action to avoid boilerplate in jobs.

### validate-version-labels
Checks that all PRs have a version bump label (major, minor, patch, or none). Used as a part of our basic chechs and when we close a PR

### set-git-credentials
Sets a common git configuration for the rare instances where we need to run raw git commands, such as when pushing tags after `npm --version`

### publish
Publishes the package to NPM. This action does not manage versions, so you need to run a workflow that automatically bumps the version, or bump the version by hand directly on the branch.

## Workflows

### [open-pr.yaml](workflows/open-pr.yaml)
Adds labels to a PR, including version bump labels, based on the branch name.

Labels are applied automatically only when a PR is opened. If it applies the wrong label (ex: your improvement is a minor ver, or some PR is a major ver), you can fix it by hand


### [main](workflows/main.yaml)
Builds, tests, and lints the code. Triggered by any pull request action or a push on the main branch.

This workflow does not run against branches prefixed with version-bump/**. Those branches, which are automatically created by close-pr.yaml, have their own validation method.

### [change-pr_validate-labels](workflows/change-pr_validate-labels.yaml)
Checks if the PR contains version bump instructions. Triggered by any changes to a PR's labels.

This validation work is captured outside of `main` because `main` doesn't reliably execute after open-pr is complete. This can be fixed later.


#### Label mappings:
Please refer to [open-pr.yaml](workflows/open-pr.yaml) for an authoritative list of labels. For your convenience, here are some of the most common branch prefixes and their labels:

| Branch Prefix  | Resulting label(s)  | Version bump                                                                    |
|----------------|---------------------|---------------------------------------------------------------------------------|
| release        | release, major      | major                                                                           |
| feature/       | feature, minor      | minor                                                                           |
| bugfix/        | bugfix, patch       | patch                                                                           |
| hotfix/        | hotfix, patch       | patch                                                                           |
| fix/           | hotpix, patch       | patch                                                                           |
| chore/         | chore, patch        | patch                                                                           |
| improvement/   | improvement, patch  | patch                                                                           |
| documentation/ | documentation, none | none                                                                            |
| version-bump/  | version-bump        | (Special behavior) Results in a publish on merge                                |
| (no prefix)    |                     | <p style="color:#e31c3d"><b>Should fail validation. Will error on merge</b></p> |


### [validate-version-bump-pr.yaml](workflows/validate-version-bump-pr.yaml)
This is essentially main for version-bump/** branches. It checks that the version-bump PR meets all of the following criteria:
1. Contains precisely one changed file from the target branch, package.json
2. package.json contains precisely one changed line (one add and one sub from git diff)
3. That one changed line matches the following regex: `^\s*"version": "\d+\.\d+\.\d+",$`

The main purpose of this is that if it passes, the reviewer can assume that it's safe to merge after basic DD.

### [close-pr.yaml](workflows/close-pr.yaml)
Runs when any PR is closed by merging with the base branch. Does one of two things depending on the branch prefix:
1. Anything but version-bump/**
    1. Creates a new branch called version-bump/NEW_VERSION from main (remember, the original PR is merged at this point) and runs NPM version with the original PR's version label
    2. Creates a new PR from this new branch consisting of precisely one change to package.json, a version tick
2. Any branch prefixed with version-bump/**
    1. Publishes the package to NPM. **Requires** an engineer to approve the use of production credentials.

## Testing
Most workflows have the manual_dispatch flag, which lets you trigger a manual run in the UI or, preferably, the GitHub cli.  
You can trigger workflows using the CLI by running commands in this form
```bash
gh workflow run --repo smartcontractkit/ea-framework-js --ref main main.yaml -F dry-run=true
```
