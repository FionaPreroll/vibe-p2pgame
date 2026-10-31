import { type Browser, expect, type Page, test } from '@playwright/test'

/**
 * Two players in two separate browser profiles, paired through the text codes, as phones would
 * through the QR codes: the real WebRTC connection, with the shortened codes in between.
 */
async function player(browser: Browser, path = './'): Promise<Page> {
  // With the camera allowed, as on a phone, Chrome puts real addresses into the codes.
  const context = await browser.newContext({ locale: 'en-US', permissions: ['camera'] })
  const page = await context.newPage()
  await page.goto(path)
  return page
}

async function ownCode(scope: Page, root = scope.locator('body')): Promise<string> {
  const field = root.locator('.own-code')
  await expect(field).toHaveValue(/^P1~/, { timeout: 10_000 })
  return field.inputValue()
}

async function pasteCode(root: ReturnType<Page['locator']>, code: string): Promise<void> {
  const details = root.locator('details.text-codes')
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator('summary').click()
  }
  await root.locator('.paste-code').fill(code)
  await root.getByRole('button', { name: 'Use code' }).click()
}

/** The color in the middle of a canvas, roughly: the second player's dot is blue. */
function centerColor(canvas: HTMLCanvasElement): string {
  const context = canvas.getContext('2d')
  const [r = 0, g = 0, b = 0] =
    context?.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data ?? []
  return b > 200 && r < 120 && g > 120 ? 'blue' : `rgb(${r}, ${g}, ${b})`
}

test('two players pair with codes and play a round', async ({ browser }) => {
  const host = await player(browser)
  const guest = await player(browser)

  await host.getByLabel('Your name').fill('Hosty')
  await host.getByRole('button', { name: 'Host a game' }).click()
  await host.getByRole('button', { name: 'Add player' }).click()
  const modal = host.locator('.modal')
  await expect(modal.locator('.qr svg')).toBeVisible({ timeout: 10_000 })
  const offer = await ownCode(host, modal)

  await guest.getByLabel('Your name').fill('Guesty')
  await guest.getByRole('button', { name: 'Join a game' }).click()
  await pasteCode(guest.locator('.join'), offer)
  await expect(guest.locator('.qr svg')).toBeVisible()
  const answer = await ownCode(guest)

  await pasteCode(modal, answer)
  await expect(host.locator('.toast')).toHaveText('Guesty joined.')
  await expect(modal).toHaveCount(0)

  // Both phones list both players, and the player's phone has measured its ping.
  for (const page of [host, guest]) {
    await expect(page.locator('.roster li')).toHaveCount(2)
    await expect(page.locator('.roster')).toContainText('Hosty')
    await expect(page.locator('.roster')).toContainText('Guesty')
  }
  await expect(host.locator('.roster li', { hasText: 'Guesty' })).toContainText(/\d+ ms/, {
    timeout: 5000,
  })

  await host.getByRole('button', { name: 'Start round' }).click()
  await expect(guest.locator('.timer')).toHaveText(/^\d+ s$/)
  await expect(guest.locator('.sheet')).toBeHidden()

  // The player steers to the middle: there, the host's screen shows the player's blue dot.
  const box = await guest.locator('canvas').boundingBox()
  if (!box) throw new Error('No canvas')
  await guest.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect
    .poll(() => host.locator('canvas').evaluate(centerColor), { timeout: 5000 })
    .toEqual('blue')

  // The host leaves: the player's phone notices and goes back to the start.
  host.on('dialog', (dialog) => dialog.accept())
  await host.getByRole('button', { name: 'Back' }).click()
  await expect(guest.getByRole('button', { name: 'Join a game' })).toBeVisible({ timeout: 15_000 })
})

test('a player who opens the join link skips the scanning', async ({ browser }) => {
  const host = await player(browser)
  await host.getByRole('button', { name: 'Host a game' }).click()
  await host.getByRole('button', { name: 'Add player' }).click()
  const modal = host.locator('.modal')
  const offer = await ownCode(host, modal)

  // As the phone's camera app opens the link from the host's QR code.
  const guest = await player(browser, `./#o=${offer}`)
  await expect(guest.locator('.qr svg')).toBeVisible()
  await expect(guest).toHaveURL(/\/$/)
  await pasteCode(modal, await ownCode(guest))
  await expect(guest.locator('.roster li')).toHaveCount(2)
})

test('a code of the wrong kind is refused', async ({ browser }) => {
  const host = await player(browser)
  await host.getByRole('button', { name: 'Host a game' }).click()
  await host.getByRole('button', { name: 'Add player' }).click()
  const modal = host.locator('.modal')
  const offer = await ownCode(host, modal)
  await pasteCode(modal, offer)
  await expect(modal.locator('.status')).toHaveText(/not a code from this game/)
})
