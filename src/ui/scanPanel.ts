import { type Signal, unpack } from '@fionapreroll/p2p'
import {
  cameraIds,
  decodePhoto,
  type Range,
  type Scanner,
  startScanner,
} from '@fionapreroll/p2p/qr'
import { t } from '../i18n'
import { nativeScan, nativeScannerReady } from '../native'
import { settings, updateCamera } from '../settings'
import { h } from './dom'

export interface ScanPanel {
  readonly element: HTMLElement
  /** Resolves once the live camera is on, with false if there is none. */
  readonly ready: Promise<boolean>
  stop(): void
}

/**
 * Reads the other phone's code, of one kind, offer or answer. Codes of the other kind, or QR
 * codes of other things, are ignored, so a camera that still sees the phone's own code or a
 * poster on the wall does no harm. `onSignal` returns true when it takes the code; the panel
 * then stops.
 *
 * For cameras that will not focus on a screen nearby:
 * - tapping the picture focuses and meters anew on that spot;
 * - zoom, so the phone can be held further away, where it focuses;
 * - brightness, against a code that glares;
 * - switching between the phone's cameras, as some have one that focuses closer;
 * - a photo taken with the phone's own camera app, which focuses better than the browser;
 * - in the Android app, Google's own scanner screen, which focuses and zooms by itself.
 * The sliders show only where the camera has the setting. The camera, its zoom and its
 * brightness are remembered for the next time.
 */
export function scanPanel(
  type: Signal['type'],
  onSignal: (signal: Signal) => boolean,
  big = false,
): ScanPanel {
  const video = h('video', { class: 'camera' })
  const ring = h('span', { class: 'focus-ring', hidden: true })
  const viewfinder = h('div', { class: big ? 'viewfinder big' : 'viewfinder' }, video, ring)
  const sliders = h('div', { class: 'camera-controls' })
  const switcher = h('button', { type: 'button', textContent: t('switchCamera'), hidden: true })
  const live = h('button', { type: 'button', textContent: t('liveCamera'), hidden: true })
  const photoInput = h('input', { type: 'file', accept: 'image/*', hidden: true, class: 'photo' })
  photoInput.setAttribute('capture', 'environment')
  const photo = h('button', {
    type: 'button',
    textContent: t('takePhoto'),
    onclick: () => {
      // The camera app cannot open the camera while the browser holds it.
      scanner?.stop()
      scanner = null
      showLive(false)
      photoInput.value = ''
      photoInput.click()
    },
  })
  // Shown once the app knows Google's scanner can open; never in a browser.
  const native = h('button', {
    type: 'button',
    class: 'primary',
    textContent: t('scanNative'),
    hidden: true,
    onclick: async () => {
      // Google's scanner needs the camera, which the page holds while it shows the picture.
      scanner?.stop()
      scanner = null
      showLive(false)
      message.textContent = ''
      const texts = await nativeScan()
      if (done || (texts !== null && take(texts))) return
      if (texts !== null && texts.length > 0) message.textContent = t('badCode')
      void start()
    },
  })
  const message = h('p', { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>)
  const help = h('p', { class: 'muted' }, t('scanHelpBasic'))
  const element = h(
    'div',
    { class: 'scan' },
    native,
    viewfinder,
    sliders,
    help,
    h('div', { class: 'buttons' }, switcher, photo, live),
    photoInput,
    message,
  )

  let scanner: Scanner | null = null
  let done = false
  let cameras: string[] = []

  const take = (texts: readonly string[]): boolean => {
    if (done) return true
    for (const text of texts) {
      const signal = unpack(text)
      if (signal?.type === type && onSignal(signal)) {
        stop()
        return true
      }
    }
    return false
  }

  /**
   * Opens a camera: the one asked for, or the one remembered from last time, or the back
   * camera. The remembered zoom and brightness come back with the remembered camera.
   */
  const start = async (deviceId?: string): Promise<boolean> => {
    scanner?.stop()
    scanner = null
    const saved = settings().camera
    const wanted = deviceId ?? saved.deviceId ?? undefined
    const open = (id?: string) => startScanner(video, (text) => take([text]), id)
    try {
      // A remembered camera may be gone, or the browser may have new ids for its cameras.
      const started = await open(wanted).catch((error: unknown) => {
        if (wanted === undefined) throw error
        updateCamera({ deviceId: null, zoom: null, exposure: null })
        return open()
      })
      if (done) {
        started.stop()
        return true
      }
      scanner = started
    } catch {
      showLive(false)
      viewfinder.hidden = true
      live.hidden = true
      return false
    }
    const camera = scanner
    if (deviceId !== undefined) {
      // Another camera chosen: remember it, without the settings of the one before.
      updateCamera({ deviceId: camera.deviceId ?? null, zoom: null, exposure: null })
    } else if (camera.deviceId !== undefined && camera.deviceId === saved.deviceId) {
      await restore(camera, 'zoom', saved.zoom)
      await restore(camera, 'exposure', saved.exposure)
    }
    showLive(true)
    sliders.replaceChildren(
      ...[
        slider(t('zoom'), camera.zoom, camera.get('zoom'), (v) => {
          void camera.set('zoom', v)
          updateCamera({ deviceId: camera.deviceId ?? null, zoom: v })
        }),
        slider(t('brightness'), camera.exposure, camera.get('exposure'), (v) => {
          void camera.set('exposure', v)
          updateCamera({ deviceId: camera.deviceId ?? null, exposure: v })
        }),
      ].filter((s) => s !== null),
    )
    help.textContent = camera.zoom || camera.exposure ? t('scanHelp') : t('scanHelpBasic')
    cameras = await cameraIds()
    switcher.hidden = cameras.length < 2
    return true
  }

  function showLive(on: boolean) {
    viewfinder.hidden = !on
    sliders.hidden = !on
    help.hidden = !on
    switcher.hidden = !on || cameras.length < 2
    live.hidden = on
  }

  function stop() {
    done = true
    scanner?.stop()
    scanner = null
  }

  viewfinder.addEventListener('click', (event) => {
    if (!scanner) return
    const point = videoPoint(video, event)
    if (!point) return
    void scanner.focusAt(point.x, point.y)
    const box = viewfinder.getBoundingClientRect()
    ring.style.left = `${event.clientX - box.left}px`
    ring.style.top = `${event.clientY - box.top}px`
    ring.hidden = false
    ring.classList.remove('pulse')
    void ring.offsetWidth
    ring.classList.add('pulse')
  })

  switcher.addEventListener('click', () => {
    const current = cameras.indexOf(scanner?.deviceId ?? '')
    void start(cameras[(current + 1) % cameras.length])
  })

  live.addEventListener('click', () => {
    message.textContent = ''
    void start()
  })

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0]
    if (!file || done) return
    message.textContent = t('readingPhoto')
    const texts = await decodePhoto(file).catch(() => [])
    if (take(texts)) {
      message.textContent = ''
      return
    }
    message.textContent = t('photoNoCode')
  })

  void nativeScannerReady().then((ready) => {
    native.hidden = !ready || done
  })

  return {
    element,
    ready: start(),
    stop,
  }
}

