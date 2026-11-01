import { defineConfig } from '@playwright/test'
import base from './playwright.config.ts'

/**
 * The README's screenshots (tests/screenshots), apart from the end-to-end tests: one long game,
 * one browser after the other, written to docs/screenshots. Run with `pnpm screenshots`, or in
 * the Actions tab with "Update screenshots", which opens a pull request with them.
 */
export default defineConfig({
  ...base,
  testDir: 'tests/screenshots',
  workers: 1,
  timeout: 240_000,
  reporter: 'list',
})
