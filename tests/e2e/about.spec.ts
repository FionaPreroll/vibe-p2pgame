import { expect, test } from './coverage'
import { player } from './helpers'

test('the About view shows the changelog and the licenses of other people’s code', async ({
  browser,
}) => {
  const page = await player(browser)
  // A screen scrolled down before does not leave About scrolled down.
  await page.setViewportSize({ width: 390, height: 600 })
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.mouse.wheel(0, 5000)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'About Spark Hunt' }).click()
  await expect(page.getByRole('heading', { name: 'About Spark Hunt' })).toBeVisible()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await expect(page.locator('.about')).toContainText(
    /Version \d+\.\d+\.\d+, web build \w+, from \d{4}-\d\d-\d\d\./,
  )
  await expect(page.getByRole('link', { name: /Source code/ })).toHaveAttribute(
    'href',
    'https://github.com/FionaPreroll/vibe-p2pgame',
  )
  await expect(page.getByRole('link', { name: 'fipreroll+app@gmail.com' })).toHaveAttribute(
    'href',
    'mailto:fipreroll+app@gmail.com',
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
  await expect(page.getByRole('button', { name: 'Host a game' })).toBeVisible()
})

test('the start screen speaks of the website on the website', async ({ browser }) => {
  const page = await player(browser)
  const home = page.locator('.home')
  await expect(home).toContainText('without internet or a server')
  await expect(home).not.toContainText('no app')
  await expect(home).toContainText('All phones must be on the same Wi-Fi')
  await expect(home).toContainText('Open this page once while online')
  // The app is offered on Android phones only, where it runs.
  await expect(home.getByRole('link', { name: 'download it from GitHub' })).toHaveCount(0)
  const context = await browser.newContext({
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile',
  })
  const android = await context.newPage()
  await android.goto('./')
  await expect(android.getByRole('link', { name: 'download it from GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/FionaPreroll/vibe-p2pgame/releases/tag/android-latest',
  )
})

test('the privacy policy opens from About and from the settings, in the player’s language', async ({
  browser,
}) => {
  const page = await player(browser)
  await page.getByRole('button', { name: 'About Spark Hunt' }).click()
  await page.getByRole('button', { name: 'Privacy policy' }).click()
  await expect(page.getByRole('heading', { name: 'Privacy policy' })).toBeVisible()
  await expect(page.locator('.privacy')).toContainText('no tracking')
  await expect(page.getByRole('heading', { name: 'What stays on your phone' })).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('heading', { name: 'About Spark Hunt' })).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Language').selectOption('de')
  await page.getByRole('button', { name: 'Datenschutzerklärung' }).click()
  await expect(page.getByRole('heading', { name: 'Was auf deinem Handy bleibt' })).toBeVisible()
  await page.getByRole('button', { name: 'Zurück' }).click()
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible()
})
