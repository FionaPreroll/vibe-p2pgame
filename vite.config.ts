import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vitest/config'
import { licenses } from './tools/licenses.ts'
import { serviceWorker } from './tools/serviceWorker.ts'

/**
 * Which build this is, for About and the debug report: the game's version from package.json, the
 * commit, from CI or from git, and the time.
 */
function buildInfo(): { version: string; commit: string; time: string } {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  let commit = process.env.GITHUB_SHA?.slice(0, 7)
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
    } catch {
      commit = 'unknown'
    }
  }
  return { version, commit, time: new Date().toISOString() }
}

export default defineConfig(({ mode }) => ({
  define: { __BUILD__: JSON.stringify(buildInfo()) },
  // Relative asset URLs, so the build runs under any path, such as GitHub Pages' /vibe-p2pgame/.
  base: './',
  // Source maps only for measuring coverage in the browser tests (COVERAGE, see tests/e2e/coverage.ts).
  build: { sourcemap: Boolean(process.env.COVERAGE) },
  // Phones only open the camera on HTTPS pages, so `pnpm dev:phone` serves with a self-signed
  // certificate that the phone has to accept once.
  plugins: [licenses(), serviceWorker(), ...(mode === 'phone' ? [basicSsl()] : [])],
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Every source file, so files without tests count as uncovered instead of missing.
      include: ['src/**/*.ts', 'packages/*/src/**/*.ts', 'tools/**/*.ts'],
      // The core library's index files only re-export; @fionapreroll/p2p-nearby's holds its code.
      exclude: ['**/*.test.ts', '**/testing.ts', 'packages/p2p/src/**/index.ts'],
      // lcov for Codecov, a table for the terminal.
      reporter: ['text', 'lcov'],
    },
  },
}))
