# @fionapreroll/p2p-nearby

Bluetooth for [`@fionapreroll/p2p`](../p2p/README.md) in Android apps made with [Capacitor](https://capacitorjs.com/): phones find each other nearby and connect without any Wi-Fi, through Google's Nearby Connections. Every connection is a `Connection` of the library, so rooms play over it as over WebRTC, and one room can mix both.

- **The host advertises** its game under the host's name; **players look** for games nearby and ask one to let them in.
- **Both phones show the same code**, and the host accepts a player only after comparing it, so nobody nearby slips in.
- **A star**, as the library's rooms are: up to about seven players per host (Nearby's `P2P_STAR`). Nearby finds phones over Bluetooth Low Energy, connects them over Bluetooth, and moves to a faster Wi-Fi link between them where it can, without disturbing the phones' own Wi-Fi.
- **Only the game's own service** is looked for: phones of other games and apps are never found.

It needs Google Play services on the phone. In a browser, and on phones without Google Play services, starting fails with a reason the game can show.

## Installing

Like `@fionapreroll/p2p`, from GitHub's npm registry (see its README for the `.npmrc`), in a Capacitor 8 app that has the library:

```bash
pnpm add @fionapreroll/p2p-nearby
```

```bash
npx cap sync android
```

`cap sync` adds the native plugin to the app's Android project, with Google's `play-services-nearby` and the permissions below; nothing to register by hand.

## How a game uses it

```ts
import { HostRoom, GuestRoom } from '@fionapreroll/p2p/room'
import { Nearby, NearbyStartError } from '@fionapreroll/p2p-nearby'

const nearby = new Nearby({
  serviceId: 'com.example.mygame', // only phones of this game find each other
  log: (line) => console.debug(line), // optional: what happens, never names or messages
})

// The host's phone: advertise, and let players in after comparing the code.
nearby.onRequest = (request) => {
  if (!confirm(`${request.name} shows ${request.digits}?`)) return nearby.reject(request)
  const connection = nearby.accept(request)
  if (connection) room.attach(connection)
}
await nearby.host('Ada') // throws NearbyStartError: kind 'permission', 'bluetooth-off', …

// A player's phone: look for games nearby, and ask one.
nearby.onFound = (host) => showGame(host) // { endpointId, name }
nearby.onLost = (endpointId) => hideGame(endpointId)
await nearby.look('Bo')
const { connection, digits } = nearby.dial(host, 'Bo')
showCode(await digits) // the same code as on the host's screen
const guest = await GuestRoom.join(connection, { name: 'Bo', token, version, parseState })

await nearby.stop() // stops advertising or looking; connections stay
```

`NearbyStartError` says why Nearby could not start, in `kind`: `permission` (a permission was refused), `unavailable` (no Google Play services), `bluetooth-off`, `location-off`, or `radio` for anything else. `code` and `message` carry Nearby's own status, such as `nearby-8007`, for a debug report; `nearby.diagnostics()` adds the phone, Google Play services, every permission's state and the native log.

A host sends a Bluetooth player fewer states than one over Wi-Fi: 15 a second by default (`stateIntervalMs`), as Bluetooth carries less.

## Permissions

The plugin brings them in its own Android manifest, merged into the app: Bluetooth (`BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, and `BLUETOOTH` and `BLUETOOTH_ADMIN` up to Android 11), Wi-Fi state, `NEARBY_WIFI_DEVICES`, and location. At runtime, it asks only for what the phone's Android version needs, when the game starts Nearby. Players are asked for location on every version, as Nearby needs it to discover games nearby; approximate is enough from Android 13 on. Hosts are not asked for it there.

Name the permissions in your app's privacy policy: location is needed to find phones nearby, not read.

## Security

Nobody nearby is trusted, and neither is the native side:

- Every native event is read field by field: ids, names, codes and channels must look as they should, and names are cleaned as the library cleans them.
- A host hears requests only while it advertises, and at most four wait at once; more are turned down at once, natively too.
- An answer to a request this phone never made is turned down, and a connection nobody here asked for or accepted is ended.
- Messages count only from accepted, open connections, on a known channel, as short text: `packetConnection` checks them. The native side takes at most 120 messages a second from a connection, of at most 32 KB, and drops `fast` messages while two are on their way.
- The log holds endpoint ids, roles and statuses, never names or messages.

## Testing a game

`@fionapreroll/p2p-nearby/testing` plays Nearby without phones: `NearbyAir` carries between fake phones what Nearby would, a moment later.

```ts
import { Nearby } from '@fionapreroll/p2p-nearby'
import { NearbyAir } from '@fionapreroll/p2p-nearby/testing'

const air = new NearbyAir()
const host = new Nearby({ serviceId: 'com.example.mygame' }, air.phone('HOST1'))
const player = new Nearby({ serviceId: 'com.example.mygame' }, air.phone('PLAY1'))
```

`phone.emit(event, value)` makes up native events, as a misbehaving native side or neighbour would.

## Versions

The package follows [Semantic Versioning](https://semver.org/); changes are listed in `CHANGELOG.md`.

## License

None: all rights reserved. Google's Nearby Connections, which it uses, comes under Google's own terms.
