import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

/** The list the About view shows, as `licenses.json` beside the game. */
export const LICENSES_FILE = 'licenses.json'

/** A package of other people's code in the build, with what its license asks to pass on. */
export interface License {
  readonly name: string
  readonly version: string
  /** The SPDX expression from its package.json, such as `MIT`. */
  readonly license: string
  readonly homepage: string | null
  /** The license file, and a NOTICE file where there is one, as Apache-2.0 asks. */
  readonly text: string
}

/**
 * Adds `licenses.json` to production builds: every package of other people's code that ended up
 * in the bundle, found from the bundle's own modules, so the list is never longer or shorter
 * than what ships.
 */
export function licenses(): Plugin {
  return {
    name: 'vibe-p2pgame-licenses',
    apply: 'build',
    generateBundle(_, bundle) {
      const ids: string[] = []
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') ids.push(...Object.keys(output.modules))
      }
      this.emitFile({
        type: 'asset',
        fileName: LICENSES_FILE,
        source: JSON.stringify(collectLicenses(ids)),
      })
    },
  }
}

/** The packages that modules with these ids come from, by name, each once. */
export function collectLicenses(moduleIds: readonly string[]): License[] {
  const folders = new Map<string, string>()
  for (const id of moduleIds) {
    const folder = packageFolder(id)
    if (folder) folders.set(folder, folder)
  }
  const found = new Map<string, License>()
  for (const folder of folders.values()) {
    const license = readLicense(folder)
    if (license) found.set(`${license.name}@${license.version}`, license)
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The folder of the package a module is in, from its path below the last `node_modules`, as
 * pnpm's `node_modules/.pnpm/x@1/node_modules/x/dist/index.js`; null for the game's own code
 * and for Vite's virtual modules.
 */
export function packageFolder(id: string): string | null {
  const path = id.replace(/\\/g, '/').replace(/\?.*$/, '')
  if (path.startsWith('\0')) return null
  const at = path.lastIndexOf('/node_modules/')
  if (at < 0) return null
  const rest = path.slice(at + '/node_modules/'.length).split('/')
  const name = rest[0]?.startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1)
  if (name.length === 0 || name.some((part) => part === '' || part === '.pnpm')) return null
  return `${path.slice(0, at)}/node_modules/${name.join('/')}`
}

function readLicense(folder: string): License | null {
  const manifest = join(folder, 'package.json')
  if (!existsSync(manifest)) return null
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
  if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') return null
  const files = readdirSync(folder)
  const read = (pattern: RegExp) =>
    files
      .filter((file) => pattern.test(file))
      .map((file) => readFileSync(join(folder, file), 'utf8').trim())
  const text = [...read(/^(licen[cs]e|copying)(\.(md|txt))?$/i), ...read(/^notice(\.(md|txt))?$/i)]
  return {
    name: pkg.name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : 'see its files',
    homepage: homepage(pkg),
    text: text.join('\n\n') || `${pkg.name} names its license as ${String(pkg.license)}.`,
  }
}

function homepage(pkg: Record<string, unknown>): string | null {
  const repository = pkg.repository
  const url =
    typeof pkg.homepage === 'string'
      ? pkg.homepage
      : typeof repository === 'string'
        ? repository
        : typeof repository === 'object' && repository !== null && 'url' in repository
          ? String(repository.url)
          : null
  if (url === null) return null
  const https = url
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
  return https.startsWith('https://') ? https : null
}
