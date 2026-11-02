import { cameraIds, decodePhoto, type Range, type Scanner, startScanner } from './scanner.ts'

/** The camera a player last used, and its zoom and brightness, for the next time. */
export interface CameraChoice {
  readonly deviceId: string | null
  readonly zoom: number | null
  readonly exposure: number | null
}

export const NO_CAMERA_CHOICE: CameraChoice = { deviceId: null, zoom: null, exposure: null }

/** A camera choice read back from storage, checked: anything that does not fit is left out. */
export function parseCameraChoice(value: unknown): CameraChoice {
  if (typeof value !== 'object' || value === null) return NO_CAMERA_CHOICE
  const { deviceId, zoom, exposure } = value as Record<string, unknown>
  const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    deviceId: typeof deviceId === 'string' && deviceId.length <= 512 ? deviceId : null,
    zoom: finite(zoom),
    exposure: finite(exposure),
  }
}

/** The texts of the camera view, in the game's language. */
export interface CameraViewTexts {
  readonly zoom: string
  readonly brightness: string
  readonly switchCamera: string
  readonly takePhoto: string
  readonly liveCamera: string
}

export interface CameraViewOptions {
  readonly texts: CameraViewTexts
  /**
   * The codes read from the live picture or from a photo. Returns true when the game takes one:
   * the view then stops. Codes it does not take, such as another game's, are skipped.
   */
  readonly onCodes: (texts: readonly string[], from: 'camera' | 'photo') => boolean
  /** The camera to open first, as `onCameraChange` last told it, such as from storage. */
  readonly camera?: CameraChoice
  /** The camera, its zoom or its brightness changed: worth remembering for the next time. */
  readonly onCameraChange?: (camera: CameraChoice) => void
  /** The live picture opened, with its scanner, or closed (null). */
  readonly onLive?: (scanner: Scanner | null) => void
  /** The live camera did not open: no camera, or the player said no. */
  readonly onError?: (error: unknown) => void
  /** A photo is being read, or held no code the game took. */
  readonly onPhoto?: (state: 'reading' | 'none') => void
}

/**
 * A camera that reads QR codes, with what helps when the code will not come sharp. Its parts
 * go where the game wants them; their look is the game's, by these classes:
 * - `viewfinder` (`.viewfinder`): the live picture (`video.camera`). Tapping it focuses and
 *   meters anew on that spot, and shows `.focus-ring` there, with the class `pulse` added
 *   anew for each tap, for the game's animation;
 * - `controls` (`.camera-controls`): sliders (`label.slider`) for zoom, to hold the phone
 *   further away, where it focuses, and brightness, against a code that glares; only where
 *   the camera has them;
 * - `buttons` (`.camera-buttons`): switching between the phone's cameras, as some have one
 *   that focuses closer; a photo with the phone's own camera app (`input.photo`), which
 *   focuses better than the browser; and back to the live camera after a photo.
 */
export interface CameraView {
  readonly viewfinder: HTMLElement
  readonly controls: HTMLElement
  readonly buttons: HTMLElement
  /** The live camera, while it is on. */
  readonly scanner: Scanner | null
  /** Resolves once the live camera is on, with false if there is none. */
  readonly ready: Promise<boolean>
  /** Opens the live camera again: the one asked for, or the one remembered. */
  start(deviceId?: string): Promise<boolean>
  /** Lets go of the camera, for another app to use it, and offers to open it again. */
  release(): void
  /** Ends the view: the camera goes off, and nothing more is read. */
  stop(): void
}

