import { expect, test } from './coverage'
import { player } from './helpers'

test('the settings make a debug report to read, copy and send', async ({ browser }) => {
  const page = await player(browser)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Create debug report' }).click()
  const report = page.locator('textarea.report')
  await expect(report).toHaveValue(/## Spark Hunt debug report/)
  const text = await report.inputValue()
  expect(text).toContain('- Running as: website in a browser')
  expect(text).toMatch(/WebRTC yes, camera yes/)
  expect(text).toContain('[app] start: browser')
  await expect(page.getByRole('link', { name: 'Report on GitHub' })).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/FionaPreroll\/vibe-p2pgame\/issues\/new\?title=Debug%20report&body=/,
  )
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Copy' }).click()
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
})
