# Changelog

All notable changes to `@fionapreroll/p2p` are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.3.0...HEAD
[0.3.0]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.2.0...p2p-v0.3.0
[0.2.0]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.1.1...p2p-v0.2.0
[0.1.1]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.1.0...p2p-v0.1.1
[0.1.0]: https://github.com/FionaPreroll/vibe-p2pgame/tree/p2p-v0.1.0/packages/p2p
