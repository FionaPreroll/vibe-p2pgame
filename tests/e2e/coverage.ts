import { type BrowserContext, test as base, type Page } from '@playwright/test'
import MCR, { type CoverageReportOptions } from 'monocart-coverage-reports'

/**
 * Coverage of the browser tests, when `COVERAGE` is set (CI does): every page a test opens
 * records which code of the game runs in Chromium, from before its first navigation, and the
 * records go to coverage/e2e, mapped through the build's source maps back to the TypeScript in
 * src/ and packages/. tests/e2e/coverage-teardown.ts writes coverage/e2e/lcov.info from them.
 *
 * The specs import `test` from here instead of from Playwright, which makes this automatic.
 */

export const coverageOptions: CoverageReportOptions = {
  name: 'Spark Hunt in the browser',
  outputDir: 'coverage/e2e',
  reports: ['lcovonly', 'console-summary'],
  // The game's own bundles, as the preview server serves them; not Vite's own preload helper.
  entryFilter: (entry) =>
    /\/assets\/[^/]+\.js$/.test(entry.url) && !entry.url.includes('/preload-helper-'),
  // The game's and the libraries' own sources: not other people's code inside the bundles.
  sourceFilter: (path) =>
    /^(src|packages\/[^/]+\/src)\//.test(path) && !path.includes('node_modules'),
}

export const covering = Boolean(process.env.COVERAGE)

export const test = base.extend<{ jsCoverage: void }>({
  jsCoverage: [
    async ({ browser }, use) => {
      if (!covering) return use()
      const recording = new Set<Page>()
      const collected: unknown[] = []
      const stop = async (page: Page) => {
        if (!recording.delete(page) || page.isClosed()) return
        collected.push(...(await page.coverage.stopJSCoverage().catch(() => [])))
      }
      const watch = (context: BrowserContext) => {
        const newPage = context.newPage.bind(context)
        context.newPage = async () => {
          const page = await newPage()
          // Before the test gets the page, so the first scripts are measured too.
          await page.coverage.startJSCoverage({ resetOnNavigation: false })
          recording.add(page)
          return page
        }
        const close = context.close.bind(context)
        context.close = async (options) => {
          for (const page of context.pages()) await stop(page)
          return close(options)
        }
        return context
      }
      const newContext = browser.newContext.bind(browser)
      browser.newContext = async (options) => watch(await newContext(options))
      try {
        await use()
      } finally {
        browser.newContext = newContext
        for (const page of [...recording]) await stop(page)
        if (collected.length > 0) await MCR(coverageOptions).add(collected as never)
      }
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
