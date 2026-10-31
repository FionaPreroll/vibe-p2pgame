import { expect, test } from '@playwright/test'
import { ownCode, pair, pasteCode, player } from './helpers'

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
    .poll(() => host.locator('canvas').evaluate(centerColor), { timeout: 10_000 })
    .toEqual('blue')

  // The host leaves: the player's phone notices and goes back to the start.
  host.on('dialog', (dialog) => dialog.accept())
  await host.getByRole('button', { name: 'Back' }).click()
  await expect(guest.locator('.toast')).toHaveText('Hosty ended the game.')
  await expect(guest.getByRole('button', { name: 'Join a game' })).toBeVisible()
  // The host ended the game on purpose: nothing to rejoin or carry on.
  await expect(guest.getByRole('button', { name: /Rejoin/ })).toHaveCount(0)
  await host.reload()
  await expect(host.getByRole('button', { name: /Continue/ })).toHaveCount(0)
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
  await expect(modal.locator('.card > .status')).toHaveText(/not a code from this game/)
})

test('players pair with photos of the codes, for cameras that will not focus live', async ({
  browser,
}) => {
  const host = await player(browser)
  const guest = await player(browser)
  await host.getByRole('button', { name: 'Host a game' }).click()
  await host.getByRole('button', { name: 'Add player' }).click()
  const modal = host.locator('.modal')
  await expect(modal.locator('.qr svg')).toBeVisible({ timeout: 10_000 })
  const offerPhoto = await modal.locator('.qr').screenshot()

  await guest.getByRole('button', { name: 'Join a game' }).click()
  await expect(guest.getByRole('button', { name: 'Take a photo instead' })).toBeVisible()
  // A photo with nothing on it: the player is told, and can go on.
  await guest.locator('input.photo').setInputFiles({
    name: 'blank.png',
    mimeType: 'image/png',
    buffer: await guest.screenshot({ clip: { x: 0, y: 0, width: 50, height: 50 } }),
  })
  await expect(guest.locator('.scan .status')).toHaveText(/No code found/)
  await guest
    .locator('input.photo')
    .setInputFiles({ name: 'offer.png', mimeType: 'image/png', buffer: offerPhoto })
  await expect(guest.locator('.qr svg')).toBeVisible()

  await modal.locator('input.photo').setInputFiles({
    name: 'answer.png',
    mimeType: 'image/png',
    buffer: await guest.locator('.qr').screenshot(),
  })
  await expect(host.locator('.toast')).toHaveText(/joined/)
  await expect(guest.locator('.roster li')).toHaveCount(2)
})

test('the live camera can be focused by tapping the picture', async ({ browser }) => {
  const guest = await player(browser)
  await guest.getByRole('button', { name: 'Join a game' }).click()
  const viewfinder = guest.locator('.viewfinder')
  await expect(viewfinder).toBeVisible()
  await expect
    .poll(() => guest.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBeGreaterThan(0)
  await viewfinder.click({ position: { x: 40, y: 40 } })
  await expect(guest.locator('.focus-ring')).toHaveClass(/pulse/)
})

test('a touch the moment a round starts goes where it was aimed', async ({ browser }) => {
  const host = await player(browser)
  await host.getByRole('button', { name: 'Host a game' }).click()
  const guest = await player(browser)
  await pair(host, guest)

  // The sheet below the arena hides as the round starts, and the arena grows. Touch its
  // middle in that very moment, before the next frame is drawn.
  await guest.evaluate(() => {
    const sheet = document.querySelector('.sheet') as HTMLElement
    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    new MutationObserver((_, observer) => {
      if (!sheet.hidden) return
      observer.disconnect()
      const box = canvas.getBoundingClientRect()
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 1,
          clientX: box.left + box.width / 2,
          clientY: box.top + box.height / 2,
        }),
      )
    }).observe(sheet, { attributes: true })
  })
  await host.getByRole('button', { name: 'Start round' }).click()
  await expect
    .poll(() => host.locator('canvas').evaluate(centerColor), { timeout: 10_000 })
    .toEqual('blue')
})
