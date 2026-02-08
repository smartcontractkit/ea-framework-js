# Dependabot Security Alerts Status

**Repository**: `smartcontractkit/ea-framework-js`
**Branch**: `dependabot-update-2026-02-08`
**Date**: 2026-02-08

## Summary

| Metric | Count |
|--------|-------|
| Total Open Alerts | 3 |
| Fixed | 3 |
| Needs Approval | 0 |
| Blocked | 0 |

## Alert Details

| # | Dependency | Severity | CVSS | CVE | Vulnerable Range | Patched | Resolved To | Fix Method | Status |
|---|-----------|----------|------|-----|-----------------|---------|-------------|------------|--------|
| 52 | glob | high | 7.5 | CVE-2025-64756 | >= 10.2.0, < 10.5.0 | 10.5.0 | 10.5.0 | Lockfile refresh | Fixed |
| 50 | js-yaml | medium | 5.3 | CVE-2025-64718 | < 3.14.2 | 3.14.2 | 3.14.2 | Lockfile refresh | Fixed |
| 49 | js-yaml | medium | 5.3 | CVE-2025-64718 | >= 4.0.0, < 4.1.1 | 4.1.1 | 4.1.1 | Lockfile refresh | Fixed |

## Fix Log

### Tier 1: Lockfile Refresh
- Deleted `yarn.lock` and ran `yarn install` to regenerate
- All 3 alerts resolved by the lockfile refresh alone

### Dependency Chain Details

| Alert | Dependency Chain | Before | After |
|-------|-----------------|--------|-------|
| #52 | c8 -> test-exclude -> glob, ava -> @vercel/nft -> glob | 10.4.5 | 10.5.0 |
| #50 | ava -> supertap -> js-yaml | 3.14.1 | 3.14.2 |
| #49 | eslint -> @eslint/eslintrc -> js-yaml | 4.1.0 | 4.1.1 |

## Verification

- **TypeScript compilation**: Passed (exit code 0)
- **Test suite (AVA + c8)**: All tests passed (exit code 0)
- **Build (`yarn build`)**: Pre-existing failure in nested `scripts/generator-adapter` sub-project due to local Node version mismatch (local: v20.11.0 vs required: v24.13.0). This failure exists on `main` and will pass in CI which uses Node 24.13.

## Notes
- All 3 alerts are transitive, development-scope dependencies
- No direct dependency changes were required
- No code changes were required
- CI runtime (Node 24.13) is correctly pinned in `.github/actions/setup/action.yaml` and `.tool-versions`
