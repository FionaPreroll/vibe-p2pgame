import { renderSVG } from 'uqr'

/** A QR code as SVG markup, as `qrElement` shows it. */
export function qrSvg(text: string): string {
  return renderSVG(text, { ecc: 'M', border: 3 })
}

/**
 * A QR code as an SVG element, in a box with the class `qr`: black on white with a wide quiet zone, which phone cameras need
 * to find the code on a bright screen. Medium error correction survives glare and smudges.
 */
export function qrElement(text: string): HTMLElement {
  const box = document.createElement('div')
  box.className = 'qr'
  box.innerHTML = qrSvg(text)
  return box
}
