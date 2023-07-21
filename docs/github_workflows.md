# Github workflows and actions for EAv3 Framework


## Actions
### [setup](../.github/actions/setup/action.yaml)
The setup action is used to set up the environment and install dependencies.

### [validate-version-labels](../.github/actions/validate-version-labels/action.yaml)
The validate-version-labels action checks whether a pull request has a valid version bump label (major, minor, patch, or none).

### [set-git-credentials](../.github/actions/set-git-credentials/action.yaml)
The set-git-credentials is used to set a common git configuration for the rare instances where we need to run raw git commands, such as when pushing tags after `npm --version`

## Workflows


### [main](../.github/workflows/main.yaml)

The main workflow is used to ensure that the application is built, tested, and linted properly before potential publishing.

The workflow is triggered by the following events: None of the jobs will run if the branch starts with `version-bump`

- workflow_dispatch: Manually triggered when needed.
- pull_request: Triggered when a new pull request is opened or updated.
- push to the main branch: Triggered when code is pushed to the main branch.

#### Jobs

#### 1. Build

This job runs the application's build process.

#### 2. Lint

This job checks the codebase for linting issues and code formatting.


#### 3. Test

This job runs the test suite for the application.

#### 4. Code Coverage

This job handles code coverage reports. Triggered after the `test` job has run successfully



### [pinned-dependencies](../.github/workflows/pinned-dependencies.yaml)

The pinned-dependencies workflow is used to ensure that all dependencies in the package.json file have pinned versions. 
This helps maintain consistency and avoid unexpected changes when new package versions are released.

The workflow is triggered on every push to the repository.

#### Job: 1. Check Dependencies

This job is responsible for checking whether the dependencies in the package.json file have pinned versions or not.


### [add-or-validate-labels](../.github/workflows/add-or-validate-labels.yaml)
The add-or-validate-labels workflow is used to validate version bump labels (major, minor, patch or none) on a pull request. 
Labels are used to create or update version-bump pull requests once the labeled pull request is merged.

The workflow is triggered by the following events:

- workflow_dispatch: Manually triggered to see what labels would be added without actually applying them to the pull request.
- pull_request: Triggered when a new pull request is opened or when labels are added or removed from the pull request.

#### Jobs

#### 1. Validate PR Labels

This job is responsible for validating that version bump labels are on the pull request.

#### 2. Upsert PR Comment

This job creates or updates a comment on the pull request with the detected version instruction.

### [open-version-bump-pr.yaml](../.github/workflows/open-version-bump-pr.yaml)
The open-version-bump-pr workflow is used to automatically open a version bump pull request when certain conditions are met.

The workflow is triggered by the following events:

- workflow_dispatch: Allows manual triggering and provides inputs for the version-type and dry-run parameters.
- pull_request: Triggered when a pull request is closed, specifically merged.

#### Jobs and Steps

#### 1. Preflight

This job checks whether version bump labels are present on the pull request and extracts the version bump label.


#### 2. Create Version Bump PR

This job is responsible for creating a new pull request with a version bump commit.

##### Steps for Create Version Bump PR:


1. Tick Version: This step is the core of the job. It determines the version bump instruction based on the labels present on the pull request. If the version bump instruction is "none," no version bump is required, and the job exits successfully with a 0 status code. If a valid version bump instruction is provided, it uses the `npm version` command to update the package version according to the instruction.

2. Create Commit: If a valid version bump is detected in the previous step, and that detected version is higher than the current version, this step creates a new commit with the updated package.json file, reflecting the version bump. The new commit is made on a new branch named `version-bump`. If the branch already exists, it updates the reference to the branch's head commit.

3. Update Code Coverage Badge: This step retrieves code coverage information from `coverage-pr-{pr_number}` branch, checks the current and new code coverage results and updates the badge in the README.md file if needed (in the same `version-bump` branch).

4. Create PR: If a new commit with a version bump was created in the previous steps, this step checks if there is already an open pull request associated with the `version-bump` branch. If there is no pull request, it creates a new one with a title and description indicating the version bump. If there is an existing pull request, it updates the title and description if a new version bump is detected.


### [publish](../.github/workflows/publish.yaml)
The publish workflow is used to publish an NPM package when changes (version-bump pull requests) are pushed to the main branch and the package.json file is updated.
The workflow ensures that the current package version is different from the previously published version before initiating the publishing process.

#### Trigger Events

The workflow is triggered by the following events:

- workflow_dispatch: Manually triggered, allows passing the --dry-run flag to npm publish, useful for testing.
- push to the main branch: Triggered when code is pushed to the main branch and the package.json file is updated.


#### Job: 1. Publish

This job handles the NPM package publishing process.

## Testing
Most workflows have the manual_dispatch flag, which lets you trigger a manual run in the UI or, preferably, the GitHub cli.  
You can trigger workflows using the CLI by running commands in this form
```bash
gh workflow run --repo smartcontractkit/ea-framework-js --ref main main.yaml -F dry-run=true
```
