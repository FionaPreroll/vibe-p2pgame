import jsQR from 'jsqr'

/** Frames are scaled down to this width before decoding: plenty for a code on a phone screen. */
const SCAN_WIDTH = 640
const SCAN_INTERVAL_MS = 120

export interface Scanner {
  stop(): void
}

/**
 * Opens the back camera in a video element and reads QR codes from it, until `onCode` returns
 * true or the scanner is stopped. Rejects if there is no camera or the player says no.
 *
 * Opening the camera has a second use: Chrome hides a page's local network addresses behind
 * random mDNS names, unless the page may use the camera. With real addresses in the codes,
 * phones on a hotspot find each other even where the hotspot drops mDNS.
 */
export async function startScanner(
  video: HTMLVideoElement,
  onCode: (text: string) => boolean,
): Promise<Scanner> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
  })
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play().catch(() => {})
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  let running = true
  let timer = 0

  const scan = () => {
    if (!running) return
    if (context && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      const scale = Math.min(1, SCAN_WIDTH / video.videoWidth)
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })
      if (code?.data && onCode(code.data)) return stop()
    }
    timer = window.setTimeout(scan, SCAN_INTERVAL_MS)
  }

  function stop() {
    running = false
    clearTimeout(timer)
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }

  scan()
  return { stop }
}
