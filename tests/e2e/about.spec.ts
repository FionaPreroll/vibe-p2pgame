import { expect, test } from '@playwright/test'
import { player } from './helpers'

test('the About view shows the changelog and the licenses of other people’s code', async ({
  browser,
}) => {
  const page = await player(browser)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'About Spark Hunt' }).click()
  await expect(page.getByRole('heading', { name: 'About Spark Hunt' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Source code/ })).toHaveAttribute(
    'href',
    'https://github.com/FionaPreroll/vibe-p2pgame',
  )

  // The newest changes are open; nothing of the file's link definitions shows.
  const changelog = page.locator('.changelog')
  await expect(changelog.locator('details').first()).toHaveAttribute('open', '')
  await expect(changelog).toContainText('Added')
  await expect(changelog).not.toContainText(']: https://')

  // The build's list: every bundled package, with its license text.
  const licenses = page.locator('.license-list li')
  await expect(licenses.filter({ hasText: 'uqr' })).toContainText('MIT')
  await expect(licenses.filter({ hasText: 'jsqr' })).toContainText('Apache-2.0')
  await licenses.filter({ hasText: 'uqr' }).locator('summary').click()
  await expect(licenses.filter({ hasText: 'uqr' }).locator('pre')).toContainText(
    'Permission is hereby granted',
  )

  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
})
