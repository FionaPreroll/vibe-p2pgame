import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { artOf, drawIcons, kindOf, page, size, type Tab } from './icons'

/** A PNG's first bytes, as far as `size` reads them: the signature and the IHDR chunk. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24)
  bytes.write('\x89PNG\r\n\x1a\n', 0, 'latin1')
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'latin1')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

describe('the Android icons', () => {
  it('know each image by its file name', () => {
    expect(kindOf('ic_launcher.png')).toBe('launcher')
    expect(kindOf('ic_launcher_round.png')).toBe('round')
    expect(kindOf('ic_launcher_foreground.png')).toBe('foreground')
    expect(kindOf('splash.png')).toBe('splash')
    expect(kindOf('ic_launcher.xml')).toBeUndefined()
  })

  it('read the size of the image there', () => {
    expect(size(png(192, 108))).toEqual([192, 108])
  })

  it('take the artwork of the icon without its title and square', async () => {
    const art = artOf(await readFile('public/icon.svg', 'utf8'))
    expect(art).not.toMatch(/<svg|<\/svg>|<title>/)
    expect(art.length).toBeGreaterThan(20)
    expect(artOf('<svg a="1"><title>T</title><rect width="5"/><circle r="2"/></svg>\n')).toBe(
      '<circle r="2"/>',
    )
  })

  it('frame the artwork for each kind, in its size', () => {
    expect(page('launcher', '<g/>', 48, 48)).toContain('rx="96"')
    expect(page('round', '<g/>', 48, 48)).toContain('<circle')
    // Adaptive icons show only the middle 66 of 108 units.
    expect(page('foreground', '<g/>', 108, 108)).toContain('width="66"')
    // A splash screen: the artwork small, in the middle of the background.
    const splash = page('splash', '<g/>', 1000, 2000)
    expect(splash).toContain('width="350"')
    expect(splash).toContain('background:#0b0d1a')
    expect(page('launcher', '<g/>', 48, 48)).toContain('background:transparent')
  })

  describe('drawing', () => {
    let res = ''
    afterEach(async () => {
      if (res) await rm(res, { recursive: true, force: true })
    })

    it('draws every icon and splash screen in its size, and leaves other files', async () => {
      res = await mkdtemp(join(tmpdir(), 'icons-'))
      for (const [folder, file, width, height] of [
        ['mipmap-hdpi', 'ic_launcher.png', 72, 72],
        ['mipmap-hdpi', 'ic_launcher_round.png', 72, 72],
        ['mipmap-hdpi', 'ic_launcher.xml', 0, 0],
        ['drawable-port-hdpi', 'splash.png', 480, 800],
      ] as const) {
        await mkdir(join(res, folder), { recursive: true })
        await writeFile(join(res, folder, file), width ? png(width, height) : '<adaptive-icon/>')
      }
      const calls: string[] = []
      const tab: Tab = {
        setViewportSize: async ({ width, height }) => void calls.push(`size ${width}x${height}`),
        setContent: async (html) => void calls.push(html.includes('<g/>') ? 'page' : 'other'),
        screenshot: async ({ path, omitBackground }) =>
          calls.push(`shot ${path.slice(res.length + 1)} ${omitBackground}`),
      }
      const drawn = await drawIcons(res, '<g/>', tab)
      expect(drawn.map((line) => line.slice(res.length + 1))).toEqual([
        'drawable-port-hdpi/splash.png 480×800',
        'mipmap-hdpi/ic_launcher.png 72×72',
        'mipmap-hdpi/ic_launcher_round.png 72×72',
      ])
      expect(calls).toEqual([
        'size 480x800',
        'page',
        'shot drawable-port-hdpi/splash.png false',
        'size 72x72',
        'page',
        'shot mipmap-hdpi/ic_launcher.png true',
        'size 72x72',
        'page',
        'shot mipmap-hdpi/ic_launcher_round.png true',
      ])
    })
  })
})
