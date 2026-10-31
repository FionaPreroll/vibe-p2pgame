import jsQR from 'jsqr'
import { encode } from 'uqr'
import { describe, expect, it } from 'vitest'
import { fromSdp, pack } from '../signal.ts'

/** Draws a QR code into RGBA pixels, as a camera frame would show it, and reads it back. */
function scan(text: string, pixelsPerModule = 4): string | undefined {
  const { data, size } = encode(text, { ecc: 'M', border: 3 })
  const width = size * pixelsPerModule
  const pixels = new Uint8ClampedArray(width * width * 4)
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const dark = data[Math.floor(y / pixelsPerModule)]?.[Math.floor(x / pixelsPerModule)]
      pixels.fill(dark ? 0 : 255, (y * width + x) * 4, (y * width + x) * 4 + 3)
      pixels[(y * width + x) * 4 + 3] = 255
    }
  }
  return jsQR(pixels, width, width)?.data
}

const OFFER = [
  'a=candidate:1 1 udp 2122260223 192.168.43.1 54321 typ host',
  'a=candidate:2 1 udp 2122129151 7f2c3a1e-1111-4b2b-9c3d-0e1f2a3b4c5d.local 50001 typ host',
  'a=ice-ufrag:Xk3Y',
  'a=ice-pwd:a1B2c3D4e5F6g7H8i9J0k1L2',
  'a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9',
  'a=setup:actpass',
].join('\n')

describe('QR codes', () => {
  it('carry a join link with an offer code, and read back unchanged', () => {
    const link = `https://fionapreroll.github.io/vibe-p2pgame/#o=${pack(fromSdp('offer', OFFER))}`
    expect(scan(link)).toBe(link)
  })

  it('stay small enough for a phone camera to read from a screen', () => {
    const link = `https://fionapreroll.github.io/vibe-p2pgame/#o=${pack(fromSdp('offer', OFFER))}`
    const { version } = encode(link, { ecc: 'M' })
    // Version 10 is 57 modules wide: on a 6 cm wide code, a module is still a millimetre.
    expect(version).toBeLessThanOrEqual(10)
  })
})
