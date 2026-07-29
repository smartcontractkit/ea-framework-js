import { readFileSync } from 'fs'
import { dirname, join } from 'path'

// NOTE: this module must not import anything else from this project.
// It's imported by the logger, which in turn is imported almost everywhere, so any
// project-local import here risks introducing a cycle.

/** Name of this package, used to identify the framework's own package.json */
const FRAMEWORK_PACKAGE_NAME = '@chainlink/external-adapter-framework'

/** Value reported when a version could not be determined */
export const UNKNOWN_VERSION = 'unknown'

/**
 * Versions of the code that produced a response, message or metric.
 */
export interface AdapterVersions {
  /** Version of the external adapter, read from its package.json */
  adapter: string

  /** Version of the EA framework the adapter is built against */
  framework: string
}

/**
 * Walks up the directory tree from the provided starting point, looking for a package.json to read
 * the version from. Unreadable or malformed manifests are skipped, as are ones that don't match
 * `expectedName` when it is provided.
 *
 * @param startDir - the directory to start searching from
 * @param expectedName - if provided, only consider a package.json whose "name" matches this
 * @returns the version found, or undefined if the filesystem root is reached without a match
 */
export const resolvePackageVersion = (
  startDir: string,
  expectedName?: string,
): string | undefined => {
  let dir = startDir
  // The dirname of the filesystem root is the root itself, which is how the walk terminates
  for (let previous = ''; dir !== previous; dir = dirname(dir)) {
    previous = dir
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
      const matchesName = !expectedName || manifest?.['name'] === expectedName
      if (matchesName && typeof manifest?.['version'] === 'string') {
        return manifest['version']
      }
    } catch {
      // No readable package.json in this directory, keep walking up
    }
  }

  return undefined
}

let frameworkVersion: string | undefined
let adapterVersion: string | undefined

/**
 * Version of the EA framework, read from this package's own package.json.
 * The result is memoized after the first call.
 *
 * @returns the framework version, or "unknown" if it could not be determined
 */
export const getFrameworkVersion = (): string => {
  frameworkVersion ??= resolvePackageVersion(__dirname, FRAMEWORK_PACKAGE_NAME) ?? UNKNOWN_VERSION
  return frameworkVersion
}

/**
 * Version of the external adapter, read from the nearest package.json at or above the current
 * working directory. Falls back to the npm_package_version environment variable, which is only set
 * when the process was started through an npm/yarn script. The result is memoized after the first
 * call.
 *
 * @returns the adapter version, or "unknown" if it could not be determined
 */
export const getAdapterVersion = (): string => {
  adapterVersion ??=
    resolvePackageVersion(process.cwd()) ?? process.env['npm_package_version'] ?? UNKNOWN_VERSION
  return adapterVersion
}

/**
 * Both the adapter and framework versions, for inclusion in responses, messages and metrics.
 *
 * @returns the adapter and framework versions
 */
export const getVersions = (): AdapterVersions => ({
  adapter: getAdapterVersion(),
  framework: getFrameworkVersion(),
})

/**
 * Clears the memoized versions. Only intended for use in tests.
 */
export const resetVersionCache = (): void => {
  frameworkVersion = undefined
  adapterVersion = undefined
}
