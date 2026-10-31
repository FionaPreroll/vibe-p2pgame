# vibe-p2pgame: Spark Hunt

[![CI](https://github.com/FionaPreroll/vibe-p2pgame/actions/workflows/ci.yml/badge.svg)](https://github.com/FionaPreroll/vibe-p2pgame/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/FionaPreroll/vibe-p2pgame/branch/main/graph/badge.svg)](https://codecov.io/gh/FionaPreroll/vibe-p2pgame)
[![Android](https://github.com/FionaPreroll/vibe-p2pgame/actions/workflows/android.yml/badge.svg)](https://github.com/FionaPreroll/vibe-p2pgame/actions/workflows/android.yml)

A game for phones lying side by side, with **no internet and no server**. The phones connect directly to each other: over a shared Wi-Fi, typically a hotspot opened by one of them, after swapping their connection offers by **scanning QR codes**; or, in the Android app, over **Bluetooth**.

- **Play in the browser:** <https://fionapreroll.github.io/vibe-p2pgame/>
- **Android app:** [`spark-hunt.apk`](https://github.com/FionaPreroll/vibe-p2pgame/releases/latest/download/spark-hunt.apk), always the newest build (see [Android app](#android-app))

The networking is a library of its own, [`@fionapreroll/p2p`](packages/p2p/README.md), for other games to use too.

## The game

The game is small on purpose, as the project is about the connection. Every player steers a glowing dot toward the spot they touch, and whoever reaches a spark first scores; golden sparks count three. Red mines cost two points: a touched mine explodes and appears again elsewhere, and scores can drop below zero. A new mine is grey and harmless for its first second, and never appears right next to a player. A round lasts a minute (30 to 120 seconds in the settings), and up to eight phones play together. The game is in English and German, after the browser's language or as chosen in the settings.

## Playing

1. **Host:** one phone taps **Host a game**. The arena appears at once, so you can warm up.
2. **Add players:** for every further player, the host taps **Add player**, and the new player taps **Join a game**. In the Android app, both are asked how to connect (below); in a browser, it is always the QR code.
3. **Play:** once everyone is in, the host taps **Start round**.

Players connect to the host only, a star: each new player pairs with the host and nobody else. One game can mix both ways of connecting.

### By QR code, over Wi-Fi

All phones join the same Wi-Fi; out and about, one phone opens a hotspot and the others join it, without internet and without using mobile data. Works with every phone and browser.

- The new player scans the host's QR code. The code also works with the phone's own camera app, which opens the game and joins straight away.
- The new player's phone then shows an answer code. The host turns their phone round and scans it, with no button to press in between.

**Camera won't focus?** Many phones cannot focus on a screen held close. Below the camera picture:

- Tap the picture to focus and set the exposure on that spot.
- Hold the phone further away and use the **Zoom** slider; lower the **Brightness** if the code glares. Both sliders appear only where the browser offers these settings, mostly Chrome on Android.
- **Switch camera** goes through the phone's cameras, as some focus closer than others.
- **Take a photo instead** opens the phone's own camera app, which focuses better.
- In the Android app, **Scan with the phone's scanner** opens Google's own scanner, which focuses and zooms by itself.

**No camera?** Under _No camera? Use text codes_, each side can copy its code and paste the other's, for example between two laptops or through a messenger.

### By Bluetooth, in the Android app

Both phones need the Android app, but no Wi-Fi at all. The host's phone advertises its game; the new player picks it from the games nearby. Both phones then show the same four-digit code, and the host accepts the player only after comparing it, so nobody else nearby slips in. The first time, the app asks for the permission for nearby devices (on older Android versions, Location).

### Dropping out and coming back

- **A player drops out:** their phone offers **Rejoin** at once, or **Rejoin …’s game** on the start screen if the app or page was closed. The host recognises the player and gives back their place, color and score, even in the middle of a round. By QR code, both phones scan codes again; by Bluetooth, the player just picks the game again. Until then, everyone sees the player as _away_ between rounds.
- **The host's page or app closes:** the host's phone saves the game every few seconds. On the start screen, **Continue your game with …** brings back the players and scores, and the players rejoin as above.
- **The host ends the game** with ×: everyone is told, and nothing is kept.

### Settings

⚙ on the start screen: your name, the language, vibration, keeping the screen on, and the round length when hosting. The camera you last scanned with is remembered, with its zoom and brightness, and in the app, whether to look for updates. Everything is stored on the phone only, and _Delete all saved data_ removes it.

## Getting the game

### In the browser

Open <https://fionapreroll.github.io/vibe-p2pgame/> once while online. A service worker keeps all of its files, so afterwards it also starts on a hotspot without internet, and browsers can install it as an app. Phones open the camera only on HTTPS pages, as GitHub Pages serves it.

### Android app

The same game, packed into an Android app with [Capacitor](https://capacitorjs.com/). App and website play together. The app adds:

- **Offline from the first start:** its files are inside the app.
- **Bluetooth** between app phones, besides the QR code.
- **Google's scanner**, which focuses and zooms by itself. It is a module of Google Play services, downloaded once: start the app once with internet before going out. Until then, and on phones without Google Play services, the in-page scanner works as on the website.
- **Updates in the app**, if you agree at its first start or switch them on in the settings: at every start, the app looks for a newer build and offers to install it. Android asks before installing; the first time, it wants you to allow the app to install apps, and the app opens that setting.

**Installing:** download [`spark-hunt.apk`](https://github.com/FionaPreroll/vibe-p2pgame/releases/latest/download/spark-hunt.apk) from the release [Spark Hunt for Android](https://github.com/FionaPreroll/vibe-p2pgame/releases/tag/android-latest) and open it on the phone; Android asks once to allow installing apps from that source. A newer APK installs over the older one and keeps the game's settings.

These are debug builds, for playing with friends, not for the Play Store: a Play Store release would need a release key of its own and a privacy policy, as the app uses the camera and Bluetooth.

## How it works

### The library and the game

Everything that is not Spark Hunt's own lives in the library [`@fionapreroll/p2p`](packages/p2p/README.md) (`packages/p2p`): the short codes, WebRTC connections, connections over any other transport, the rooms for host and players, QR codes and the camera, and the means to check and test it all. The game builds on it, in `src/`.

The host decides everything. Its room (`HostRoom`) lets players in and carries the messages; on every tick, 30 times a second, the game steps its rules (`src/game/sim.ts`, pure TypeScript) and sends every player a complete snapshot, so a lost packet is simply replaced by the next one. Players send only where they steer, and smooth the dots between snapshots. Each player measures the round trip once a second, and everyone sees all pings between rounds.

Rooms work on any `Connection`, whatever carries it: WebRTC, Bluetooth, or memory in tests. Each connection has two channels: `control`, reliable and ordered, for hello and welcome; and `fast`, where only the newest message counts, for input, snapshots and pings.

### QR codes and WebRTC

| Step         | Host                                                                        | Player                                             |
| ------------ | --------------------------------------------------------------------------- | -------------------------------------------------- |
| 1. Camera on | Opens the camera, which also makes Chrome reveal real local IPs (see below) |                                                    |
| 2. Offer     | Creates an `RTCPeerConnection`, waits for all local addresses, shows the QR |                                                    |
| 3. Scan      |                                                                             | Scans the offer and creates the answer             |
| 4. Answer    |                                                                             | Shows the answer as a QR code                      |
| 5. Scan      | Scans the answer: ICE and DTLS connect directly over the Wi-Fi              |                                                    |
| 6. Play      | Runs the game and sends the state to everyone                               | Sends where the player steers, and draws the state |

- **Short codes** (`packages/p2p/src/signal.ts`): a browser's SDP is 1–3 KB, too dense to scan from a screen. Only a few fields differ between connections: offer or answer, the ICE user fragment and password, the DTLS fingerprint, the DTLS role and the UDP host candidates. The code carries just those, about 130 characters such as `P1~o~x~Wke9~UmMu…~ohqF…~192.168.43.1,58378`, and the other side writes a minimal SDP around them. With the join link, the QR code stays at version 10 or below.
- **No STUN or TURN:** without internet there is nothing to reach. Phones on the same hotspot connect over their local addresses.
- **Real addresses instead of mDNS:** Chrome hides local IPs behind random `….local` names unless the page may use the camera. That is why the host opens the camera _before_ making the offer, and the player has already scanned before making the answer. Real IPs avoid depending on mDNS, which not every hotspot passes on; and if only one side's address can be reached, ICE still connects through peer-reflexive candidates.
- **Two data channels** (`packages/p2p/src/link.ts`): `control` is reliable; `fast` is unordered with no retransmits, like UDP. Both are negotiated up front, so no signaling is needed after the scans.

### Bluetooth

Browsers cannot do this: Web Bluetooth can only connect to devices, and a web page cannot advertise itself, so two phones in Chrome cannot find each other (and iOS has no Web Bluetooth at all). The Android app can, through Google's Nearby Connections (`NearbyPlugin.java` in the Android project, `src/bluetooth.ts` in the game):

- Nearby finds phones over Bluetooth Low Energy, connects them over Bluetooth, and moves to a faster Wi-Fi link between them only where that does not take a phone off its own Wi-Fi.
- One host takes several players at once, in Nearby's star strategy, as the game's own. Bluetooth allows up to seven connections a phone: the game's eight players, with the host.
- Bluetooth carries less than a Wi-Fi, so the host sends a Bluetooth player 15 snapshots a second instead of 30 (`minStateIntervalMs` in the library), and the others as many as before.
- Each Bluetooth link becomes a `Connection` through the library's `packetConnection`: the rooms know nothing of Bluetooth.

### Versions, rejoining and storage

- **Versions:** phones update the game in the background, so a host and a player may run different versions. `hello` and `welcome` carry two versions, the room's own (`ROOM_PROTOCOL` in the library) and the game's (`PROTOCOL` in `src/net/protocol.ts`). If either differs, the player is not let in and both phones say so.
- **Rejoining** (`Seats` in the library, `src/session/saved.ts`): a phone that closes, fails or stays silent for 8 seconds is dropped, but its seat is kept under its browser's token, and the game keeps its score. A `hello` with that token gets the same id back, and with it the score. If the same browser says hello while its old connection has not timed out yet, the old one is dropped first. The host saves the seats every 2 seconds and when the page is hidden; when it ends the game, it sends `bye`.
- **Storage** (`src/storage.ts`, `src/settings.ts`): everything lives in `localStorage` under the `vibe-p2pgame:` prefix. Every stored value is checked on reading, and an invalid value falls back to its default.
- **App updates** (`src/updates.ts`, `AppUpdaterPlugin.java`): the release holds `version.json` beside the APK, naming its build. The app compares it with its own build number, the APK's `versionCode`; CI sets both to the Android workflow's run number.

## Security

Anyone can make a QR code, any phone nearby can ask over Bluetooth, and any phone that pairs can send whatever it likes, so no side trusts another:

- **Codes** (`unpack` in the library) are read strictly by the ICE grammar: credentials only of ICE characters, addresses only as IPv4, IPv6 or mDNS names, at most six candidates, and a length limit. No field can smuggle a line into the SDP the browser reads.
- **Messages** longer than 16 KB are dropped unread. The rest is parsed as JSON and checked field by field: the room's own part by the library, Spark Hunt's input and snapshots by `parseInput` and `parseSnapshot` in `src/net/protocol.ts`. Anything unexpected is dropped. Coordinates must be finite (JSON reads `1e999` as Infinity) and are kept inside the arena. A snapshot is drawn only when all of it is sound.
- **Names** lose control and formatting characters, such as a right-to-left override, and are cut to 16 characters.
- **The host** decides everything: a player only steers their own dot and cannot name an id. The host answers pings only with a number, lets in one player per connection and up to eight in all, and closes a connection that opens but says no hello within 15 seconds. Player tokens never leave the host, so nobody can take another player's place.
- **Bluetooth:** the native side looks for this game's service only, keeps at most four requests waiting, takes messages only from accepted connections, only as bytes of at most 32 KB on a known channel and at most 120 a second, and drops fast messages while the link is busy. `src/bluetooth.ts` checks every native event again, field by field, and ends any connection it did not ask for or accept; `packetConnection` checks each message once more. Nearby encrypts its connections, and the code both phones show lets the host see that the player is who they seem.
- **App updates** are read and downloaded only from this repository's releases, over HTTPS, and Android installs an update only if it is signed with the same key as the app installed.
- **Limits:** the connections are encrypted, but a phone that pairs can still lie about its own input; the game does not check what is humanly possible. A rejoining player is known by their browser's token, which is safe only as long as it stays secret. The debug key that signs the APKs is public on purpose, so it proves only that an update comes from a build of this project, not from whom.

## Layout

```
packages/p2p/   the library @fionapreroll/p2p, with its own README and CHANGELOG
  src/          signal.ts: codes; link.ts: WebRTC; connection.ts: connections of any kind;
                packet.ts: connections over message transports; channel.ts: messages and checks;
                room/: HostRoom, GuestRoom, Seats; qr/: QR codes and the camera;
                testing.ts: connections in memory, for tests
src/
  game/         sim.ts: the rules, pure and tested; draw.ts: the canvas
  net/          protocol.ts: Spark Hunt's input and snapshots, checked
  session/      host.ts and guest.ts: Spark Hunt on the library's rooms; saved.ts: what a host keeps
  ui/           the screens, plain DOM without a framework; scanPanel.ts: the camera view
  native.ts     what the Android app adds: Google's scanner
  bluetooth.ts  Bluetooth between app phones
  updates.ts    updates of the app from its release
  i18n.ts       every visible text, in English and German
  settings.ts, storage.ts   what the phone remembers
android/        the Android app's project (Capacitor), with capacitor.config.ts at the top
tools/          serviceWorker.ts: writes the offline worker into the build; androidIcons.ts: the app's icons
tests/e2e/      Playwright: two browser profiles pair through text codes and play
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

`pnpm check` runs the type check, Biome and the unit tests of the game and the library:

- `packages/p2p/src/room/room.test.ts` connects host and player rooms through connections in memory (`linkPair` from the library's `testing` entry point), with fake timers and a tiny made-up game: joining, input and state, pings, a full room, versions, silence, leaving and rejoining, and attacks from players and hosts. `packages/p2p/src/packet.test.ts` does the same over packet connections. `src/session/p2p.test.ts` covers what Spark Hunt adds.
- `src/bluetooth.test.ts` plays Spark Hunt over Bluetooth against a fake Nearby: several fake phones that advertise, ask, answer and carry messages between them, and native events that misbehave.
- `*.fuzz.test.ts` use [fast-check](https://fast-check.dev/) to fuzz the codes, the room's messages, the game's parsers and rules, and hosts and players under random hostile traffic. When a property fails, fast-check prints the smallest input that breaks it.

`pnpm test:coverage` also measures coverage, which CI uploads to Codecov; it counts unit tests only, not the browser. `pnpm test:e2e` builds the game and pairs two Chromium profiles over real WebRTC; in containers with a preinstalled Chromium, set `CHROMIUM_PATH` to it.

**On phones:** `pnpm dev:phone` serves the game to the local network over HTTPS with a self-signed certificate, as phones open the camera only on HTTPS pages. Open the address it prints on each phone and accept the certificate warning once.

**The Android app** needs Android Studio, or a JDK 21 and the Android SDK:

```bash
pnpm android:sync
```

```bash
cd android && ./gradlew assembleDebug
```

`pnpm android:sync` builds the game and copies it into the Android project; run it after every change to the game. `pnpm exec cap open android` opens the project in Android Studio, and `pnpm icons:android` draws the app's icon and splash screen from `public/icon.svg`. Native features go through `src/native.ts`, `src/bluetooth.ts` and `src/updates.ts`, which do nothing in a browser, so the website and the app stay one codebase. The app's permissions are in `android/app/src/main/AndroidManifest.xml`, each with a comment why. Every build is signed with the same debug key, `android/app/debug.keystore`, in the repository on purpose, so that each APK installs over the one before.

## Workflow

### Branches and pull requests

- Every feature or fix gets its own branch off `origin/main`, named `feature/<name_in_snake_case>` or `fix/<name_in_snake_case>`.
- While the game is in development, a finished branch may be merged into `main` directly, once `pnpm check` and `pnpm test:e2e` pass on the merged result. Otherwise, and later as the rule, each branch gets one pull request against `main`, merged once CI is green.

### What CI does

| Workflow      | When                                    | What                                                                                                                               |
| ------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`      | Pull requests and pushes to `main`      | Type check, Biome, unit tests with coverage to Codecov, library build, end-to-end tests                                            |
| `deploy.yml`  | Pushes to `main`, or by hand            | Publishes the website to GitHub Pages; in the repository settings under _Pages_, the source must be _GitHub Actions_               |
| `android.yml` | Pull requests and pushes to `main`      | Builds the APK; from `main`, replaces it in the release _Spark Hunt for Android_ (tag `android-latest`), with `version.json`       |
| `publish-p2p.yml` | By hand on `main`, or a tag `p2p-v…` | Publishes the library to GitHub's npm registry and tags the version                                                                |

### Changelog and game versions

- `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Changes that players can see go under `## [Unreleased]`, in `### Added`, `### Changed`, `### Fixed` or `### Removed`, written in English for players. Changes only developers notice, such as tests, tooling or refactoring, need no entry.
- A version is made only when asked. The entries under `## [Unreleased]` then move to a new `## [x.y.z] - YYYY-MM-DD` section, `package.json` gets the same version, and the commit is tagged `vx.y.z`. The empty `## [Unreleased]` heading stays for the next changes, and the link definitions at the end of the file point at the comparison and the release. Versions follow [Semantic Versioning](https://semver.org/).

### Library versions

`packages/p2p` is a pnpm workspace package. The game uses it as `workspace:*`, straight from its sources, so a change to the library is tested with the game at once; `pnpm build:p2p` builds the package into `packages/p2p/dist`. The library has its own version and `packages/p2p/CHANGELOG.md`, apart from the game's. A version is published only when asked:

1. Move the entries under `## [Unreleased]` in `packages/p2p/CHANGELOG.md` to a new `## [x.y.z] - YYYY-MM-DD` section, set `"version"` in `packages/p2p/package.json` to the same, and bring that to `main`.
2. In the Actions tab, run **Publish p2p** on `main`. It checks that the version is new and in the changelog, runs every check, publishes the package, and then tags the commit `p2p-vx.y.z`. Pushing such a tag yourself publishes too, once it matches the version in `packages/p2p/package.json`.

Games that use the library install it as its [README](packages/p2p/README.md) describes, with a token that may read packages.

## Known limits

- **Tested end to end in Chromium only,** with two profiles on one machine. Real phones, iOS Safari and Firefox still need testing on a hotspot.
- **The Android app is built and unit-tested, but not yet tried on phones:** Bluetooth, Google's scanner and the updates, and whether Android's WebView hides local addresses behind mDNS names as Chrome does, keeps the screen on, and takes photos through the camera app.
- **Some Wi-Fi networks,** such as public or guest networks, isolate their clients, so the phones cannot see each other there; a phone's own hotspot does not do this.
- **If the host's screen turns off** or the host switches apps, the browser throttles the game loop and the round stutters for everyone. A screen wake lock keeps the screen on while the game is open, where the browser supports it.
- **Rejoining by QR code** takes a new pair of scans: WebRTC needs a new offer and answer for every connection, and there is no server to exchange them. Over Bluetooth, the player just picks the game again.
