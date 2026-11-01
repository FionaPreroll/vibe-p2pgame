# @fionapreroll/p2p

Peer-to-peer games for phones in the browser: phones on a shared Wi-Fi, typically a hotspot opened by one of them, connect directly over WebRTC data channels, **without internet and without any server**. Instead of a signaling server, they swap their connection offers by scanning QR codes.

It grew out of [Spark Hunt](https://github.com/FionaPreroll/vibe-p2pgame), which uses it, and carries what any such game needs:

- **Short codes**: a WebRTC offer or answer packed into about 130 characters, small enough for a QR code a phone reads from another phone's screen.
- **Connections** with two data channels: `control`, reliable and ordered, and `fast`, unordered and never resent, like UDP.
- **A room** for a host and up to a handful of players, in a star. It lets players in, checks versions, keeps the places of players who drop out for when they rejoin, drops players who fall silent, measures pings and carries the game's input and state.
- **QR codes**: rendering as SVG, and scanning from the camera, with tap-to-focus, zoom, brightness, camera switching and reading photos.
- **Checking** of everything another phone sends, and **test helpers**: connections in memory, for testing a game in Node.

## Installing

The package is on GitHub's npm registry, which needs a login even to install. Add an `.npmrc` next to your `package.json`:

```
@fionapreroll:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Set `NODE_AUTH_TOKEN` to a GitHub token with the `read:packages` scope (on your computer, a personal access token; in GitHub Actions, `secrets.GITHUB_TOKEN` once the package grants your repository access under its _Package settings_). Then:

```bash
pnpm add @fionapreroll/p2p
```

It is ESM only, written in TypeScript with its types included, and runs in browsers. The room and the codes also run in Node, for tests.

## How a game uses it

The host runs the game; players send input and draw the state the host sends. A game brings its own input and state types, a version number for them, and a parser for each, as everything from another phone is checked before use.

```ts
import { answerOffer, isId, isNumber, isObject } from '@fionapreroll/p2p'
import { GuestRoom, HostRoom, randomToken } from '@fionapreroll/p2p/room'

type Input = { dx: number }
type State = { positions: Record<number, number> }

const VERSION = 1 // raise it whenever Input or State change
const parseInput = (v: unknown): Input | undefined =>
  isObject(v) && isNumber(v.dx) ? { dx: Math.max(-1, Math.min(1, v.dx)) } : undefined
const parseState = (v: unknown): State | undefined => {
  if (!isObject(v) || !isObject(v.positions)) return undefined
  const entries = Object.entries(v.positions)
  if (entries.length > 8 || !entries.every(([id, x]) => isId(Number(id)) && isNumber(x)))
    return undefined
  return { positions: v.positions as Record<number, number> }
}

// On the host's phone:
const room = new HostRoom<Input, State>({ name: 'Ada', version: VERSION, parseInput })
const positions = new Map<number, number>()
room.onJoin = (player) => positions.set(player.id, 0)
room.onLeave = (player) => positions.delete(player.id)
room.onInput = (player, input) =>
  positions.set(player.id, (positions.get(player.id) ?? 0) + input.dx)
room.onTick = () => ({ positions: Object.fromEntries(positions) }) // 30 times a second

const pairing = await room.pair()
showQr(pairing.code) // see below
// … once the player's answer code is scanned:
const { player } = await pairing.accept(answer)

// On a player's phone, with the offer code scanned:
const { link, code } = await answerOffer(offer)
showQr(code) // the host scans this
const guest = await GuestRoom.join<Input, State>(link, {
  name: 'Bo',
  token: randomToken(), // keep it in localStorage: with it, the player rejoins in their place
  version: VERSION,
  parseState,
})
guest.setInput({ dx: 1 }) // sent many times a second
guest.onState = (state) => draw(state)
guest.onLost = (ended) => (ended ? goHome() : offerRejoin())
```

### Pairing with QR codes

```ts
import { unpack } from '@fionapreroll/p2p'
import { qrElement, startScanner } from '@fionapreroll/p2p/qr'

document.body.append(qrElement(pairing.code))
const scanner = await startScanner(video, (text) => {
  const answer = unpack(text)
  if (answer?.type !== 'answer') return false // not ours: keep scanning
  void pairing.accept(answer)
  return true // stop
})
```

Open the camera **before** making the offer: Chrome puts a page's real local addresses into its codes only once the page may use the camera, and real addresses work on hotspots that do not pass on mDNS. Phones open the camera only on HTTPS pages.

`unpack` also reads a link with the code in its fragment, such as `https://example.com/game/#o=<code>`: put the offer in such a link, and a player can scan it with the phone's own camera app to open your game and join.

### Watching the connection

Both rooms count what goes over each connection, so a game can show how well it keeps up:

```ts
guest.ping() // the last round trip to the host, in milliseconds
guest.traffic() // { sent, sentChars, received, receivedChars, pings, pongs, lostPings }
room.players() // every player's id, name and ping, as they last measured it
room.traffic(id) // { sent, sentChars, received, receivedChars } for one player
```

The counts run from when the player got in, over both channels; `receivedChars` also counts messages dropped as malformed. Read them now and then, say once a second, and take the differences for rates. A ping counts as lost once it has gone unanswered for `PING_LOST_MS` (3 seconds); answers to pings the player never sent, or sent and gave up on, are ignored, and do not change `ping()` either.

### Other transports, such as Bluetooth

Rooms work on any `Connection`: WebRTC is one, and `packetConnection` makes one from any transport that carries text messages. The transport sends each message with its channel, and hands what arrives to `receive`; the connection checks it.

```ts
import { packetConnection } from '@fionapreroll/p2p'

const connection = packetConnection(
  {
    send: (channel, data) => radio.send(peerId, channel, data), // 'control' or 'fast'
    close: () => radio.disconnect(peerId),
  },
  { minStateIntervalMs: 1000 / 15 }, // a slow link: the host sends it 15 states a second
)
radio.onMessage = (peerId, channel, data) => connection.receive(channel, data)
radio.onConnected = () => connection.markOpen()
radio.onDisconnected = () => connection.markClosed()
room.attach(connection) // or GuestRoom.join(connection, …)
```

A transport may drop `fast` messages when it is busy, as WebRTC's unreliable channel does; `control` messages must arrive, in order. One room can mix transports: some players over WebRTC, others over Bluetooth.

## Entry points

| Import                      | What it has                                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@fionapreroll/p2p`         | `pack`, `unpack`, `fromSdp`, `toSdp`: codes. `createOffer`, `answerOffer`, `acceptAnswer`, `opened`, `onLost`: connections. `send`, `listen`, `decode`, `cleanName` and checks (`isObject`, `isNumber`, `isId`, `inRange`, `list`, `clamp`) for writing parsers. |
| `@fionapreroll/p2p/room`    | `HostRoom`, `GuestRoom`, `Seats`, `randomToken`, `ROOM_PROTOCOL`, `PING_LOST_MS`, the room's messages and their parsers.                                                                                                                                         |
| `@fionapreroll/p2p/qr`      | `qrSvg`, `qrElement`, `startScanner`, `cameraIds`, `decodePhoto`. Needs a DOM.                                                                                                                                                                                   |
| `@fionapreroll/p2p/testing` | `linkPair()`: two connections in memory, with `dropping` to lose messages and `close()` and `fail()` to end them.                                                                                                                                                |

## Security

Anyone can make a QR code, and any phone that pairs can send whatever it likes:

- Codes are read strictly by the ICE grammar: ICE characters for credentials, IP or mDNS addresses, at most six candidates. No field can smuggle a line into the SDP the browser reads.
- Messages longer than 16 KB are dropped unread; the rest is parsed as JSON and checked field by field, the game's part by the game's parsers. Write those with the checks of the main entry point: `isNumber` turns down Infinity, which JSON reads from `1e999`.
- Names lose control and formatting characters and are cut to 16 characters.
- A connection that opens but says no hello is closed after 15 seconds, so a phone cannot hold one without joining.
- A player only ever sends input for themselves. Player tokens never leave the host's room, so nobody can take another player's place by guessing.
- A host can only answer pings the player sent, each once: a made-up round trip is ignored.
- The connection is encrypted by WebRTC (DTLS), but a paired phone can still lie about its own input: the game decides what is possible.

## Testing a game

```ts
import { linkPair } from '@fionapreroll/p2p/testing'

const pair = linkPair()
const attached = room.attach(pair.host.link)
pair.open()
const guest = await GuestRoom.join(pair.guest.link, {
  name: 'Bo',
  token: 'test-token-1',
  version: VERSION,
  parseState,
})
```

With fake timers (`vi.useFakeTimers` in Vitest, faking `performance` too), a whole game runs in milliseconds.

## Versions

The package follows [Semantic Versioning](https://semver.org/); changes are listed in `CHANGELOG.md`. `ROOM_PROTOCOL` is the version of the room's own messages: phones with different ones do not play together, whatever the game's version.

## License

None: all rights reserved.
