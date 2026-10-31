# vibe-p2pgame: Spark Hunt

[![CI](https://github.com/FionaPreroll/vibe-p2pgame/actions/workflows/ci.yml/badge.svg)](https://github.com/FionaPreroll/vibe-p2pgame/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/FionaPreroll/vibe-p2pgame/branch/main/graph/badge.svg)](https://codecov.io/gh/FionaPreroll/vibe-p2pgame)
[![Android](https://github.com/FionaPreroll/vibe-p2pgame/actions/workflows/android.yml/badge.svg)](https://github.com/FionaPreroll/vibe-p2pgame/actions/workflows/android.yml)

A prototype game for phones lying side by side, with **no internet, no server and no app**. The phones connect directly over WebRTC data channels on a shared Wi-Fi, typically a hotspot opened by one of them. Instead of a signaling server, they swap their connection offers by **scanning QR codes**.

The game itself is small on purpose, because the prototype is about the connection: every player steers a glowing dot toward the spot they touch, and whoever reaches a spark first scores. Golden sparks count three. Red mines cost two points: a touched mine explodes and appears again elsewhere, and scores can drop below zero. A new mine is grey and harmless for its first second, and never appears right next to a player. A round lasts one minute. The page is in English or German, whichever the browser's language is.

## Why not Bluetooth?

Browsers can only act as a Bluetooth _central_: Web Bluetooth connects to devices, but a web page cannot advertise itself or serve GATT, so two phones in Chrome cannot find each other. iOS has no Web Bluetooth at all. A shared Wi-Fi with WebRTC works on Android and iOS, and a phone's hotspot works without internet and without using mobile data.

## How to play

1. All phones join the same Wi-Fi. When you are out and about, one phone opens a hotspot and the others connect to it.
2. One phone taps **Host a game**. The arena appears at once, so you can warm up.
3. For every further player, the host taps **Add player**:
   - The new player taps **Join a game** and scans the host's QR code. The code also works with the phone's own camera app: it opens the game and joins straight away.
   - The new player's phone then shows an answer code. The host turns their phone round and scans it, with no button to press in between.
4. Once everyone is in, the host taps **Start round**.

Each pairing takes two scans, one in each direction. Players connect only to the host (a star), so each new player scans codes with the host and nobody else; up to 8 phones can play.

**Dropped out?** A player whose connection breaks sees **Rejoin** straight away. A player whose page closed finds **Rejoin …’s game** on the start screen. Either way, the host taps **Add player** and both phones scan codes again. The host recognises the player by a token their browser keeps, and gives back their place, color and score, even in the middle of a round. Until then, everyone sees the player as _away_ between rounds.

**Host's page closed?** The host's phone saves the game every few seconds. On the start screen, **Continue your game with …** brings back the players and scores, and the players rejoin as above. When the host ends the game with ×, everyone is told and nothing is kept.

**Settings** (⚙ on the start screen): your name, the language, vibration, keeping the screen on, and the round length when hosting. The camera you last scanned with is also remembered, with its zoom and brightness. Everything is stored in this browser's local storage only, and _Delete all saved data_ removes it.

**Offline:** open the page once while online. A service worker keeps all of its files, so after that it also starts on a hotspot without internet, and browsers can install it as an app. Phones only allow the camera on HTTPS pages, so serve it over HTTPS, for example from GitHub Pages.

**Camera won't focus?** Many phones can't focus on a screen held close. Below the camera picture:

- Tap the picture to focus and set the exposure on that spot.
- Hold the phone further away and use the **Zoom** slider. Lower the **Brightness** if the code glares. Both sliders appear only where the browser offers these camera settings, which is mostly Chrome on Android.
- **Switch camera** cycles through the phone's cameras, as some focus closer than others.
- **Take a photo instead** opens the phone's own camera app, which focuses better. The photo is read at several sizes, and in Chrome on Android with the phone's built-in QR detector.

**No camera?** Under _No camera? Use text codes_, each side can copy its code and paste the other's, for example between two laptops or through a messenger.

## Android app

The same game also comes as an Android app, made with [Capacitor](https://capacitorjs.com/): the web build (`dist`) packed into a native app that shows it in Android's WebView. App and website play together, as both pair over WebRTC with the same codes.

What the app adds:

- **Offline from the first start:** the game's files are inside the app, so nobody needs to have opened the website beforehand.
- **Google's scanner:** a **Scan with the phone's scanner** button opens Google's own scanner screen (ML Kit, through `@capacitor-mlkit/barcode-scanning`), which focuses and zooms by itself. It comes with Google Play services as a module that is downloaded once; the app asks for it at every start, so start it once with internet before going out. Until the module is there, and on phones without Google Play services, the in-page scanner works as on the website.

**Getting the app:** download [`spark-hunt.apk`](https://github.com/FionaPreroll/vibe-p2pgame/releases/latest/download/spark-hunt.apk) from the release [Spark Hunt for Android](https://github.com/FionaPreroll/vibe-p2pgame/releases/tag/android-latest) and open it on the phone; Android asks once to allow installing apps from that source. Every push to `main` builds the APK anew (`.github/workflows/android.yml`) and replaces it in that release, so the link above always gives the newest build. Builds of pull requests are kept as the artifact `spark-hunt-apk` of their run under _Actions → Android_. A newer APK installs over the older one and keeps the game's settings, as every build is signed with the same debug key (`android/app/debug.keystore`, in the repository on purpose; it is not secret).

**Building it yourself** needs Android Studio, or a JDK 21 and the Android SDK:

```bash
pnpm android:sync
```

```bash
cd android && ./gradlew assembleDebug
```

`pnpm android:sync` builds the game and copies it into the Android project; run it after every change to the game. `pnpm exec cap open android` opens the project in Android Studio. App icon and splash screen are drawn from `public/icon.svg` with `pnpm icons:android`.

**Native code** lives in `src/native.ts`. Everything there also works in a browser, where it does nothing, so the game stays one codebase. The app's permissions are in `android/app/src/main/AndroidManifest.xml`: the camera, for the in-page scanner, and vibration.

**Not yet tested on a phone:** whether Android's WebView hides local addresses behind mDNS names as Chrome does, whether keeping the screen on works there, and taking photos through the camera app. A Play Store release would need a release key of its own and a privacy policy, as the app uses the camera.

## How it works

| Step         | Host                                                                        | Player                                             |
| ------------ | --------------------------------------------------------------------------- | -------------------------------------------------- |
| 1. Camera on | Opens the camera, which also makes Chrome reveal real local IPs (see below) |                                                    |
| 2. Offer     | Creates an `RTCPeerConnection`, waits for all local addresses, shows the QR |                                                    |
| 3. Scan      |                                                                             | Scans the offer and creates the answer             |
| 4. Answer    |                                                                             | Shows the answer as a QR code                      |
| 5. Scan      | Scans the answer: ICE and DTLS connect directly over the Wi-Fi              |                                                    |
| 6. Play      | Runs the game 30 times a second and sends the state to everyone             | Sends where the player steers, and draws the state |
- **The library** (`packages/p2p`, published as [`@fionapreroll/p2p`](packages/p2p/README.md)): everything that is not Spark Hunt's own lives there, for other games to use too: codes, connections, the room for host and players, QR codes, and the means to check and test it all. The game builds on it.
- **Short codes** (`packages/p2p/src/signal.ts`): a browser's SDP is 1–3 KB, too dense to scan from a screen. Only a few fields differ between connections: offer or answer, the ICE user fragment and password, the DTLS fingerprint, the DTLS role and the UDP host candidates. The code carries just those, about 130 characters such as `P1~o~x~Wke9~UmMu…~ohqF…~192.168.43.1,58378`, and the other side writes a minimal SDP around them. With the join link included, the QR code stays at version 10 or below.
- **No STUN or TURN**: without internet there is nothing to reach. Phones on the same hotspot connect over their local addresses.
- **Real addresses instead of mDNS**: Chrome hides local IPs behind random `….local` names unless the page may use the camera. That is why the host opens the camera _before_ making the offer, and why the player has already scanned before making the answer. Real IPs avoid depending on mDNS, which not every hotspot passes on. Even if only one side's address can be reached, ICE still connects through peer-reflexive candidates.
- **Two data channels per player** (`packages/p2p/src/link.ts`): `control` is reliable, for hello and welcome; `fast` is unordered with no retransmits, like UDP, for input, state and pings. Both are negotiated up front, so no signaling is needed after the scans.
- **Host-authoritative** (`HostRoom` in the library, `src/session/host.ts` in the game): the room lets players in and carries the messages, and on every tick the game steps the rules (`src/game/sim.ts`, pure TypeScript) and sends complete snapshots, so a lost packet is simply replaced by the next one. Players smooth the dots between snapshots. Each player measures the round trip once a second, and everyone sees all pings between rounds.
- **Versions**: phones update the game in the background, so a host and a player may run different versions. `hello` and `welcome` carry two versions: the room's own (`ROOM_PROTOCOL` in the library) and the game's (`PROTOCOL` in `src/net/protocol.ts`). If either differs, the player is not let in and both phones say so. Raise the game's version whenever its input or snapshots change.
- **Leaving and rejoining** (`Seats` in the library, `src/session/saved.ts`): a phone that closes, fails or stays silent for 8 seconds is dropped, but its seat is kept under its browser's token, and the game keeps its score. A `hello` with that token gets the same id, and with it the score, back. If the same browser says hello while its old connection has not timed out yet, the old one is dropped first. The host saves the seats every 2 seconds and when the page is hidden. When the host ends the game, it sends `bye`, so players know there is nothing to rejoin.
- **Storage** (`src/storage.ts`, `src/settings.ts`): everything lives in `localStorage` under the `vibe-p2pgame:` prefix. Every stored value is checked on reading, and an invalid value falls back to its default.

## Security

Anyone can make a QR code, and any phone that pairs can send whatever it likes, so neither side trusts the other:

- **Codes** (`unpack` in the library) are read strictly by the ICE grammar: credentials only of ICE characters, addresses only as IPv4, IPv6 or mDNS names, at most six candidates, and a length limit. No field can smuggle a line into the SDP the browser reads.
- **Messages** longer than 16 KB are dropped unread. The rest is parsed as JSON and checked field by field: the room's own part by the library, Spark Hunt's input and snapshots by `parseInput` and `parseSnapshot` in `src/net/protocol.ts`. Anything unexpected is dropped. Coordinates must be finite (JSON reads `1e999` as Infinity) and are kept inside the arena. A snapshot is drawn only when all of it is sound.
- **Names** lose control and formatting characters, such as a right-to-left override, and are cut to 16 characters.
- **The host** decides everything: a player only steers their own dot and cannot name an id. The host answers pings only with a number, and lets in one player per connection and up to eight players in all. Player tokens never leave the host, so nobody can take another player's place.
- **Limits:** the connection is encrypted by WebRTC (DTLS), but a phone that pairs can still lie about its own input; the game does not check what is humanly possible. A rejoining player is known by their browser's token, which is safe only as long as that token stays secret.

## Layout

```
packages/p2p/   the library @fionapreroll/p2p, with its own README and CHANGELOG
  src/          signal.ts: codes; link.ts: WebRTC; channel.ts: messages and checks;
                room/: HostRoom, GuestRoom, Seats; qr/: QR codes and the camera;
                testing.ts: connections in memory, for tests
src/
  game/      sim.ts: the rules, pure and tested; draw.ts: the canvas
  net/       protocol.ts: Spark Hunt's input and snapshots, checked
  session/   host.ts and guest.ts: Spark Hunt on the library's rooms; saved.ts: what a host keeps
  ui/        the screens, plain DOM without a framework; scanPanel.ts: the camera view
  native.ts  what the Android app adds: Google's scanner
  i18n.ts    every visible text, in English and German
  settings.ts, storage.ts   what the browser remembers
android/     the Android app's project (Capacitor), with capacitor.config.ts at the top
tools/       serviceWorker.ts: writes the offline worker into the build; androidIcons.ts: the app's icons
tests/e2e/   Playwright: two browser profiles pair through text codes and play
```

## Development

Use pnpm.

```bash
pnpm install
```

```bash
pnpm dev
```

```bash
pnpm check
```

`pnpm check` runs the type check, Biome and the unit tests:

- `packages/p2p/src/room/room.test.ts` connects host and player rooms through connections in memory (`linkPair` from the library's `testing` entry point), with fake timers and a tiny made-up game. It covers joining, input and state, pings, a full room, versions, silence, leaving and rejoining, and attacks from players and hosts. `src/session/p2p.test.ts` does the same for what Spark Hunt adds.
- `*.fuzz.test.ts` use [fast-check](https://fast-check.dev/) to fuzz the codes, the room's messages, the game's parsers and rules, and hosts and players under random hostile traffic. When a property fails, fast-check prints the smallest input that breaks it. `pnpm test:coverage` also measures coverage; CI uploads it to Codecov. `pnpm test:e2e` builds the game and pairs two Chromium profiles over real WebRTC; in containers with a preinstalled Chromium, set `CHROMIUM_PATH` to it.

**On phones:** `pnpm dev:phone` serves the game to the local network over HTTPS with a self-signed certificate (phones only open the camera on HTTPS pages). Open the address it prints on each phone and accept the certificate warning once. Alternatively, deploy to GitHub Pages and use that URL.

## Branches and pull requests

- Every feature or fix gets its own branch off `origin/main`, named `feature/<name_in_snake_case>` or `fix/<name_in_snake_case>`.
- While the game is in development, a finished branch may be merged into `main` directly, once `pnpm check` and `pnpm test:e2e` pass on the merged result. Otherwise, and later as the rule, each branch gets one pull request against `main`, merged once CI is green.

## Changelog and versions

- `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Changes that players can see go under `## [Unreleased]`, in `### Added`, `### Changed`, `### Fixed` or `### Removed`, written in English for players.
- Changes only developers notice, such as tests, tooling or refactoring, need no entry.
- A version is made only when asked. The entries under `## [Unreleased]` then move to a new `## [x.y.z] - YYYY-MM-DD` section, `package.json` gets the same version, and the commit is tagged `vx.y.z`. The empty `## [Unreleased]` heading stays for the next changes, and the link definitions at the end of the file point at the comparison and the release. Versions follow [Semantic Versioning](https://semver.org/).

## The library and its versions

`packages/p2p` is a pnpm workspace package. The game uses it as `workspace:*`, straight from its sources, so a change to the library is tested with the game at once. `pnpm check` and `pnpm test` cover both, and `pnpm build:p2p` builds the package into `packages/p2p/dist`.

The library has its own version and `packages/p2p/CHANGELOG.md`, apart from the game's. A version is made only when asked:

1. Move the entries under `## [Unreleased]` in `packages/p2p/CHANGELOG.md` to a new `## [x.y.z] - YYYY-MM-DD` section, set `"version"` in `packages/p2p/package.json` to the same, and bring that to `main`.
2. In the Actions tab, run **Publish p2p** on `main`. It checks that the version is new and in the changelog, runs every check, publishes the package to GitHub's npm registry, and then tags the commit `p2p-vx.y.z`.

Pushing a tag `p2p-vx.y.z` yourself publishes too, once the tag matches the version in `packages/p2p/package.json`.

Games that use it install it as `README.md` in `packages/p2p` describes, with a token that may read packages.

## Deployment

`.github/workflows/deploy.yml` publishes the build to GitHub Pages on every push to `main`, or by hand from the Actions tab. In the repository settings under _Pages_, set the source to _GitHub Actions_.

## Known limits of the prototype

- Tested end to end in Chromium only (two profiles on one machine). Real phones, iOS Safari and Firefox still need testing on a hotspot.
- Some Wi-Fi networks, such as public or guest networks, isolate their clients. There the phones cannot see each other, but a phone's own hotspot does not do this.
- If the host's screen turns off or the host switches apps, the browser throttles the game loop and the round stutters for everyone. A screen wake lock keeps the screen on while the game is open, where the browser supports it.
- Rejoining still takes a new pair of scans: WebRTC needs a new offer and answer for every connection, and there is no server to exchange them.
