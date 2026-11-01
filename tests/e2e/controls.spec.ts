import type { Page } from '@playwright/test'
import { expect, test } from './coverage'

/**
 * Controllers and the keys' editor. Chrome without a controller has none to press, so the page
 * gets a stand-in, as the Gamepad API describes it: `press(page, 9)` holds its Start button.
 */
async function withController(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pad = {
      id: 'Test controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    }
    ;(window as unknown as { testPad: typeof pad }).testPad = pad
    navigator.getGamepads = () => [pad as unknown as Gamepad]
  })
}

async function press(page: Page, button: number, down = true): Promise<void> {
  await page.evaluate(
    ([index, pressed]) => {
      const pad = (window as unknown as { testPad: { buttons: { pressed: boolean }[] } }).testPad
      const target = pad.buttons[index as number]
      if (target) target.pressed = pressed as boolean
    },
    [button, down],
  )
}

async function openBindings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByText('Keys and controller buttons').click()
}

const row = (page: Page, action: string) => page.locator('.bindings tr', { hasText: action })
const controllerField = (page: Page, action: string) => row(page, action).getByRole('button').nth(2)

test('a controller button is bound by pressing it, and taken from where it was', async ({
  page,
}) => {
  await withController(page)
  await page.goto('./')
  await openBindings(page)
  await expect(controllerField(page, 'Start a round')).toHaveText('Start')

  // A button held already when the field opens does not count: only a new press.
  await press(page, 0)
  await controllerField(page, 'Start a round').click()
  await expect(controllerField(page, 'Start a round')).toHaveText('Press a button…')
  await page.waitForTimeout(200)
  await expect(controllerField(page, 'Start a round')).toHaveText('Press a button…')
  await press(page, 0, false)
  // D-pad up moves here from Up.
  await press(page, 12)
  await expect(controllerField(page, 'Start a round')).toHaveText('D-pad ↑')
  await expect(controllerField(page, 'Up')).toHaveText('—')
  await press(page, 12, false)

  // Escape cancels; Delete empties the field.
  await controllerField(page, 'Start a round').click()
  await page.keyboard.press('Escape')
  await expect(controllerField(page, 'Start a round')).toHaveText('D-pad ↑')
  await controllerField(page, 'Down').click()
  await page.keyboard.press('Delete')
  await expect(controllerField(page, 'Down')).toHaveText('—')

  // In a game, the new button starts the round.
  await page.reload()
  await page.getByRole('button', { name: 'Host a game' }).click()
  await expect(page.locator('.clock')).toBeHidden()
  await press(page, 12)
  await expect(page.locator('.clock')).toBeVisible()
})

test('keys are emptied with Delete, and everything comes back with reset', async ({ page }) => {
  await page.goto('./')
  await openBindings(page)
  const up = row(page, 'Up')
  await up.getByRole('button').first().click()
  await page.keyboard.press('Delete')
  await expect(up.getByRole('button').first()).toHaveText('W')
  await up.getByRole('button').first().click()
  await page.keyboard.press('Backspace')
  await expect(up.getByRole('button').first()).toHaveText('—')

  // Opening another field stops listening on the first.
  await up.getByRole('button').first().click()
  await row(page, 'Down').getByRole('button').first().click()
  await page.keyboard.press('KeyQ')
  await expect(row(page, 'Down').getByRole('button').first()).toHaveText('Q')
  await expect(up.getByRole('button').first()).toHaveText('—')

  await page.getByRole('button', { name: 'Reset keys and buttons' }).click()
  await expect(page.locator('.toast')).toHaveText('Keys and buttons reset.')
  await expect(up.getByRole('button').first()).toHaveText('↑')
  await expect(up.getByRole('button').nth(1)).toHaveText('W')
  await expect(row(page, 'Down').getByRole('button').first()).toHaveText('↓')
})

test('the joystick on the screen follows the thumb and lets go', async ({ browser }) => {
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 412, height: 839 },
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  await page.goto('./')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Joystick on the screen').selectOption('right')
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Host a game' }).click()

  const stick = page.locator('.joystick')
  const knob = stick.locator('.knob')
  const box = await stick.locator('.base').boundingBox()
  if (!box) throw new Error('no joystick')
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await expect(stick).toHaveClass(/held/)
  // Far past the edge: the knob stops at the pad's edge, half its size away.
  await page.mouse.move(center.x + box.width * 3, center.y)
  await expect(knob).toHaveAttribute('style', /translate\(50%, 0%\)/)
  await page.mouse.up()
  await expect(stick).not.toHaveClass(/held/)
  await expect(knob).not.toHaveAttribute('style', /translate/)
})
