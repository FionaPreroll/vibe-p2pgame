import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { ownCode, pasteCode } from '../e2e/helpers'

/**
 * Plays one game with three players and photographs what the README shows. The host is a
 * phone, held upright; the two players join through the text codes, as in the end-to-end
 * tests. Random numbers come from a fixed seed in every browser, so the sparks, mines and
 * default names are the same from run to run, and the pictures change only with the game.
 */

const OUT = 'docs/screenshots'
const PHONE = { width: 390, height: 800 }

/** Math.random from a seed, before the game's own scripts run (Mulberry32). */
function seeded(seed: number): string {
  return `{
    let s = ${seed} | 0
    Math.random = () => {
      s = (s + 0x6d2b79f5) | 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }`
}

async function phone(
  browser: Browser,
  seed: number,
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({
    locale: 'en-US',
    permissions: ['camera'],
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    // An Android phone's browser, as most players have.
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  })
  await context.addInitScript(seeded(seed))
  const page = await context.newPage()
  await page.goto('./')
  return { page, context }
}

async function shot(page: Page, name: string, until?: string): Promise<void> {
  // A moment for animations and the connection graph to settle.
  await page.waitForTimeout(400)
  // `until`: the picture ends below this element, as where a test camera's picture would follow.
  const end = until ? await page.locator(until).boundingBox() : null
  await page.screenshot({
    path: `${OUT}/${name}.png`,
    clip: end
      ? { x: 0, y: 0, width: PHONE.width, height: Math.ceil(end.y + end.height + 6) }
      : undefined,
  })
}

/** Steers to a few spots on the arena, as a player chasing sparks. */
async function wander(page: Page, steps: number, pause = 700): Promise<void> {
  const box = await page.locator('canvas.arena').boundingBox()
  if (!box) throw new Error('No arena')
  for (let i = 0; i < steps; i++) {
    const x = box.x + box.width * (0.15 + 0.7 * Math.random())
    const y = box.y + box.height * (0.15 + 0.7 * Math.random())
    await page.mouse.click(x, y)
    await page.waitForTimeout(pause)
  }
}

test('screenshots for the README', async ({ browser }) => {
  const host = (await phone(browser, 1)).page
  const players: Page[] = []

  // The start screen, with a name.
  await host.getByLabel('Your name').fill('Ada')
  await shot(host, 'home')

  // Settings: a round of 30 seconds keeps this short; the screenshot shows the controls.
  await host.getByRole('button', { name: 'Settings' }).click()
  await host.getByLabel('Round length when hosting').selectOption('30')
  await host.getByText('Keys and controller buttons').click()
  await host.getByRole('heading', { name: 'Controls' }).scrollIntoViewIfNeeded()
  await host.evaluate(() =>
    document.querySelector('.settings h3:nth-of-type(2)')?.scrollIntoView({ block: 'start' }),
  )
  await shot(host, 'settings')
  await host.getByRole('button', { name: 'Back' }).click()

  // Hosting: the arena at once, in free play.
  await host.getByRole('button', { name: 'Host a game' }).click()
  for (const [index, name] of ['Bo', 'Cyra'].entries()) {
    const { page } = await phone(browser, 10 + index)
    await page.getByLabel('Your name').fill(name)
    await host.getByRole('button', { name: 'Add player' }).click()
    const modal = host.locator('.modal')
    await expect(modal.locator('.qr svg')).toBeVisible({ timeout: 10_000 })
    // The QR code and the steps; the test browser's camera shows only a test pattern.
    if (index === 0) await shot(host, 'pairing', '.modal .card > p:nth-of-type(2)')
    const offer = await ownCode(host, modal)
    await page.getByRole('button', { name: 'Join a game' }).click()
    await pasteCode(page.locator('.join'), offer)
    await pasteCode(modal, await ownCode(page))
    await expect(modal).toHaveCount(0)
    players.push(page)
  }

  // Free play, everyone warming up; the connection graph has a few seconds of pings.
  await Promise.all([...players, host].map((page) => wander(page, 6)))
  await players[0]?.getByRole('button', { name: 'Ready for the next round' }).click()
  await expect(host.locator('.sheet')).toContainText('1 of 2 players ready.')
  await shot(host, 'lobby')

  // A round: the clock, sparks, mines and points rising.
  await host.getByRole('button', { name: 'Start round' }).tap()
  await expect(host.locator('.clock')).toBeVisible({ timeout: 10_000 })
  await Promise.all([...players, host].map((page) => wander(page, 12, 800)))
  await shot(host, 'round')

  // The end: who caught what.
  await expect(host.locator('.banner')).toContainText('Round over', { timeout: 40_000 })
  await shot(host, 'results')

  // The connection details, after a connection test.
  await host.locator('button.net').tap()
  await host.getByRole('button', { name: 'Test connections' }).tap()
  await expect(host.locator('.modal .connection-test')).toContainText('From the host', {
    timeout: 15_000,
  })
  await host.locator('.modal').evaluate((modal) => modal.scrollTo(0, 0))
  await shot(host, 'connection')
  await host.locator('.modal').getByRole('button', { name: 'Close' }).click()

  // A player's view, in German.
  const german = (await phone(browser, 30)).page
  await german.evaluate(() =>
    localStorage.setItem('vibe-p2pgame:settings', JSON.stringify({ name: 'Dora', language: 'de' })),
  )
  await german.reload()
  await shot(german, 'home-de')
})
