import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * What tools/androidIcons.ts draws: which file is which kind of image, the page that draws it,
 * the artwork of public/icon.svg, and the drawing of every image into the Android project, with
 * a browser tab to draw in. Tested in tools/icons.test.ts, with a fake tab.
 */

const BACKGROUND = '#0b0d1a'
const ICON_BACKGROUND = '#12152b'

export type Kind = 'launcher' | 'round' | 'foreground' | 'splash'

export function kindOf(file: string): Kind | undefined {
  if (file === 'ic_launcher.png') return 'launcher'
  if (file === 'ic_launcher_round.png') return 'round'
  if (file === 'ic_launcher_foreground.png') return 'foreground'
  if (file === 'splash.png') return 'splash'
  return undefined
}

/** The page that draws one image: the icon's artwork without its square, framed for the kind. */
export function page(kind: Kind, art: string, width: number, height: number): string {
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

/** A PNG's width and height, from its header. */
export function size(png: Buffer): [number, number] {
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

/** The artwork of an SVG icon: what is inside its root, without its title and its square. */
export function artOf(source: string): string {
  return source
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<rect[^>]*\/>/, '')
}

/** What drawing needs of a browser tab (a Playwright page). */
export interface Tab {
  setViewportSize(size: { width: number; height: number }): Promise<void>
  setContent(html: string): Promise<void>
  screenshot(options: { path: string; omitBackground: boolean }): Promise<unknown>
}

/**
 * Draws every launcher icon and splash screen in a resources folder anew, each in the size of
 * the image already there, and returns their paths. Other files stay as they are.
 */
export async function drawIcons(res: string, art: string, tab: Tab): Promise<string[]> {
  const drawn: string[] = []
  for (const folder of (await readdir(res)).sort()) {
    for (const file of (await readdir(join(res, folder))).sort()) {
      const kind = kindOf(file)
      if (!kind) continue
      const path = join(res, folder, file)
      const [width, height] = size(await readFile(path))
      await tab.setViewportSize({ width, height })
      await tab.setContent(page(kind, art, width, height))
      await tab.screenshot({ path, omitBackground: kind !== 'splash' })
      drawn.push(`${path} ${width}×${height}`)
    }
  }
  return drawn
}
