import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The game always uses the newest version of its libraries: whenever a library gets a new
 * version (see "Library versions" in the README), the game's dependency moves to it in the same
 * commit. The game still builds from the libraries' sources in the workspace, and pnpm refuses
 * to install if those no longer match the version the game names.
 */

function packageJson(path: string): {
  version?: string
  dependencies?: Record<string, string>
} {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
}

describe('the game’s libraries', () => {
  const game = packageJson('package.json')

  for (const [name, dir] of [
    ['@fionapreroll/p2p', 'packages/p2p'],
    ['@fionapreroll/p2p-nearby', 'packages/p2p-nearby'],
  ] as const) {
    it(`uses ${name} in its newest version`, () => {
      const { version } = packageJson(`${dir}/package.json`)
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(game.dependencies?.[name]).toBe(`workspace:^${version}`)
    })
  }
})
