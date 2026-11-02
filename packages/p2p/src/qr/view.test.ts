// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cameraView, NO_CAMERA_CHOICE, parseCameraChoice, pointInPicture } from './view.ts'

const texts = {
  zoom: 'Zoom',
  brightness: 'Brightness',
  switchCamera: 'Switch',
  takePhoto: 'Photo',
  liveCamera: 'Live',
}

/** A camera as the browser gives it: a track with zoom, whose settings the test can read. */
function fakeCamera(deviceIds: string[] = ['back']) {
  const applied: unknown[] = []
  const opened: (string | undefined)[] = []
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    const video = constraints.video as { deviceId?: { exact: string } }
    const wanted = video.deviceId?.exact
    if (wanted !== undefined && !deviceIds.includes(wanted)) throw new Error('No such camera')
    const deviceId = wanted ?? deviceIds[0]
    opened.push(deviceId)
    const settings: Record<string, unknown> = { deviceId, zoom: 1 }
    const track = {
      getCapabilities: () => ({
        zoom: { min: 1, max: 4, step: 0.1 },
        focusMode: ['continuous', 'single-shot'],
      }),
      getSettings: () => settings,
      applyConstraints: async (c: { advanced: Record<string, unknown>[] }) => {
        applied.push(c.advanced)
        for (const set of c.advanced) Object.assign(settings, set)
      },
      stop: vi.fn(),
    }
    return { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
  })
  const enumerateDevices = async () =>
    deviceIds.map((deviceId) => ({ kind: 'videoinput', deviceId }) as MediaDeviceInfo)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices },
  })
  HTMLMediaElement.prototype.play = async () => {}
  // happy-dom takes only its own streams.
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get: () => null,
    set: () => {},
  })
  return { applied, opened }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('cameraView', () => {
  it('opens the camera, with a zoom slider and a switch between cameras', async () => {
    fakeCamera(['back', 'front'])
    const view = cameraView({ texts, onCodes: () => false })
    expect(await view.ready).toBe(true)
    await vi.waitFor(() => expect(view.buttons.querySelector('button')?.hidden).toBe(false))
    expect(view.controls.querySelectorAll('label.slider')).toHaveLength(1)
    expect(view.controls.textContent).toBe('Zoom')
    expect(view.viewfinder.hidden).toBe(false)
    view.stop()
    expect(view.scanner).toBeNull()
  })

  it('focuses where the picture is tapped, and shows the ring there', async () => {
    const camera = fakeCamera()
    const view = cameraView({ texts, onCodes: () => false })
    await view.ready
    const video = view.viewfinder.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'videoWidth', { value: 200 })
    Object.defineProperty(video, 'videoHeight', { value: 100 })
    video.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect
    view.viewfinder.dispatchEvent(new MouseEvent('click', { clientX: 50, clientY: 25 }))
    await vi.waitFor(() =>
      expect(camera.applied).toContainEqual([
        { pointsOfInterest: [{ x: 0.25, y: 0.25 }] },
        { focusMode: 'single-shot' },
      ]),
    )
    const ring = view.viewfinder.querySelector('.focus-ring') as HTMLElement
    expect(ring.hidden).toBe(false)
    expect(ring.classList.contains('pulse')).toBe(true)
    view.stop()
  })

  it('remembers the zoom, and sets it again on the same camera', async () => {
    fakeCamera()
    const changes: unknown[] = []
    const first = cameraView({
      texts,
      onCodes: () => false,
      onCameraChange: (c) => changes.push(c),
    })
    await first.ready
    const input = first.controls.querySelector('input') as HTMLInputElement
    input.value = '2'
    input.dispatchEvent(new Event('input'))
    expect(changes.at(-1)).toEqual({ deviceId: 'back', zoom: 2, exposure: null })
    first.stop()

    const camera = fakeCamera()
    const second = cameraView({
      texts,
      onCodes: () => false,
      camera: { deviceId: 'back', zoom: 3, exposure: null },
    })
    await second.ready
    expect(camera.applied).toContainEqual([{ zoom: 3 }])
    expect(second.scanner?.get('zoom')).toBe(3)
    second.stop()
  })

  it('falls back to the back camera when the remembered one is gone', async () => {
    const camera = fakeCamera(['new'])
    const changes: unknown[] = []
    const view = cameraView({
      texts,
      onCodes: () => false,
      camera: { deviceId: 'old', zoom: 2, exposure: null },
      onCameraChange: (c) => changes.push(c),
    })
    expect(await view.ready).toBe(true)
    expect(camera.opened).toEqual(['new'])
    expect(changes).toEqual([NO_CAMERA_CHOICE])
    view.stop()
  })

  it('says so when there is no camera, and still offers a photo', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => Promise.reject(new Error('NotAllowedError')) },
    })
    const onError = vi.fn()
    const view = cameraView({ texts, onCodes: () => false, onError })
    expect(await view.ready).toBe(false)
    expect(onError).toHaveBeenCalledOnce()
    expect(view.viewfinder.hidden).toBe(true)
    const shown = [...view.buttons.querySelectorAll('button')].filter((b) => !b.hidden)
    expect(shown.map((b) => b.textContent)).toEqual(['Photo'])
  })

  it('lets go of the camera for a photo, and offers it again', async () => {
    fakeCamera()
    const onLive = vi.fn()
    const view = cameraView({ texts, onCodes: () => false, onLive })
    await view.ready
    view.release()
    expect(view.scanner).toBeNull()
    expect(onLive).toHaveBeenLastCalledWith(null)
    const live = [...view.buttons.querySelectorAll('button')].find((b) => b.textContent === 'Live')
    expect(live?.hidden).toBe(false)
    live?.click()
    await vi.waitFor(() => expect(view.scanner).not.toBeNull())
    expect(live?.hidden).toBe(true)
    view.stop()
  })
})