/** Sets a remembered zoom or brightness again, if the camera still allows that value. */
async function restore(
  camera: Scanner,
  setting: 'zoom' | 'exposure',
  value: number | null,
): Promise<void> {
  const range = setting === 'zoom' ? camera.zoom : camera.exposure
  if (value !== null && range !== null && value >= range.min && value <= range.max) {
    await camera.set(setting, value)
  }
}

/** A slider for a camera setting, or null where the camera does not have it. */
function slider(
  label: string,
  range: Range | null,
  value: number | null,
  onInput: (value: number) => void,
): HTMLElement | null {
  if (range === null) return null
  const input = h('input', {
    type: 'range',
    min: String(range.min),
    max: String(range.max),
    step: String(range.step || (range.max - range.min) / 100),
    value: String(value ?? range.min),
  })
  input.addEventListener('input', () => onInput(Number(input.value)))
  return h('label', { class: 'slider' }, label, input)
}

/**
 * Where a tap lands in the camera picture, from 0 to 1 on each axis. The video fills its box
 * and is cut at the edges (`object-fit: cover`), so the box and the picture differ.
 */
function videoPoint(video: HTMLVideoElement, event: MouseEvent): { x: number; y: number } | null {
  const box = video.getBoundingClientRect()
  if (video.videoWidth === 0 || box.width === 0) return null
  const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight)
  const left = (box.width - video.videoWidth * scale) / 2
  const top = (box.height - video.videoHeight * scale) / 2
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return {
    x: clamp((event.clientX - box.left - left) / (video.videoWidth * scale)),
    y: clamp((event.clientY - box.top - top) / (video.videoHeight * scale)),
  }
}
