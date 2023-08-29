# EA Framework v3

[![NPM version](https://img.shields.io/npm/v/@chainlink/external-adapter-framework.svg?style=flat)](https://www.npmjs.com/package/@chainlink/external-adapter-framework)
![Coverage](https://img.shields.io/badge/coverage-99.18%25-green)

> **Warning**
> This framework is in a Beta state, and under active development. While many of the features from version 2 are present, they have not been tested extensively enough to mark this as production ready. You can find v2 in the [External Adapters Monorepo](https://github.com/smartcontractkit/external-adapters-js)

Framework to create External adapters, microservices that serve as middleware to facilitate connections between Chainlink Nodes and Data Providers (DP).

## Requirements

- Node.js 16+
- Yarn

### Optional development tools

If available, consider setting up your development environment with:

- ESLint
- Prettier

Note that both of the above are not necessary, but PRs submitted to the repo will be blocked from merging unless they comply with the linting and formatting rules.

## Setup

```sh
yarn # Install yarn dependencies
```

## Guides & Docs

- [Basics](./docs/basics.md)
- Components
  - [Adapter](./docs/components/adapter.md)
  - [Endpoints](./docs/components/endpoints.md)
  - [Tests](./docs/components/tests.md)
  - [Transports](./docs/components/transports.md)
  - Transport Types
    - [HTTP](./docs/components/transport-types/http-transport.md)
    - [WebSocket](./docs/components/transport-types/websocket-transport.md)
    - [SSE](./docs/components/transport-types/sse-transport.md)
    - [Custom](./docs/components/transport-types/custom-transport.md)
- Guides
  - [Porting a v2 EA to v3](./docs/guides/porting-a-v2-ea-to-v3.md)
  - [Creating a new v3 EA](./docs/guides/creating-a-new-v3-ea.md)
- Reference Tables
  - [EA Settings](./docs//reference-tables/ea-settings.md)
  - [Metrics](./docs/reference-tables/metrics.md)

## Testing

The EA framework is tested by a suite of integration tests located [here](./test).

```
yarn test
```

## Publishing releases

### Automatic

The normal flow for publishing a release is through a series o GitHub actions that are triggered when a PR is closed by merging with the base branch. Full details about our workflows can be found in [./.github/WORKFLOW-README.MD]. A summary of our publish workflow follows:

1. Close a PR containing your changes
2. If the PR was merged and if it contains a version label instruction (patch, minor, major, none), a new PR will be created that contains the result of running `npm version LABEL` on main with the original PR author assigned as a reviewer.
3. A link to the newly created version bump PR will be added to your original PR. Click on that link, and approve it to be merged.
4. Close the version bump PR. If merged, the package will be published to npm.
5. When the publish workflow finishes, a comment will be added to the version bump PR that tells you if it ran successfully

This adds an extra step (approving a version bump PR) that has to be taken every time a PR is merged. This is annoying, but it is an effective workaround for permissions issues when running against protected branches, and eliminates the need for the PR author to manually update their branch's version by referring to main.
