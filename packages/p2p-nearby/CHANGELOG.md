# Changelog

All notable changes to `@fionapreroll/p2p-nearby` are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-03

### Added

- `NearbyHosting` and `NearbySearch`: the Bluetooth flow without screens, for the host who lets players in after comparing the code, and for the player who looks for games and asks one. They stop looking before asking, close connections that did not make it, take a request back from the host's list when the player leaves, and tell a host's no (`refused`) from a join that failed.

### Changed

- Works with `@fionapreroll/p2p` 0.5 too.

## [0.1.2] - 2026-11-02

### Changed

- Works with `@fionapreroll/p2p` 0.4 as well as 0.3.
- Every version is also a file on a GitHub release, to install without logging in to GitHub's registry.

## [0.1.1] - 2026-11-01

### Changed

- The native plugin's decisions (permissions per Android version, how messages travel, the limits on what other phones send, the codes of failures, the native log) are in `NearbyRules`, plain Java with JUnit tests beside it. Nothing changes in how the plugin works.
- The 32 KB limit on a message is the library's own, well above what a game sends; a test checks that Nearby carries at least as much.
- The README links the package's page on GitHub Packages.

## [0.1.0] - 2026-11-01

### Added

- `Nearby`: Bluetooth between phones in Android apps made with Capacitor, through Google's Nearby Connections. A host advertises and accepts players after comparing a code; players look for games nearby and ask one. Each connection is a `Connection` of `@fionapreroll/p2p`.
- `serviceId`, so that only phones of the same game find each other; `stateIntervalMs` for how often a host sends a Bluetooth player its state; `log` for what happens.
- `NearbyStartError`, saying why Nearby could not start, with Nearby's own status for a report, and `diagnostics()` for the phone, Google Play services, permissions and the native log.
- The native plugin, with its permissions, which `npx cap sync` adds to the app.
- `@fionapreroll/p2p-nearby/testing`: `NearbyAir` and `FakeNearby`, Nearby between fake phones, for tests.

[Unreleased]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-nearby-v0.2.0...HEAD
[0.2.0]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-nearby-v0.1.2...p2p-nearby-v0.2.0
[0.1.2]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-nearby-v0.1.1...p2p-nearby-v0.1.2
[0.1.1]: https://github.com/FionaPreroll/vibe-p2pgame/compare/p2p-nearby-v0.1.0...p2p-nearby-v0.1.1
[0.1.0]: https://github.com/FionaPreroll/vibe-p2pgame/tree/p2p-nearby-v0.1.0/packages/p2p-nearby
