# @fionapreroll/p2p

Peer-to-peer games for phones in the browser: phones on a shared Wi-Fi, typically a hotspot opened by one of them, connect directly over WebRTC data channels, **without internet and without any server**. Instead of a signaling server, they swap their connection offers by scanning QR codes.

It grew out of [Spark Hunt](https://github.com/FionaPreroll/vibe-p2pgame), which uses it, and carries what any such game needs:

- **Short codes**: a WebRTC offer or answer packed into about 130 characters, small enough for a QR code a phone reads from another phone's screen.
- **Connections** with two data channels: `control`, reliable and ordered, and `fast`, unordered and never resent, like UDP.
- **A room** for a host and up to a handful of players, in a star. It lets players in, checks versions, keeps the places of players who drop out for when they rejoin, drops players who fall silent, measures pings and carries the game's input and state.
- **QR codes**: rendering as SVG, and scanning from the camera, with tap-to-focus, zoom, brightness, camera switching and reading photos.
- **Checking** of everything another phone sends, and **test helpers**: connections in memory, for testing a game in Node.

## Installing

The package is on [GitHub's npm registry](https://github.com/FionaPreroll/vibe-p2pgame/pkgs/npm/p2p), which needs a login even to install. Add an `.npmrc` next to your `package.json`:

```
@fionapreroll:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Set `NODE_AUTH_TOKEN` to a GitHub token with the `read:packages` scope (on your computer, a personal access token; in GitHub Actions, `secrets.GITHUB_TOKEN` once the package grants your repository access under its _Package settings_). Then:

```bash
pnpm add @fionapreroll/p2p
```

Or without logging in, from the file on the version's release (see its [releases](https://github.com/FionaPreroll/vibe-p2pgame/releases)):

```bash
pnpm add https://github.com/FionaPreroll/vibe-p2pgame/releases/download/p2p-v0.6.0/fionapreroll-p2p-0.6.0.tgz
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

### Events, and a state for each player

Input and state suit what changes all the time: only the newest counts, and a lost one is skipped. Moves of a board game, a card played or a chat line must arrive instead, once each and in order: those are events, over the reliable channel, both ways. A game that keeps secrets, such as everyone's cards, gives each player their own part of the state with `stateFor`.

```ts
type Event = { play: number } | { say: string }
const parseEvent = (v: unknown): Event | undefined =>
  isObject(v) && isId(v.play) ? { play: v.play } : undefined // and so on

// On the host's phone:
const room = new HostRoom<Input, State, Event>({
  name: 'Ada',
  version: VERSION,
  parseInput,
  parseEvent,
})
room.onEvent = (player, event) => play(player.id, event) // each once, in order
room.send(player.id, { say: 'your turn' }) // to one player; room.broadcast(event) to all
room.stateFor = (player, state) => ({ ...state, hand: hands.get(player.id) ?? [] })

// On a player's phone:
const guest = await GuestRoom.join<Input, State, Event>(link, { /* … */ parseEvent })
guest.onEvent = (event) => show(event) // events from before this line come here too
guest.send({ play: 7 })
```

A player sends `MAX_EVENTS_PER_SECOND`, 30, at most; more are dropped. An event to a player who is away is not kept for them: when they rejoin, the state tells them where the game is. Without `stateFor`, everyone gets the same state, which every phone can read, whatever the game shows.

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

`startScanner` only reads codes. For a whole camera view, with what helps when a phone will not focus on a screen nearby, use `cameraView`:

```ts
import { cameraView, parseCameraChoice } from '@fionapreroll/p2p/qr'

const camera = cameraView({
  texts: {
    zoom: 'Zoom',
    brightness: 'Brightness',
    switchCamera: 'Switch camera',
    takePhoto: 'Take a photo instead',
    liveCamera: 'Back to the live camera',
  },
  onCodes: (texts) => texts.some(takeAnswer), // true takes one: the view stops
  camera: parseCameraChoice(JSON.parse(localStorage.camera ?? 'null')),
  onCameraChange: (choice) => {
    localStorage.camera = JSON.stringify(choice)
  },
  onPhoto: (state) => say(state === 'reading' ? 'Reading the photo…' : 'No code found'),
  onError: () => say('The camera did not start'),
})
panel.append(camera.viewfinder, camera.controls, camera.buttons)
```

- `viewfinder` holds the live picture, `video.camera`. Tapping it focuses and meters anew on that spot, and shows `.focus-ring` there, with the class `pulse` added anew for each tap. Give `.viewfinder` `position: relative`, and `.focus-ring` `position: absolute` and an animation on `.pulse`.
- `controls` holds sliders for zoom, so the phone can be held further away, where it focuses, and brightness, against a code that glares, each `label.slider`, only where the camera has them.
- `buttons` holds switching cameras (shown with two or more), a photo from the phone's camera app (`input.photo`), which focuses better than a live picture in the browser, and back to the live camera.
- `release()` lets go of the camera for another app, such as a native scanner, and `start()` opens it again; `stop()` ends the view. `onLive` tells when the picture opens, with its `Scanner`, and closes.

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

Every room also samples its connections once a second by itself, into a `NetLog` (`room.net`, `guest.net`, from `@fionapreroll/p2p/debug`): the ping, messages and kilobytes per second each way, the share of pings lost, and the longest wait for a message. `netNote` in the options takes a line for the game's log when a connection stalls and when it recovers. A wait counts as a stall (`NetSample.stalled`) when no message came for half a second (`STALL_MS`) and for twice as long as its messages were apart the second before: a player who sends no input, such as between games, sends only a ping a second, and the host's wait of a second for it is no stall.

```ts
import { connectionView, DebugLog, drawNetGraph, networkLines } from '@fionapreroll/p2p/debug'

drawNetGraph(canvas, room.net, performance.now(), 30) // the last half minute, a line a player
networkLines(room.net) // a summary of every connection and its samples as CSV, for a report

await room.details(id) // what the transport tells: see below
await guest.details()
```

**What a connection tells about itself:** `Connection.details()`, and the rooms' `details`, give a `ConnectionDetails`: what carries it (`webrtc`, `bluetooth`, `memory`), both ends of the path in use with address, port, protocol (`udp`, `tcp`), kind of candidate and network, every address offered, the transport's own round trip, what it could send, its packets and bytes, its encryption and its channels. WebRTC reads them from `getStats()` (`rtcDetails`), a packet connection from its transport's `details` and its own counts. Addresses are on the screen only: show them with `maskAddress` until the player asks, and put only `addressKind` into a report, as `detailsLines` does.

**A connection test:** `room.testConnections(ms)` (5 seconds by default, 10 at most) has the host and every player send each other as much data as their connections take, on `fast` beside the game, while the host pings each player ten times a second. It resolves with each player's `ConnectionTest`: the ping under load (min, median, max), the share of pings lost, and the kilobytes a second that got through each way, with the share of data that did not. Players take part by themselves, hear of it with `guest.onTestStart`, and get their own result with `guest.onTestResult`; `lastTest()` on both sides keeps the last. Over WebRTC, the data goes out as long as the channel's buffer has room, up to about 2 MB a second each way; over transports without a buffer to read, one message of 8 kB a tick.

**The connection view:** `connectionView({ texts, net, connections, test, lastTest })` builds all of it into one element for a game's dialog: the graph of the last minute, every connection's numbers and details, a button that shows the addresses, masked until then, and on the host's phone the button for the test, with the last test's results. It reads anew every second until `stop()`. The game brings the texts and the look.

**A log for debug reports:** `new DebugLog()` keeps the last 300 lines, each with the seconds since it began and an area, and masks what must not leave the phone as it goes in: codes, IP and MAC addresses, mDNS names and tokens (`redact`). `describeError` makes any error a short line, and `captureErrors()` logs those nobody caught.

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

For Bluetooth in Android apps made with Capacitor, [`@fionapreroll/p2p-nearby`](../p2p-nearby/README.md) does this with Google's Nearby Connections: advertising, finding games nearby, comparing a code, and each player's `Connection`. It is a package of its own, so that apps without Bluetooth get none of its native code, Google Play services or permissions.

## Entry points

| Import                      | What it has                                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@fionapreroll/p2p`         | `pack`, `unpack`, `fromSdp`, `toSdp`: codes. `createOffer`, `answerOffer`, `acceptAnswer`, `opened`, `onLost`: connections. `send`, `listen`, `decode`, `cleanName` and checks (`isObject`, `isNumber`, `isId`, `inRange`, `list`, `clamp`) for writing parsers. |
| `@fionapreroll/p2p/room`    | `HostRoom`, `GuestRoom`, `Seats`, `randomToken`, `ROOM_PROTOCOL`, `PING_LOST_MS`, `MAX_EVENTS_PER_SECOND`, the room's messages and their parsers.                                                                                                                |
| `@fionapreroll/p2p/debug`   | `NetLog`, `networkLines`, `detailsLines`, `testLines`, `drawNetGraph`, `pingQuality`, `worstLatest`, `connectionView`, `DebugLog`, `redact`, `describeError`. The graph and the view need a DOM.                                                                 |
| `@fionapreroll/p2p/qr`      | `qrSvg`, `qrElement`, `startScanner`, `cameraIds`, `decodePhoto`, `cameraView`, `parseCameraChoice`. Needs a DOM.                                                                                                                                                |
| `@fionapreroll/p2p/testing` | `linkPair()`: two connections in memory, with `conditions` to lose, delay and reorder messages by seed, `dropping` to lose them all, and `close()` and `fail()` to end them.                                                                                     |

## Security

Anyone can make a QR code, and any phone that pairs can send whatever it likes:

- Codes are read strictly by the ICE grammar: ICE characters for credentials, IP or mDNS addresses, at most six candidates. No field can smuggle a line into the SDP the browser reads.
- Messages longer than 16 KB are dropped unread; the rest is parsed as JSON and checked field by field, the game's part by the game's parsers. Write those with the checks of the main entry point: `isNumber` turns down Infinity, which JSON reads from `1e999`.
- Names lose control and formatting characters and are cut to 16 characters.
- A connection that opens but says no hello is closed after 15 seconds, so a phone cannot hold one without joining.
- A player sends at most 30 events a second; more are dropped before they reach the game.
- A player only ever sends input and events for themselves. Player tokens never leave the host's room, so nobody can take another player's place by guessing.
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

**Over a weak connection,** as on a hotspot at the edge of its range: `linkPair({ conditions: { loss: 0.3, delayMs: [20, 200], seed } })` loses 30 % of the `fast` messages each way, delays every message by 20 to 200 ms, so `fast` ones overtake each other, and keeps `control` lossless and in order, only late, as a reliable channel would. The same seed loses the same messages, so a failing test fails every time; fast-check can pick the seeds. Each channel's `conditions` can also be changed on its own during a test, and `lost` counts what it lost. With delays, advance the timers while joining: hello and welcome take their time too.

## Versions

The package follows [Semantic Versioning](https://semver.org/); changes are listed in `CHANGELOG.md`. `ROOM_PROTOCOL` is the version of the room's own messages, 3 since 0.6.0: phones with different ones do not play together, whatever the game's version.

## License

None: all rights reserved.
