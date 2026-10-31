import { type Browser, expect, type Locator, type Page } from '@playwright/test'

/**
 * Two players in two separate browser profiles, paired through the text codes, as phones would
 * through the QR codes: the real WebRTC connection, with the shortened codes in between.
 */
export async function player(browser: Browser, path = './'): Promise<Page> {
  // With the camera allowed, as on a phone, Chrome puts real addresses into the codes.
  const context = await browser.newContext({ locale: 'en-US', permissions: ['camera'] })
  const page = await context.newPage()
  await page.goto(path)
  return page
}

export async function ownCode(scope: Page, root = scope.locator('body')): Promise<string> {
  const field = root.locator('.own-code')
  await expect(field).toHaveValue(/^P1~/, { timeout: 10_000 })
  return field.inputValue()
}

export async function pasteCode(root: Locator, code: string): Promise<void> {
  const details = root.locator('details.text-codes')
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator('summary').click()
  }
  await root.locator('.paste-code').fill(code)
  await root.getByRole('button', { name: 'Use code' }).click()
}

/** Pairs a player with a host whose game is open, through the text codes. */
export async function pair(host: Page, guest: Page, joinButton = 'Join a game'): Promise<void> {
  await host.getByRole('button', { name: 'Add player' }).click()
  const modal = host.locator('.modal')
  const offer = await ownCode(host, modal)
  await guest.getByRole('button', { name: joinButton }).click()
  await pasteCode(guest.locator('.join'), offer)
  await pasteCode(modal, await ownCode(guest))
  await expect(modal).toHaveCount(0)
}
