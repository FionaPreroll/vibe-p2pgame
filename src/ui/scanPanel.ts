import { t } from '../i18n'
import { type Signal, unpack } from '../net/signal'
import { cameraIds, decodePhoto, type Range, type Scanner, startScanner } from '../qr/scanner'
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
 * - a photo taken with the phone's own camera app, which focuses better than the browser.
 * The sliders show only where the camera has the setting.
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
  const message = h('p', { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>)
  const help = h('p', { class: 'muted' }, t('scanHelpBasic'))
  const element = h(
    'div',
    { class: 'scan' },
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

  const start = async (deviceId?: string): Promise<boolean> => {
    scanner?.stop()
    scanner = null
    try {
      const started = await startScanner(video, (text) => take([text]), deviceId)
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
    showLive(true)
    sliders.replaceChildren(
      ...[
        slider(t('zoom'), scanner.zoom, scanner.get('zoom'), (v) => scanner?.set('zoom', v)),
        slider(t('brightness'), scanner.exposure, scanner.get('exposure'), (v) =>
          scanner?.set('exposure', v),
        ),
      ].filter((s) => s !== null),
    )
    help.textContent = scanner.zoom || scanner.exposure ? t('scanHelp') : t('scanHelpBasic')
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

  return {
    element,
    ready: start(),
    stop,
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