describe('parseCameraChoice', () => {
  it('keeps what fits and drops the rest', () => {
    expect(parseCameraChoice({ deviceId: 'a', zoom: 2, exposure: -1 })).toEqual({
      deviceId: 'a',
      zoom: 2,
      exposure: -1,
    })
    expect(parseCameraChoice({ deviceId: 5, zoom: Number.NaN, exposure: '1' })).toEqual(
      NO_CAMERA_CHOICE,
    )
    expect(parseCameraChoice('x')).toEqual(NO_CAMERA_CHOICE)
    expect(parseCameraChoice(null)).toEqual(NO_CAMERA_CHOICE)
  })
})

describe('pointInPicture', () => {
  const box = { left: 10, top: 20, width: 100, height: 100 }

  it('maps a tap into a picture cut at the edges', () => {
    // 200 × 100 in a square box with cover: the picture is 200 wide, 50 cut on each side.
    expect(pointInPicture(box, 200, 100, 'cover', 60, 70)).toEqual({ x: 0.5, y: 0.5 })
    expect(pointInPicture(box, 200, 100, 'cover', 10, 20)).toEqual({ x: 0.25, y: 0 })
  })

  it('maps a tap into a picture with bars beside it, clamped to the picture', () => {
    // With contain, the picture is 100 × 50, with bars of 25 above and below.
    expect(pointInPicture(box, 200, 100, 'contain', 10, 45)).toEqual({ x: 0, y: 0 })
    expect(pointInPicture(box, 200, 100, 'contain', 110, 20)).toEqual({ x: 1, y: 0 })
  })

  it('maps a tap into a stretched picture', () => {
    expect(pointInPicture(box, 200, 100, 'fill', 35, 95)).toEqual({ x: 0.25, y: 0.75 })
  })

  it('has no point before the picture shows', () => {
    expect(pointInPicture(box, 0, 0, 'cover', 60, 70)).toBeNull()
  })
})
