import { expect, test } from '@playwright/test'
import { pair, player } from './helpers'

test('a host alone sees free play, is shown to add players, and starts with a key', async ({
  browser,
}) => {
  const page = await player(browser)
  await page.getByRole('button', { name: 'Host a game' }).click()

  await expect(page.locator('.banner')).toContainText('Free play')
  await expect(page.locator('.sheet')).toContainText('Nobody else is here yet')
  const add = page.getByRole('button', { name: 'Add player' })
  await expect(add).toHaveClass(/primary/)
  await expect(add).toHaveClass(/attention/)
  await expect(page.getByRole('button', { name: 'Start round' })).not.toHaveClass(/primary/)
  // Nothing to report on alone.
  await expect(page.getByRole('button', { name: 'Debug report' })).toHaveCount(0)

  // Enter starts the round, as the start key: the clock replaces the banner.
  await page.keyboard.press('Enter')
  await expect(page.locator('.clock-time')).toHaveText(/^1:00|0:59$/)
  await expect(page.locator('.clock')).toBeVisible()
  await expect(page.locator('.banner')).toBeHidden()
  await expect(page.locator('.sheet')).toBeHidden()
})

test('keys are remapped in the settings and kept, and the joystick shows', async ({ browser }) => {
  const page = await player(browser)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Joystick on the screen').selectOption('left')
  await page.getByText('Keys and controller buttons').click()
  const start = page.locator('.bindings tr', { hasText: 'Start a round' })
  await start.getByRole('button').first().click()
  await expect(start.getByRole('button').first()).toHaveText('Press a key…')
  await page.keyboard.press('KeyG')
  await expect(start.getByRole('button').first()).toHaveText('G')
  // Escape cancels, and the key stays.
  await start.getByRole('button').first().click()
  await page.keyboard.press('Escape')
  await expect(start.getByRole('button').first()).toHaveText('G')
  // G moves from no other action; W moves from Up to Start.
  const up = page.locator('.bindings tr', { hasText: 'Up' })
  await start.getByRole('button').nth(1).click()
  await page.keyboard.press('KeyW')
  await expect(start.getByRole('button').nth(1)).toHaveText('W')
  await expect(up.getByRole('button').nth(1)).toHaveText('—')

  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByLabel('Joystick on the screen')).toHaveValue('left')
  await page.getByText('Keys and controller buttons').click()
  await expect(
    page.locator('.bindings tr', { hasText: 'Start a round' }).getByRole('button').first(),
  ).toHaveText('G')

  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Host a game' }).click()
  await expect(page.locator('.joystick')).toBeVisible()
  await expect(page.locator('.game')).toHaveClass(/joystick-left/)
  await page.keyboard.press('Enter')
  await expect(page.locator('.clock')).toBeHidden()
  await page.keyboard.press('KeyG')
  await expect(page.locator('.clock')).toBeVisible()
})

test('one report holds the connection, second by second, and the log', async ({ browser }) => {
  const host = await player(browser)
  const guest = await player(browser)
  await host.getByRole('button', { name: 'Host a game' }).click()
  await pair(host, guest)
  await expect(guest.locator('button.net')).toContainText(/\d+ ms/, { timeout: 10_000 })

  // The graph next to the scores and the button below the roster open the same report.
  await guest.locator('.sheet').getByRole('button', { name: 'Debug report' }).click()
  const report = guest.locator('.modal textarea.report')
  await expect(report).toHaveValue(/## Spark Hunt debug report/)
  await expect(guest.locator('.modal canvas.net-graph')).toBeVisible()
  const text = await report.inputValue()
  expect(text).toContain('### Network, last game')
  expect(text).toMatch(/- Phone: player \d/)
  expect(text).toContain('- To the host')
  expect(text).toMatch(/States received: [\d.]+ per second/)
  expect(text).toContain('t_s,peer,ping_ms')
  expect(text).toContain('### Log')
  expect(text).toMatch(/\[qr\] joined as player \d/)
  await expect(guest.getByRole('link', { name: 'Download' })).toHaveAttribute(
    'download',
    /^spark-hunt-report-.*\.md$/,
  )
  await guest.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await guest.getByRole('button', { name: 'Copy' }).click()
  expect(await guest.evaluate(() => navigator.clipboard.readText())).toBe(text)
  await guest.getByRole('button', { name: 'Cancel' }).click()

  // The host's report has a line for the player.
  await host.locator('button.net').click()
  await expect(host.locator('.modal textarea.report')).toHaveValue(/- To player \d/)
})

test('players say they are ready, or only watch, and the host sees it', async ({ browser }) => {
  const host = await player(browser)
  const guest = await player(browser)
  await host.getByLabel('Your name').fill('Hosty')
  await host.getByRole('button', { name: 'Host a game' }).click()
  await guest.getByLabel('Your name').fill('Guesty')
  await pair(host, guest)

  await expect(host.locator('.sheet')).toContainText('0 of 1 players ready.')
  await guest.getByRole('button', { name: 'Ready for the next round' }).click()
  await expect(host.locator('.sheet')).toContainText('1 of 1 players ready.')
  await expect(host.locator('.roster li', { hasText: 'Guesty' })).toContainText('✓ ready')
  await guest.getByRole('button', { name: /Ready ✓/ }).click()
  await expect(host.locator('.sheet')).toContainText('0 of 1 players ready.')

  // Watching: the dot leaves, the name stays, marked.
  await guest.getByRole('button', { name: 'Just watch' }).click()
  await expect(host.locator('.roster li.away', { hasText: 'Guesty' })).toContainText('watching')
  await expect(guest.getByRole('button', { name: 'Play along again' })).toBeVisible()
  await guest.getByRole('button', { name: 'Play along again' }).click()
  await expect(host.locator('.roster li:not(.away)', { hasText: 'Guesty' })).toBeVisible()

  // The round begins with a countdown, on both phones.
  await host.getByRole('button', { name: 'Start round' }).click()
  await expect(guest.locator('.flash')).toHaveText(/^[123]$/)
  await expect(guest.locator('.clock')).toBeVisible()
})

test('a phone keeps the whole game on the screen as a round starts', async ({ browser }) => {
  // As a phone: the browser zooms out when the page grows wider than the screen.
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 412, height: 839 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  await page.goto('./')
  await page.getByRole('button', { name: 'Host a game' }).click()
  await page.getByRole('button', { name: 'Start round' }).tap()
  // Through the countdown and "Go!", the page never grows past the screen.
  const widest = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let widest = 0
        const started = performance.now()
        const look = () => {
          widest = Math.max(widest, document.documentElement.scrollWidth, innerWidth)
          if (performance.now() - started < 4500) requestAnimationFrame(look)
          else resolve(widest)
        }
        look()
      }),
  )
  expect(widest).toBe(412)
  await expect(page.locator('.hud')).toBeInViewport()
  await expect(page.locator('.clock')).toBeVisible()
})
