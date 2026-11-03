# Changelog

All notable changes to `@fionapreroll/app-updates` are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Updates for Android apps made with Capacitor, from the app's own GitHub release, as Spark Hunt had them: looking for a newer build, downloading it with pause and resume, also after the app was closed, and handing it to Android's installer as a session that reports back.
- The dialogs, in the app's own texts: the question at the first start, and the offer, with the download's size, a warning on mobile data, progress, pausing, the right to install apps and the installer's answers.
- The releases to read from are named in the app's Capacitor config, so the page cannot name another place.
- `FakeUpdater` in `@fionapreroll/app-updates/testing`, for tests without a phone.
