import './style.css'
import { unpack } from '@fionapreroll/p2p'
import { setLanguage } from './i18n'
import { settings } from './settings'
import { homeScreen, playerName } from './ui/home'
import { hostScreen } from './ui/host'
import { joinScreen } from './ui/join'
import { settingsScreen } from './ui/settings'

setLanguage(settings().language)

function home(): void {
  homeScreen({
    host: (name) => hostScreen(name, home),
    join: (name) => joinScreen(name, home),
    rejoin: (name, game) => joinScreen(name, home, { rejoin: game.host }),
    resume: (name, game) => hostScreen(name, home, game),
    settings: () => settingsScreen(home),
  })
}

// Opened from the host's QR code with the phone's camera app: join at once.
const offer = unpack(location.hash)
if (location.hash) history.replaceState(null, '', location.pathname + location.search)
if (offer?.type === 'offer') joinScreen(playerName(), home, { offer })
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
