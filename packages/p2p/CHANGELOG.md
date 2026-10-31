# Changelog

All notable changes to `@fionapreroll/p2p` are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-v0.1.0...HEAD
[0.1.0]: https://github.com/FionaPreroll/vibe-p2pgame/tree/p2p-v0.1.0/packages/p2p
