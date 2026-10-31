import jsQR from 'jsqr'

const SCAN_INTERVAL_MS = 120

/** A camera setting with a range, such as zoom, as the camera reports it. */
export interface Range {
  readonly min: number
  readonly max: number
  readonly step: number
}

/**
 * The camera settings that help with a code that will not come sharp. Browsers expose them
 * only where the camera has them: Chrome on Android mostly does, iOS mostly does not.
 */
interface CameraCapabilities {
  zoom?: Range
  exposureCompensation?: Range
  focusMode?: string[]
  exposureMode?: string[]
}

export interface Scanner {
  /** Zoom and brightness, where this camera has them. */
  readonly zoom: Range | null
  readonly exposure: Range | null
  /** The current value of a setting. */
  get(setting: 'zoom' | 'exposure'): number | null
  set(setting: 'zoom' | 'exposure', value: number): Promise<void>
  /** Focuses and meters anew on a point of the picture, from 0 to 1 on each axis. */
  focusAt(x: number, y: number): Promise<void>
  /** The id of the camera in use, to switch to the next one. */
  readonly deviceId: string | undefined
  stop(): void
}

/**
 * Opens a camera in a video element and reads QR codes from it, until `onCode` returns true
 * or the scanner is stopped. Without `deviceId`, the back camera. Rejects if there is no
 * camera or the player says no.
 *
 * Opening the camera has a second use: Chrome hides a page's local network addresses behind
 * random mDNS names, unless the page may use the camera. With real addresses in the codes,
 * phones on a hotspot find each other even where the hotspot drops mDNS.
 */
export async function startScanner(
  video: HTMLVideoElement,
  onCode: (text: string) => boolean,
  deviceId?: string,
): Promise<Scanner> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }),
      // More pixels let a code be read from further away, where a phone can focus.
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  })
  const [track] = stream.getVideoTracks()
  if (!track) throw new Error('No video track')
  const capabilities = (track.getCapabilities?.() ?? {}) as CameraCapabilities
  if (capabilities.focusMode?.includes('continuous')) {
    await apply(track, { focusMode: 'continuous' })
  }
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play().catch(() => {})

  let running = true
  let timer = 0
  let attempt = 0
  const scan = async () => {
    if (!running) return
    if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      const texts = await decodeFrame(video, video.videoWidth, video.videoHeight, attempt++)
      if (!running) return
      if (texts.some(onCode)) return stop()
    }
    timer = window.setTimeout(scan, SCAN_INTERVAL_MS)
  }

  function stop() {
    running = false
    clearTimeout(timer)
    for (const t of stream.getTracks()) t.stop()
    video.srcObject = null
  }

  const settingName = { zoom: 'zoom', exposure: 'exposureCompensation' } as const
  void scan()
  return {
    zoom: usable(capabilities.zoom),
    exposure: usable(capabilities.exposureCompensation),
    get: (setting) => {
      const value = (track.getSettings() as Record<string, unknown>)[settingName[setting]]
      return typeof value === 'number' ? value : null
    },
    set: (setting, value) => apply(track, { [settingName[setting]]: value }),
    focusAt: async (x, y) => {
      // Each set on its own: a browser skips a whole set that has one unknown setting.
      const sets: Record<string, unknown>[] = [{ pointsOfInterest: [{ x, y }] }]
      if (capabilities.exposureMode?.includes('continuous')) {
        sets.push({ exposureMode: 'continuous' })
      }
      const modes = capabilities.focusMode ?? []
      if (modes.includes('single-shot')) {
        sets.push({ focusMode: 'single-shot' })
      } else if (modes.includes('continuous')) {
        // Some cameras only focus anew when continuous focus is switched off and on again.
        if (modes.includes('manual')) await apply(track, { focusMode: 'manual' })
        sets.push({ focusMode: 'continuous' })
      }
      await track.applyConstraints({ advanced: sets } as MediaTrackConstraints).catch(() => {})
    },
    deviceId: track.getSettings().deviceId,
    stop,
  }
}

