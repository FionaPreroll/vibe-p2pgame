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

## Code

- Use pnpm, never npm or yarn. Run `pnpm check` before every push, and `pnpm test:e2e` when a change touches pairing, the network or the screens.
- `src/game/sim.ts` holds the game rules as pure TypeScript: no DOM, no WebRTC and no imports from other `src/` folders. The host runs them; players only draw snapshots.
- Codes in QR codes must stay small enough to scan from a screen: `src/qr/qr.test.ts` checks the QR version. Change the code format in `src/net/signal.ts` only with a new version prefix (`P1` → `P2`).
- Every value read from storage or from another phone is checked before use: storage through the `parse…` functions, messages by their type and fields.
- Every text players see goes through `t()` from `src/i18n.ts`, with an English and a German version.
