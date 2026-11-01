import { expect, test } from '@playwright/test'
import { pair, player } from './helpers'

test('a player who drops out rejoins with their place', async ({ browser }) => {
  const host = await player(browser)
  await host.getByLabel('Your name').fill('Hosty')
  await host.getByRole('button', { name: 'Host a game' }).click()
  const guest = await player(browser)
  await guest.getByLabel('Your name').fill('Guesty')
  await pair(host, guest)
  const guestRow = host.locator('.roster li', { hasText: 'Guesty' })
  // The first player to join gets the second color, blue.
  const blue = 'rgb(77, 163, 255)'
  await expect(guestRow.locator('.dot')).toHaveCSS('background-color', blue)

  // The player's page closes, as when the browser is swiped away.
  const context = guest.context()
  await guest.close()
  await expect(host.locator('.toast', { hasText: 'Guesty left.' })).toBeVisible({ timeout: 15_000 })
  await expect(guestRow).toHaveClass('away')
  await expect(guestRow).toContainText('away')

  // Back in the same browser: the start offers to rejoin.
  const again = await context.newPage()
  await again.goto('./')
  await expect(again.getByLabel('Your name')).toHaveValue('Guesty')
  await expect(again.getByRole('button', { name: 'Rejoin Hosty’s game' })).toBeVisible()
  await pair(host, again, 'Rejoin Hosty’s game')
  await expect(host.locator('.toast', { hasText: 'Guesty is back.' })).toBeVisible()
  await expect(again.locator('.toast')).toHaveText(/Welcome back/)

  // The same place, so the same color, and nobody is away any more.
  await expect(host.locator('.roster li.away')).toHaveCount(0)
  await expect(host.locator('.roster li')).toHaveCount(2)
  await expect(guestRow.locator('.dot')).toHaveCSS('background-color', blue)
})

test('a host whose page reloads carries on, and the player can rejoin', async ({ browser }) => {
  // The player's phone notices the silent host only after 8 seconds: more time than most.
  test.setTimeout(60_000)
  const host = await player(browser)
  await host.getByLabel('Your name').fill('Hosty')
  await host.getByRole('button', { name: 'Host a game' }).click()
  const guest = await player(browser)
  await guest.getByLabel('Your name').fill('Guesty')
  await pair(host, guest)

  await host.reload()
  await host.getByRole('button', { name: 'Continue your game with Guesty' }).click()
  await expect(host.locator('.roster li.away')).toContainText('Guesty')

  // The player's phone notices that the host is gone and offers to rejoin at once.
  await expect(guest.getByText('The connection to the host was lost.')).toBeVisible({
    timeout: 20_000,
  })
  await pair(host, guest, 'Rejoin')
  await expect(host.locator('.toast', { hasText: 'Guesty is back.' })).toBeVisible()
  await expect(host.locator('.roster li.away')).toHaveCount(0)
})

test('settings are kept in the browser', async ({ browser }) => {
  const page = await player(browser)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Your name').fill('Ada')
  await page.getByLabel('Your name').press('Tab')
  await page.getByLabel('Round length when hosting').selectOption('30')
  await page.getByLabel('Vibrate when catching a spark').uncheck()
  await page.getByLabel('Language').selectOption('de')
  // The screen changes language at once.
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Funkenjagd' })).toBeVisible()
  await expect(page.getByLabel('Dein Name')).toHaveValue('Ada')
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await expect(page.getByLabel('Vibrieren beim Fangen eines Funkens')).not.toBeChecked()
  await expect(page.getByLabel('Rundenlänge als Host')).toHaveValue('30')

  // The round length counts when this phone hosts.
  await page.getByRole('button', { name: 'Zurück' }).click()
  await page.getByRole('button', { name: 'Spiel eröffnen' }).click()
  await page.getByRole('button', { name: 'Runde starten' }).click()
  await expect(page.locator('.clock-time')).toHaveText(/^0:(30|29)$/)

  // Deleting all data starts over, in the browser's language.
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Zurück' }).click()
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.getByRole('button', { name: 'Alle gespeicherten Daten löschen' }).click()
  await expect(page.getByRole('heading', { name: 'Spark Hunt' })).toBeVisible()
  await expect(page.getByLabel('Your name')).toHaveValue(/^Player \d+$/)
  await expect(page.getByRole('button', { name: /Continue/ })).toHaveCount(0)
})