/** The ids of all cameras, once the page may use them: before that, browsers hide them. */
export async function cameraIds(): Promise<string[]> {
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
  return devices.filter((d) => d.kind === 'videoinput' && d.deviceId).map((d) => d.deviceId)
}

/**
 * Reads QR codes from a photo, such as one taken with the phone's own camera app, which
 * focuses better than a live picture in the browser. Tries a few sizes and the middle of the
 * picture, as a blurred code often reads at one size and not another.
 */
export async function decodePhoto(file: Blob): Promise<string[]> {
  const bitmap = await createImageBitmap(file)
  try {
    const native = await nativeDecode(bitmap)
    if (native.length > 0) return native
    for (const [crop, size] of [
      [1, 1024],
      [1, 640],
      [0.6, 1024],
      [1, 1600],
      [0.4, 800],
    ] as const) {
      const text = jsQRDecode(bitmap, bitmap.width, bitmap.height, crop, size)
      if (text !== undefined) return [text]
    }
    return []
  } finally {
    bitmap.close()
  }
}

/**
 * One video frame. The browser's own detector, where there is one (Chrome on Android), reads
 * blurred and small codes far better than jsQR. jsQR still runs on every other frame, in case
 * the detector is there but finds nothing, and takes turns between the whole frame and its
 * middle at full detail, for a code held further away.
 */
async function decodeFrame(
  video: HTMLVideoElement,
  width: number,
  height: number,
  attempt: number,
): Promise<string[]> {
  const native = await nativeDecode(video)
  if (native.length > 0 || (nativeDetector() !== null && attempt % 2 === 0)) return native
  const text =
    Math.floor(attempt / 2) % 2 === 0
      ? jsQRDecode(video, width, height, 1, 640)
      : jsQRDecode(video, width, height, 0.5, 720)
  return text === undefined ? [] : [text]
}

/** One canvas for all decoding, made when first needed: importing needs no DOM. */
let canvas: HTMLCanvasElement | undefined
let context: CanvasRenderingContext2D | null = null

/** Decodes the middle `crop` of an image, scaled to at most `size` pixels across. */
function jsQRDecode(
  source: CanvasImageSource,
  width: number,
  height: number,
  crop: number,
  size: number,
): string | undefined {
  if (!canvas) {
    canvas = document.createElement('canvas')
    context = canvas.getContext('2d', { willReadFrequently: true })
  }
  if (!context) return undefined
  const sw = width * crop
  const sh = height * crop
  const scale = Math.min(1, size / Math.max(sw, sh))
  canvas.width = Math.round(sw * scale)
  canvas.height = Math.round(sh * scale)
  context.drawImage(
    source,
    (width - sw) / 2,
    (height - sh) / 2,
    sw,
    sh,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data
}

interface BarcodeDetector {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>
}
let detector: BarcodeDetector | null | undefined

function nativeDetector(): BarcodeDetector | null {
  if (detector === undefined) {
    const Detector = (
      globalThis as {
        BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetector
      }
    ).BarcodeDetector
    try {
      detector = Detector ? new Detector({ formats: ['qr_code'] }) : null
    } catch {
      detector = null
    }
  }
  return detector
}

async function nativeDecode(source: ImageBitmapSource): Promise<string[]> {
  const found = await nativeDetector()
    ?.detect(source)
    .catch(() => [])
  return (found ?? []).map((code) => code.rawValue).filter(Boolean)
}

async function apply(track: MediaStreamTrack, set: Record<string, unknown>): Promise<void> {
  await track.applyConstraints({ advanced: [set] } as MediaTrackConstraints).catch(() => {})
}

/** A range worth a slider: some cameras report zoom from 1 to 1. */
function usable(range: Range | undefined): Range | null {
  return range && range.max > range.min ? range : null
}