export function cameraView(options: CameraViewOptions): CameraView {
  const { texts } = options
  const video = element('video', 'camera')
  const ring = element('span', 'focus-ring')
  ring.hidden = true
  const viewfinder = element('div', 'viewfinder', video, ring)
  const controls = element('div', 'camera-controls')
  const switcher = button(texts.switchCamera)
  switcher.hidden = true
  const live = button(texts.liveCamera)
  live.hidden = true
  const photo = button(texts.takePhoto)
  const photoInput = element('input', 'photo')
  photoInput.type = 'file'
  photoInput.accept = 'image/*'
  photoInput.hidden = true
  photoInput.setAttribute('capture', 'environment')
  const buttons = element('div', 'camera-buttons', switcher, photo, live, photoInput)

  let remembered = options.camera ?? NO_CAMERA_CHOICE
  let scanner: Scanner | null = null
  let done = false
  let cameras: string[] = []
  // Each start counts, so a camera that opens after a newer start is closed again.
  let starts = 0

  const remember = (change: Partial<CameraChoice>) => {
    remembered = { ...remembered, ...change }
    options.onCameraChange?.(remembered)
  }

  const take = (found: readonly string[], from: 'camera' | 'photo'): boolean => {
    if (done) return true
    if (found.length === 0 || !options.onCodes(found, from)) return false
    stop()
    return true
  }

  const start = async (deviceId?: string): Promise<boolean> => {
    if (done) return false
    const startNo = ++starts
    scanner?.stop()
    scanner = null
    const saved = remembered
    const wanted = deviceId ?? saved.deviceId ?? undefined
    const open = (id?: string) => startScanner(video, (text) => take([text], 'camera'), id)
    let camera: Scanner
    try {
      // A remembered camera may be gone, or the browser may have new ids for its cameras.
      camera = await open(wanted).catch((error: unknown) => {
        if (wanted === undefined) throw error
        remember(NO_CAMERA_CHOICE)
        return open()
      })
    } catch (error) {
      if (startNo !== starts) return false
      showLive(false)
      viewfinder.hidden = true
      live.hidden = true
      options.onError?.(error)
      return false
    }
    if (done || startNo !== starts) {
      camera.stop()
      return done
    }
    scanner = camera
    if (deviceId !== undefined) {
      // Another camera chosen: remember it, without the settings of the one before.
      remember({ deviceId: camera.deviceId ?? null, zoom: null, exposure: null })
    } else if (camera.deviceId !== undefined && camera.deviceId === saved.deviceId) {
      await restore(camera, 'zoom', saved.zoom)
      await restore(camera, 'exposure', saved.exposure)
    }
    controls.replaceChildren(
      ...[
        slider(texts.zoom, camera.zoom, camera.get('zoom'), (v) => {
          void camera.set('zoom', v)
          remember({ deviceId: camera.deviceId ?? null, zoom: v })
        }),
        slider(texts.brightness, camera.exposure, camera.get('exposure'), (v) => {
          void camera.set('exposure', v)
          remember({ deviceId: camera.deviceId ?? null, exposure: v })
        }),
      ].filter((s) => s !== null),
    )
    showLive(true)
    options.onLive?.(camera)
    cameras = await cameraIds()
    if (scanner === camera) switcher.hidden = cameras.length < 2
    return true
  }

  function showLive(on: boolean) {
    viewfinder.hidden = !on
    controls.hidden = !on
    switcher.hidden = !on || cameras.length < 2
    live.hidden = on || done
  }

  function release() {
    starts++
    const was = scanner
    scanner?.stop()
    scanner = null
    showLive(false)
    if (was) options.onLive?.(null)
  }

  function stop() {
    done = true
    release()
  }

  viewfinder.addEventListener('click', (event) => {
    if (!scanner) return
    const point = videoPoint(video, event.clientX, event.clientY)
    if (!point) return
    void scanner.focusAt(point.x, point.y)
    const box = viewfinder.getBoundingClientRect()
    ring.style.left = `${event.clientX - box.left}px`
    ring.style.top = `${event.clientY - box.top}px`
    ring.hidden = false
    // Taken off and put on again, so the animation starts over with each tap.
    ring.classList.remove('pulse')
    void ring.offsetWidth
    ring.classList.add('pulse')
  })

  switcher.addEventListener('click', () => {
    const current = cameras.indexOf(scanner?.deviceId ?? '')
    void start(cameras[(current + 1) % cameras.length])
  })

  live.addEventListener('click', () => void start())

  photo.addEventListener('click', () => {
    // The camera app cannot open the camera while the browser holds it.
    release()
    photoInput.value = ''
    photoInput.click()
  })

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0]
    if (!file || done) return
    options.onPhoto?.('reading')
    const found = await decodePhoto(file).catch(() => [])
    if (!take(found, 'photo') && !done) options.onPhoto?.('none')
  })

  return {
    viewfinder,
    controls,
    buttons,
    get scanner() {
      return scanner
    },
    ready: start(),
    start,
    release,
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
  const input = element('input')
  input.type = 'range'
  input.min = String(range.min)
  input.max = String(range.max)
  input.step = String(range.step || (range.max - range.min) / 100)
  input.value = String(value ?? range.min)
  input.addEventListener('input', () => onInput(Number(input.value)))
  return element('label', 'slider', label, input)
}

/** Where a tap lands in the camera picture, from 0 to 1 on each axis, or null before it shows. */
function videoPoint(
  video: HTMLVideoElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const box = video.getBoundingClientRect()
  const fit = getComputedStyle(video).objectFit
  return pointInPicture(box, video.videoWidth, video.videoHeight, fit, clientX, clientY)
}

/**
 * Where a point of the screen lies in a picture of `width` × `height` pixels drawn into `box`
 * with `object-fit` `fit`: cut at the edges (`cover`), with bars beside it (`contain`, the
 * default for videos) or stretched (`fill`). From 0 to 1 on each axis, clamped to the picture.
 */
export function pointInPicture(
  box: { readonly left: number; readonly top: number; width: number; height: number },
  width: number,
  height: number,
  fit: string,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (width === 0 || height === 0 || box.width === 0 || box.height === 0) return null
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const x = clientX - box.left
  const y = clientY - box.top
  if (fit === 'fill') return { x: clamp(x / box.width), y: clamp(y / box.height) }
  const scale =
    fit === 'cover'
      ? Math.max(box.width / width, box.height / height)
      : Math.min(box.width / width, box.height / height)
  const left = (box.width - width * scale) / 2
  const top = (box.height - height * scale) / 2
  return { x: clamp((x - left) / (width * scale)), y: clamp((y - top) / (height * scale)) }
}

function button(text: string): HTMLButtonElement {
  const b = element('button')
  b.type = 'button'
  b.textContent = text
  return b
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  e.append(...children)
  return e
}
