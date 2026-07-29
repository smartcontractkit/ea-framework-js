import test from 'ava'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  UNKNOWN_VERSION,
  getAdapterVersion,
  getFrameworkVersion,
  getVersions,
  resetVersionCache,
  resolvePackageVersion,
} from '../../src/util/version'

const FRAMEWORK_PACKAGE_NAME = '@chainlink/external-adapter-framework'

// Read this repo's own manifest directly, so the tests assert against the real version rather than
// a literal that would need updating on every release. Ava runs from the repo root.
const repoManifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))

/**
 * Builds a nested directory tree under a fresh temp dir, writing the provided package.json contents
 * at each level (index 0 being the outermost). Returns the deepest directory, to be used as the
 * starting point for a walk.
 */
const makeTree = (levels: (string | undefined)[]) => {
  let dir = mkdtempSync(join(tmpdir(), 'ea-version-test-'))
  for (const [index, contents] of levels.entries()) {
    dir = join(dir, `level-${index}`)
    mkdirSync(dir)
    if (contents !== undefined) {
      writeFileSync(join(dir, 'package.json'), contents)
    }
  }
  return dir
}

test.beforeEach(() => {
  resetVersionCache()
})

test.serial('Sanity check: tests run from the framework repo root', (t) => {
  t.is(repoManifest.name, FRAMEWORK_PACKAGE_NAME)
  t.is(typeof repoManifest.version, 'string')
})

test.serial('resolvePackageVersion finds the version in the starting directory', (t) => {
  const dir = makeTree([JSON.stringify({ name: 'some-adapter', version: '1.2.3' })])
  t.is(resolvePackageVersion(dir), '1.2.3')
})

test.serial('resolvePackageVersion walks up the tree to find a package.json', (t) => {
  const dir = makeTree([
    JSON.stringify({ name: 'some-adapter', version: '4.5.6' }),
    undefined,
    undefined,
  ])
  t.is(resolvePackageVersion(dir), '4.5.6')
})

test.serial('resolvePackageVersion skips manifests that do not match the expected name', (t) => {
  const dir = makeTree([
    JSON.stringify({ name: 'the-framework', version: '9.9.9' }),
    JSON.stringify({ name: 'some-adapter', version: '1.0.0' }),
  ])
  t.is(resolvePackageVersion(dir, 'the-framework'), '9.9.9')
})

test.serial('resolvePackageVersion skips malformed manifests and keeps walking', (t) => {
  const dir = makeTree([
    JSON.stringify({ name: 'some-adapter', version: '7.8.9' }),
    'not json at all',
  ])
  t.is(resolvePackageVersion(dir), '7.8.9')
})

test.serial('resolvePackageVersion skips manifests with no version and keeps walking', (t) => {
  const dir = makeTree([
    JSON.stringify({ name: 'some-adapter', version: '2.0.0' }),
    JSON.stringify({ name: 'no-version-here' }),
  ])
  t.is(resolvePackageVersion(dir), '2.0.0')
})

test.serial('resolvePackageVersion returns undefined when it reaches the filesystem root', (t) => {
  const dir = makeTree([JSON.stringify({ name: 'some-adapter', version: '1.0.0' })])
  // No manifest anywhere up the tree carries this name, so the walk runs out of parents
  t.is(resolvePackageVersion(dir, 'a-name-that-is-not-in-any-manifest'), undefined)
})

test.serial("getFrameworkVersion resolves this package's own version", (t) => {
  t.is(getFrameworkVersion(), repoManifest.version)
  // Confirm it is really this package that gets matched, rather than an unrelated ancestor manifest
  t.is(resolvePackageVersion(__dirname, FRAMEWORK_PACKAGE_NAME), repoManifest.version)
})

test.serial('getFrameworkVersion returns the memoized value on subsequent calls', (t) => {
  const first = getFrameworkVersion()
  t.is(getFrameworkVersion(), first)
})

test.serial('getAdapterVersion resolves from the working directory', (t) => {
  // Ava runs from the repo root, so the nearest manifest is this repo's
  t.is(getAdapterVersion(), repoManifest.version)
  t.is(getAdapterVersion(), repoManifest.version)
})

test.serial('getAdapterVersion falls back to npm_package_version', (t) => {
  const originalCwd = process.cwd
  const originalEnv = process.env['npm_package_version']

  try {
    // The filesystem root has no manifest, so the walk finds nothing and terminates immediately
    process.cwd = () => '/'
    process.env['npm_package_version'] = '3.2.1'
    resetVersionCache()
    t.is(getAdapterVersion(), '3.2.1')
  } finally {
    process.cwd = originalCwd
    if (originalEnv === undefined) {
      delete process.env['npm_package_version']
    } else {
      process.env['npm_package_version'] = originalEnv
    }
  }
})

test.serial('getAdapterVersion falls back to "unknown"', (t) => {
  const originalCwd = process.cwd
  const originalEnv = process.env['npm_package_version']

  try {
    process.cwd = () => '/'
    delete process.env['npm_package_version']
    resetVersionCache()
    t.is(getAdapterVersion(), UNKNOWN_VERSION)
  } finally {
    process.cwd = originalCwd
    if (originalEnv !== undefined) {
      process.env['npm_package_version'] = originalEnv
    }
  }
})

test.serial('getVersions returns both the adapter and framework versions', (t) => {
  t.deepEqual(getVersions(), {
    adapter: repoManifest.version,
    framework: repoManifest.version,
  })
})
