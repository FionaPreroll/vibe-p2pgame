/**
 * Draws the Android app's launcher icons and splash screens from public/icon.svg, in every size
 * the Android project holds: `pnpm icons:android`. Needs Playwright's Chromium (set
 * CHROMIUM_PATH to use another one). What it draws is in tools/icons.ts.
 */
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { artOf, drawIcons } from './icons.ts'

const art = artOf(await readFile('public/icon.svg', 'utf8'))
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
)
for (const line of await drawIcons('android/app/src/main/res', art, await browser.newPage())) {
  console.log(line)
}
await browser.close()
