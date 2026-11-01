import './style.css'
import { unpack } from '@fionapreroll/p2p'
import { handleBack } from './back'
import { setLanguage } from './i18n'
import { captureErrors, log } from './log'
import { exitApp, isApp, nativeScannerReady, onBackButton } from './native'
import { settings } from './settings'
import { aboutScreen } from './ui/about'
import { startJoin } from './ui/connect'
import { homeScreen, playerName } from './ui/home'
import { hostScreen } from './ui/host'
import { joinScreen } from './ui/join'
import { settingsScreen } from './ui/settings'
import { offerUpdates } from './ui/updates'

captureErrors()
log('app', `start: ${isApp() ? 'Android app' : 'browser'}, build ${__BUILD__.commit}`)
setLanguage(settings().language)
// Android's back button goes back as the screen says, is ignored in a game, and leaves the app
// on the start screen (see src/back.ts).
onBackButton(() => handleBack(exitApp))
// In the app, fetch Google's scanner now, while there may be internet, for later on a hotspot.
void nativeScannerReady()

function home(): void {
  homeScreen({
    host: (name) => hostScreen(name, home),
    join: (name) => startJoin(name, home),
    rejoin: (name, game) => startJoin(name, home, { rejoin: game.host }),
    resume: (name, game) => hostScreen(name, home, game),
    settings: () => settingsScreen(home),
    about: () => aboutScreen(home),
  })
}

// Opened from the host's QR code with the phone's camera app: join at once.
const offer = unpack(location.hash)
if (location.hash) history.replaceState(null, '', location.pathname + location.search)
if (offer?.type === 'offer') joinScreen(playerName(), home, { offer })
else home()

// In the app: ask once about updates, then look for one at every start if the player wants.
void offerUpdates()

// The app has its files inside; a service worker would only keep a second copy of them.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !isApp()) {
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
