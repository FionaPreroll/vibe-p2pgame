/**
 * Draws the Android app's launcher icons and splash screens from public/icon.svg, in every size
 * the Android project holds: `pnpm icons:android`. Needs Playwright's Chromium (set
 * CHROMIUM_PATH to use another one).
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const RES = 'android/app/src/main/res'
const BACKGROUND = '#0b0d1a'
const ICON_BACKGROUND = '#12152b'

type Kind = 'launcher' | 'round' | 'foreground' | 'splash'

function kindOf(file: string): Kind | undefined {
  if (file === 'ic_launcher.png') return 'launcher'
  if (file === 'ic_launcher_round.png') return 'round'
  if (file === 'ic_launcher_foreground.png') return 'foreground'
  if (file === 'splash.png') return 'splash'
  return undefined
}

/** The page that draws one image: the icon's artwork without its square, framed for the kind. */
function page(kind: Kind, art: string, width: number, height: number): string {
  const svg = (size: number, background = '') =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">${background}${art}</svg>`
  const side = Math.min(width, height)
  const content = {
    launcher: svg(side, `<rect width="512" height="512" rx="96" fill="${ICON_BACKGROUND}"/>`),
    round: svg(side, `<circle cx="256" cy="256" r="256" fill="${ICON_BACKGROUND}"/>`),
    // Adaptive icons show only the middle 66 of 108 units; the background is a color resource.
    foreground: svg(Math.round((side * 66) / 108)),
    splash: svg(Math.round(side * 0.35)),
  }[kind]
  const fill = kind === 'splash' ? BACKGROUND : 'transparent'
  return `<body style="margin:0;background:${fill}"><div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center">${content}</div></body>`
}

function size(png: Buffer): [number, number] {
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

const source = await readFile('public/icon.svg', 'utf8')
const art = source
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<title>[\s\S]*?<\/title>/, '')
  .replace(/<rect[^>]*\/>/, '')
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
)
const tab = await browser.newPage()
for (const folder of (await readdir(RES)).sort()) {
  for (const file of (await readdir(join(RES, folder))).sort()) {
    const kind = kindOf(file)
    if (!kind) continue
    const path = join(RES, folder, file)
    const [width, height] = size(await readFile(path))
    await tab.setViewportSize({ width, height })
    await tab.setContent(page(kind, art, width, height))
    await tab.screenshot({ path, omitBackground: kind !== 'splash' })
    console.log(`${path} ${width}×${height}`)
  }
}
await browser.close()
