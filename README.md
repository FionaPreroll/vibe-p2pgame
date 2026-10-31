# vibe-p2pgame: Spark Hunt

[![CI](https://github.com/FionaPreroll/vibe-p2pgame/actions/workflows/ci.yml/badge.svg)](https://github.com/FionaPreroll/vibe-p2pgame/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/FionaPreroll/vibe-p2pgame/branch/main/graph/badge.svg)](https://codecov.io/gh/FionaPreroll/vibe-p2pgame)

A prototype game for phones lying side by side, with **no internet, no server and no app**. The phones connect directly over WebRTC data channels on a shared Wi-Fi, typically a hotspot opened by one of them. Instead of a signaling server, they swap their connection offers by **scanning QR codes**.

The game itself is small on purpose, because the prototype is about the connection: every player steers a glowing dot toward the spot they touch, and whoever reaches a spark first scores. Golden sparks count three, and a round lasts one minute. The page is in English or German, whichever the browser's language is.

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

**Offline:** open the page once while online. A service worker keeps all of its files, so after that it also starts on a hotspot without internet, and browsers can install it as an app. Phones only allow the camera on HTTPS pages, so serve it over HTTPS, for example from GitHub Pages.

**Camera won't focus?** Many phones can't focus on a screen held close. Below the camera picture:

- Tap the picture to focus and set the exposure on that spot.
- Hold the phone further away and use the **Zoom** slider. Lower the **Brightness** if the code glares. Both sliders appear only where the browser offers these camera settings, which is mostly Chrome on Android.
- **Switch camera** cycles through the phone's cameras, as some focus closer than others.
- **Take a photo instead** opens the phone's own camera app, which focuses better. The photo is read at several sizes, and in Chrome on Android with the phone's built-in QR detector.

**No camera?** Under _No camera? Use text codes_, each side can copy its code and paste the other's, for example between two laptops or through a messenger.

## How it works

| Step         | Host                                                                        | Player                                             |
| ------------ | --------------------------------------------------------------------------- | -------------------------------------------------- |
| 1. Camera on | Opens the camera, which also makes Chrome reveal real local IPs (see below) |                                                    |
| 2. Offer     | Creates an `RTCPeerConnection`, waits for all local addresses, shows the QR |                                                    |
| 3. Scan      |                                                                             | Scans the offer and creates the answer             |
| 4. Answer    |                                                                             | Shows the answer as a QR code                      |
| 5. Scan      | Scans the answer: ICE and DTLS connect directly over the Wi-Fi              |                                                    |
| 6. Play      | Runs the game 30 times a second and sends the state to everyone             | Sends where the player steers, and draws the state |
- **Short codes** (`src/net/signal.ts`): a browser's SDP is 1–3 KB, too dense to scan from a screen. Only a few fields differ between connections: offer or answer, the ICE user fragment and password, the DTLS fingerprint, the DTLS role and the UDP host candidates. The code carries just those, about 130 characters such as `P1~o~x~Wke9~UmMu…~ohqF…~192.168.43.1,58378`, and the other side writes a minimal SDP around them. With the join link included, the QR code stays at version 10 or below.
- **No STUN or TURN**: without internet there is nothing to reach. Phones on the same hotspot connect over their local addresses.
- **Real addresses instead of mDNS**: Chrome hides local IPs behind random `….local` names unless the page may use the camera. That is why the host opens the camera _before_ making the offer, and why the player has already scanned before making the answer. Real IPs avoid depending on mDNS, which not every hotspot passes on. Even if only one side's address can be reached, ICE still connects through peer-reflexive candidates.
- **Two data channels per player** (`src/net/link.ts`): `control` is reliable, for hello and welcome; `fast` is unordered with no retransmits, like UDP, for input, state and pings. Both are negotiated up front, so no signaling is needed after the scans.
- **Host-authoritative** (`src/session/host.ts`): the host steps the rules (`src/game/sim.ts`, pure TypeScript) and sends complete snapshots, so a lost packet is simply replaced by the next one. Players smooth the dots between snapshots. Each player measures the round trip once a second, and everyone sees all pings between rounds.
- **Leaving**: a phone that closes, fails or stays silent for 8 seconds is dropped. If the host leaves, the players' phones return to the start.

## Layout

```
src/
  game/      sim.ts: the rules, pure and tested; draw.ts: the canvas
  net/       signal.ts: SDP ↔ short code; link.ts: WebRTC; protocol.ts: messages
  qr/        qr.ts: QR codes as SVG (uqr); scanner.ts: camera, focus, zoom, decoding
  session/   host.ts and guest.ts: the two sides of a game
  ui/        the screens, plain DOM without a framework; scanPanel.ts: the camera view
  i18n.ts    every visible text, in English and German
tools/       serviceWorker.ts: writes the offline worker into the build
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

`pnpm check` runs the type check, Biome and the unit tests. `pnpm test:coverage` also measures coverage; CI uploads it to Codecov. `pnpm test:e2e` builds the game and pairs two Chromium profiles over real WebRTC; in containers with a preinstalled Chromium, set `CHROMIUM_PATH` to it.

**On phones:** `pnpm dev:phone` serves the game to the local network over HTTPS with a self-signed certificate (phones only open the camera on HTTPS pages). Open the address it prints on each phone and accept the certificate warning once. Alternatively, deploy to GitHub Pages and use that URL.

## Branches and pull requests

- Every feature or fix gets its own branch off `origin/main`, named `feature/<name_in_snake_case>` or `fix/<name_in_snake_case>`.
- While the game is in development, a finished branch may be merged into `main` directly, once `pnpm check` and `pnpm test:e2e` pass on the merged result. Otherwise, and later as the rule, each branch gets one pull request against `main`, merged once CI is green.

## Deployment

`.github/workflows/deploy.yml` publishes the build to GitHub Pages on every push to `main`, or by hand from the Actions tab. In the repository settings under _Pages_, set the source to _GitHub Actions_.

## Known limits of the prototype

- Tested end to end in Chromium only (two profiles on one machine). Real phones, iOS Safari and Firefox still need testing on a hotspot.
- Some Wi-Fi networks, such as public or guest networks, isolate their clients. There the phones cannot see each other, but a phone's own hotspot does not do this.
- If the host's screen turns off or the host switches apps, the browser throttles the game loop and the round stutters for everyone. A screen wake lock keeps the screen on while the game is open, where the browser supports it.
- There is no reconnecting: a player who drops out joins again with new codes.
