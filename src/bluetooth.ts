import { Nearby } from '@fionapreroll/p2p-nearby'
import { log } from './log'

export {
  type JoinRequest,
  NearbyHosting,
  NearbySearch,
  NearbyStartError,
  type Peer,
} from '@fionapreroll/p2p-nearby'

/**
 * Bluetooth between phones in the Android app, from `@fionapreroll/p2p-nearby` (Google's
 * Nearby Connections): Spark Hunt's own Nearby service, and its log. Only the Android app has
 * it: in a browser, players pair by QR code.
 */

/** Spark Hunt phones find only each other. */
export const SERVICE_ID = 'io.github.fionapreroll.sparkhunt.game'

let shared: Nearby | undefined

/** The app's one Nearby, made when first needed. */
export function bluetooth(): Nearby {
  shared ??= new Nearby({ serviceId: SERVICE_ID, log: (line) => log('bluetooth', line) })
  return shared
}
