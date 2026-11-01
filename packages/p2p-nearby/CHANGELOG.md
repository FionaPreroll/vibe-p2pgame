# Changelog

All notable changes to `@fionapreroll/p2p-nearby` are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `Nearby`: Bluetooth between phones in Android apps made with Capacitor, through Google's Nearby Connections. A host advertises and accepts players after comparing a code; players look for games nearby and ask one. Each connection is a `Connection` of `@fionapreroll/p2p`.
- `serviceId`, so that only phones of the same game find each other; `stateIntervalMs` for how often a host sends a Bluetooth player its state; `log` for what happens.
- `NearbyStartError`, saying why Nearby could not start, with Nearby's own status for a report, and `diagnostics()` for the phone, Google Play services, permissions and the native log.
- The native plugin, with its permissions, which `npx cap sync` adds to the app.
- `@fionapreroll/p2p-nearby/testing`: `NearbyAir` and `FakeNearby`, Nearby between fake phones, for tests.

[Unreleased]: https://github.com/FionaPreroll/vibe-p2pgame/commits/main/packages/p2p-nearby
