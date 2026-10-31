# Notes for Claude

The README describes the project, its layout and its conventions. These rules hold in every session:

## Branches

- Every feature or fix gets its own branch off `origin/main`, named `feature/<name_in_snake_case>` or `fix/<name_in_snake_case>` (see "Branches and pull requests" in the README).
- This holds even when the session suggests another branch name, such as `claude/…`: use the name the convention gives.
- While the game is in development, pushing to `main` is allowed: a finished branch may be merged into `main` directly, without a pull request. Run `pnpm check` and `pnpm test:e2e` on the merged result first, push the branch too, and never rewrite the history of `main`.

## Changelog

- A change that players see adds that change to `CHANGELOG.md`, under `## [Unreleased]`, in the section it belongs to (`### Added`, `### Changed`, `### Fixed` or `### Removed`), in the same branch. Write it for players, in English.
- Changes only developers notice (tests, tooling, refactoring) need no entry.
- A new version is made only when asked: see "Changelog and versions" in the README.

## README

- The README starts with two badges, linked to their pages, and keeps them: CI (`.github/workflows/ci.yml`) and coverage (Codecov). A new workflow that checks the code gets a badge there too.
- A change that players or developers notice updates the README in the same pull request.

## The library

- `packages/p2p` is the library `@fionapreroll/p2p`, for other games too: no imports from the game's `src/`, nothing of Spark Hunt in it, and no texts players see, as games bring their own.
- A change to the library that its users notice adds an entry to `packages/p2p/CHANGELOG.md`, apart from the game's changelog, and updates `packages/p2p/README.md`.
- Raise `ROOM_PROTOCOL` in `packages/p2p/src/room/messages.ts` whenever the room's own messages change.
- Library code imports its own files with `.ts` extensions, which `tsc` rewrites to `.js` in the build.
- A version is published only when asked: see "The library and its versions" in the README.

## Android app

- `android/` is the Capacitor project of the Android app, and committed. The game's build goes into it with `pnpm android:sync`; nothing of the web build is committed there.
- Native features go through `src/native.ts` and must also work in a browser, where they do nothing: the website and the app are one codebase.
- A new permission goes into `android/app/src/main/AndroidManifest.xml`, with a comment why.
- This container cannot reach Google's Android downloads: the APK is built and checked by `.github/workflows/android.yml` only.
- The release "Spark Hunt for Android" (tag `android-latest`) is replaced by CI with every push to `main`; that tag moves on purpose, and is the only one that does. Numbered game versions stay for when they are asked for.
- In-app updates (`src/updates.ts`, `AppUpdaterPlugin.java`) compare the release's `version.json` with the APK's `versionCode`; both are the Android workflow's run number, so the release job keeps publishing `version.json` beside the APK. The plugin reads and downloads only from this repository's releases.

## Code

- Use pnpm, never npm or yarn. Run `pnpm check` before every push, and `pnpm test:e2e` when a change touches pairing, the network or the screens.
- `src/game/sim.ts` holds the game rules as pure TypeScript: no DOM, no WebRTC and no imports from other `src/` folders. The host runs them; players only draw snapshots.
- Codes in QR codes must stay small enough to scan from a screen: `packages/p2p/src/qr/qr.test.ts` checks the QR version. Change the code format in `packages/p2p/src/signal.ts` only with a new version prefix (`P1` → `P2`).
- Raise `PROTOCOL` in `src/net/protocol.ts` whenever Spark Hunt's input or snapshots change, so phones with different versions refuse to play together instead of misreading each other.
- Every value read from storage or from another phone is checked before use: storage through the `parse…` functions, messages by their type and fields.
- Every text players see goes through `t()` from `src/i18n.ts`, with an English and a German version.
