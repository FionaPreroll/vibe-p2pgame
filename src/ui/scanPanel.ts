import { type Signal, unpack } from '@fionapreroll/p2p'
import { cameraView } from '@fionapreroll/p2p/qr'
import { t } from '../i18n'
import { describeError, log } from '../log'
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
 * For cameras that will not focus on a screen nearby, the library's camera view brings tapping
 * the picture to focus, zoom, brightness, switching cameras and photos; in the Android app,
 * Google's own scanner screen, which focuses and zooms by itself, comes on top. The camera, its
 * zoom and its brightness are remembered for the next time.
 */
export function scanPanel(
  type: Signal['type'],
  onSignal: (signal: Signal) => boolean,
  big = false,
): ScanPanel {
  let done = false
  const take = (texts: readonly string[]): boolean => {
    if (done) return true
    for (const text of texts) {
      const signal = unpack(text)
      if (signal?.type === type && onSignal(signal)) {
        done = true
        return true
      }
    }
    return false
  }

  const message = h('p', { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>)
  const help = h('p', { class: 'muted' }, t('scanHelpBasic'))
  const camera = cameraView({
    texts: {
      zoom: t('zoom'),
      brightness: t('brightness'),
      switchCamera: t('switchCamera'),
      takePhoto: t('takePhoto'),
      liveCamera: t('liveCamera'),
    },
    onCodes: (texts) => take(texts),
    camera: settings().camera,
    onCameraChange: updateCamera,
    onLive: (scanner) => {
      help.hidden = scanner === null
      if (scanner) {
        message.textContent = ''
        help.textContent = scanner.zoom || scanner.exposure ? t('scanHelp') : t('scanHelpBasic')
      }
    },
    onError: (error) => {
      help.hidden = true
      log('camera', `no live camera: ${describeError(error)}`)
    },
    onPhoto: (state) => {
      message.textContent = state === 'reading' ? t('readingPhoto') : t('photoNoCode')
    },
  })
  if (big) camera.viewfinder.classList.add('big')
  camera.buttons.classList.add('buttons')

  // Shown once the app knows Google's scanner can open; never in a browser.
  const native = h('button', {
    type: 'button',
    class: 'primary',
    textContent: t('scanNative'),
    hidden: true,
    onclick: async () => {
      // Google's scanner needs the camera, which the page holds while it shows the picture.
      camera.release()
      message.textContent = ''
      const texts = await nativeScan()
      log(
        'camera',
        texts === null
          ? "Google's scanner closed without a code"
          : `Google's scanner read ${texts.length} code(s)`,
      )
      if (done || (texts !== null && take(texts))) return stop()
      const bad = texts !== null && texts.length > 0
      // After the live picture is back, which clears the line.
      void camera.start().then(() => {
        if (bad && !done) message.textContent = t('badCode')
      })
    },
  })
  const element = h(
    'div',
    { class: 'scan' },
    native,
    camera.viewfinder,
    camera.controls,
    help,
    camera.buttons,
    message,
  )

  function stop() {
    done = true
    camera.stop()
  }

  void nativeScannerReady().then((ready) => {
    native.hidden = !ready || done
  })

  return { element, ready: camera.ready, stop }
}
