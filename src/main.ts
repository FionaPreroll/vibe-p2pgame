import './style.css'
import { language, t } from './i18n'
import { unpack } from './net/signal'
import { homeScreen, savedName } from './ui/home'
import { hostScreen } from './ui/host'
import { joinScreen } from './ui/join'

document.documentElement.lang = language
document.title = t('title')

function home(): void {
  homeScreen(
    (name) => hostScreen(name, home),
    (name) => joinScreen(name, home),
  )
}

// Opened from the host's QR code with the phone's camera app: join at once.
const offer = unpack(location.hash)
if (location.hash) history.replaceState(null, '', location.pathname + location.search)
if (offer?.type === 'offer') joinScreen(savedName(), home, offer)
else home()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('./sw.js')
    .then((registration) => {
      // A new version takes over as soon as it is ready, for the next start.
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') worker.postMessage('skipWaiting')
        })
      })
    })
    .catch(() => {})
}
