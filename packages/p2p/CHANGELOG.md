# Changelog

All notable changes to `@fionapreroll/p2p` are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.6.1] - 2026-11-05

### Fixed

- `NetLog` no longer takes the second between pings of a player who sends no input, such as between games, for a stall: a wait counts as one when it is at least `STALL_MS` and twice as long as the connection's messages were apart the second before (for its first second, that second itself). Samples tell it in `stalled`, which `summary()`, the report, the graph and `netNote` go by; games should use it instead of comparing `gap` with `STALL_MS`.

## [0.6.0] - 2026-11-03

### Added

- `@fionapreroll/p2p/testing`: `linkPair({ conditions })` and each channel's `conditions` make a connection in memory weak, by seed: `fast` loses a share of messages, and delays and reorders them; `control` is only delayed, and keeps its order. `lost` counts what a channel lost; `seededRandom` is the generator it uses.
- `@fionapreroll/p2p/debug`, for what helps find out why a game misbehaves on a phone: `NetLog`, the connections' samples, once a second, with their summary and CSV for a report (`networkLines`); `drawNetGraph`, `pingQuality` and `worstLatest`, the graph of the pings; `connectionView`, a ready view of every connection's numbers and details, with addresses masked until the player shows them, and the connection test; `DebugLog`, `redact` and `describeError`, a log that masks codes, addresses and tokens; `detailsLines` and `testLines` for a report.
- Every room samples its connections by itself: `HostRoom.net` and `GuestRoom.net`, with `netNote` in the options for the log's lines about stalls.
- `Connection.details()`, `HostRoom.details(id)` and `GuestRoom.details()`: what carries a connection, both ends with address, port, protocol and kind, every address offered, the transport's round trip, packets, bytes, encryption and channels. WebRTC reads them from `getStats()` (`rtcDetails`), packet connections from `PacketTransport.details` and their own counts. `addressKind` and `maskAddress` tell and hide what an address is.
- `HostRoom.testConnections(ms)`: a connection test with every player at once, which measures the ping under load and the kilobytes a second each way. Players take part by themselves (`GuestRoom.onTestStart`, `onTestResult`); `lastTest()` keeps the last on both sides.

### Fixed

- A player's room no longer goes back to an older state that arrived after a newer one, as `fast` may reorder: the host numbers its states, and `GuestRoom` skips those older than the one it has. Found by the new tests over weak connections.
- The host knows each player's ping in games without input, such as games of turns: the player's pings carry it too, not only its input.

### Changed

- `ROOM_PROTOCOL` is 3: phones with 0.5 and earlier do not play together, as the connection test brings messages of its own, and pings carry the player's ping.
- `TrafficCounter.watch` takes the channels as a list, and calls back with every message.

## [0.5.0] - 2026-11-02

### Added

- `cameraView` in `@fionapreroll/p2p/qr`: a ready camera for reading the other phone's code, with what helps when a code will not come sharp. Tapping the picture focuses there and shows a ring; zoom and brightness sliders where the camera has them; switching between the phone's cameras; a photo from the phone's own camera app; and the camera, its zoom and brightness to remember, checked by `parseCameraChoice` when read back. The game brings the texts and the look.

## [0.4.0] - 2026-11-02

### Added

- Events: `HostRoom.send(id, event)`, `HostRoom.broadcast(event)` and `GuestRoom.send(event)` carry a game's events, such as moves, over the reliable channel, each once and in order; `onEvent` on both sides takes them, checked by the new `parseEvent` option. A player sends at most `MAX_EVENTS_PER_SECOND`, 30. Events the host sends as a player joins wait for the player's first `onEvent`.
- `HostRoom.stateFor`: each player gets their own part of the state, such as their cards.
- Every version is also a file on a GitHub release, to install without logging in to GitHub's registry.

### Changed

- `ROOM_PROTOCOL` is 2: phones with 0.3 and 0.4 do not play together.
- `HostRoom`, `GuestRoom` and their options take the game's event type as a third type parameter, `never` by default; games without events need no change.

## [0.3.1] - 2026-11-01

### Changed

- The README links the package's page on GitHub Packages, and points to `@fionapreroll/p2p-nearby` for Bluetooth in Android apps.
- The WebRTC connections of `createOffer` and `answerOffer` are tested on their own: the settings of both channels, when a connection counts as open or closed, and making the code after 3 seconds when finding the phone's addresses never ends. Nothing changes in how they work.

## [0.3.0] - 2026-11-01

### Added

- `GuestRoom.traffic()` and `HostRoom.traffic(id)`: messages and characters sent and received on a connection, and on a player's side the pings sent, answered and lost. A ping unanswered for `PING_LOST_MS`, 3 seconds, counts as lost.
- `send` returns the length of the message it sent, or 0 on a closed channel.

### Changed

- A player's room only takes answers to pings it sent and still waits for, each once: a host can no longer make up a round trip.

## [0.2.0] - 2026-10-31

### Added

- `Connection`: rooms work on any connection, not only WebRTC. `createOffer` and `answerOffer` make one over WebRTC, as before.
- `packetConnection` turns any transport that carries text messages, such as Bluetooth, into a `Connection`. It checks what the transport hands over: only text no longer than `MAX_MESSAGE_LENGTH`, on one of the two channels, while open.
- `minStateIntervalMs` on a connection: a host sends a slow connection fewer states, and the others as many as before.
- `helloTimeoutMs` for `HostRoom`: a connection that is open but says no hello is closed after 15 seconds.

### Changed

- `HostRoom.attach` and `GuestRoom.join` take a `Connection`. `opened` and `onLost` work on any `Connection`.
- `HostRoom.attach`'s `joined` also rejects with `closed`, when the connection closes before the player's hello, and with `timeout`, instead of waiting for ever.
- `linkPair` from `@fionapreroll/p2p/testing` gives `FakeConnection`s: `connection.state`, `connection.close()` and `connection.fail()` replace the former fake `pc`.

## [0.1.1] - 2026-10-31

### Fixed

- `cleanName` no longer leaves two spaces in a row where a control character stood between two spaces, so a cleaned name stays the same when cleaned again.

## [0.1.0] - 2026-10-31

### Added

- Short codes for WebRTC offers and answers, read strictly by the ICE grammar (`pack`, `unpack`).
- Connections with a reliable and an unordered data channel, without STUN or TURN servers (`createOffer`, `answerOffer`, `acceptAnswer`).
- Rooms for a host and players: versions, a limit on players, rejoining by token, silence detection, pings, and the game's input and state, checked by the game's parsers (`HostRoom`, `GuestRoom`).
- QR codes as SVG, and scanning from the camera or from photos, with tap-to-focus, zoom, brightness and camera switching (`@fionapreroll/p2p/qr`).
- Checks for writing parsers, and name cleaning.
- Connections in memory for tests (`@fionapreroll/p2p/testing`).

[Unreleased]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.6.0...HEAD
[0.6.0]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.5.0...p2p-v0.6.0
[0.5.0]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.4.0...p2p-v0.5.0
[0.4.0]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.3.1...p2p-v0.4.0
[0.3.1]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.3.0...p2p-v0.3.1
[0.3.0]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.2.0...p2p-v0.3.0
[0.2.0]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.1.1...p2p-v0.2.0
[0.1.1]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.1.0...p2p-v0.1.1
[0.1.0]: https://github.com/FionaPreroll/vibe-p2pgame/tree/p2p-v0.1.0/packages/p2p
