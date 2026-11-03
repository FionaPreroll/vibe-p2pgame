# Changelog

All changes players can notice are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Connection details: tapping the connection graph shows, for every connection, the ping, pings lost, stalls, messages and data each way, what connects the phones (Wi-Fi or Bluetooth), the addresses and protocols on both ends, the packets and bytes the connection carried, and its encryption. Addresses stay hidden until you tap _Show addresses_.
- A connection test: in the connection details, the host taps _Test connections_, and for five seconds the phones send each other as much as their connections take. Everyone then sees the ping under load and how many kilobytes a second got through each way. The debug report holds the last test.

### Changed

- Phones with this version and phones with 0.2.0 cannot play together: update both.
- The connection graph opens the connection details, with a button to the debug report. The debug report also tells what kind of connection each player has, without addresses.
- The privacy policy says what a connection test sends, and that the connection details show addresses on your screen only.

### Fixed

- On a weak Wi-Fi, a player's screen no longer jumps back for a moment when an older update of the game arrives after a newer one.
- A player who leaves the Bluetooth search while asking a host no longer stays in the host's list, where the host could still accept them.
- After a Bluetooth player could not join, the host's list keeps them with the reason until the host removes them, instead of offering to accept them again.
- A Bluetooth player the host let in whose phone never connects no longer stays on _Connecting…_ in the host's list: after 30 seconds, the list says the connection timed out.
- Pairing by copied text codes: the player's phone now waits up to 10 minutes for the host to take its code, as in the Spielekiste, instead of 30 seconds.

## [0.2.0] - 2026-11-02

### Added

- Spark Hunt, a game for phones side by side: every player steers a glowing dot to the spot they touch and catches sparks, golden ones counting three. A round lasts a minute, and up to eight phones play together.
- An Android app, which plays together with the website and works without internet from its first start. Its newest build is always on the repository's releases page. In the app, a button opens Google's own QR scanner, which focuses and zooms by itself.
- A privacy policy, in English and German, from _About Spark Hunt_ and from the settings: no accounts, no server, no tracking, and what stays on the phone, what other phones see, and what the app's permissions are for.
- On Android phones, the website offers the Android app.
- _About Spark Hunt_, ⓘ on the start screen: which version and build this is, an address to write to, what changed from version to version, and the licenses of the open-source code inside the game and the app.
- _Look for a new version now_ in the app's settings.
- The app's update dialog says how large the download is, warns on mobile data or another metered connection, shows the download's progress, and can pause it. A paused or broken download goes on where it stopped, also after closing the app.
- A debug report in the settings: if something does not work, create it, read it, and copy it or open an issue on GitHub with it. It says what phone and versions this is and what happened recently, not who you are.
- Bluetooth in the Android app: when joining or adding a player, choose QR code or Bluetooth. Over Bluetooth, no Wi-Fi is needed; the host picks players from those nearby and compares a code with them. One game can mix both.
- The Android app can look for a new version when it starts and install it, if you agree at its first start or switch it on in the settings. Android asks before installing.
- Mines: touching a red mine costs two points, and a score can drop below zero. A mine goes off with a flash that shows whose points it took, then appears again elsewhere. A new mine is grey and harmless for its first second, and never appears right next to a player. More players, more mines.
- Phones that run different versions of the game say so when pairing, instead of playing a game one of them cannot fully show.
- Phones connect directly over Wi-Fi, for example a hotspot opened by one of them, without internet or a server. To join, the new player scans the host's QR code, then the host scans the code on the player's phone.
- The host's QR code also works with the phone's own camera app, which opens the game and joins at once. Without a camera, the codes can be copied and pasted as text.
- Once opened online, the game also starts without internet, and browsers can install it as an app.
- English and German, chosen by the browser's language or in the settings.
- Help for cameras that will not focus on a screen: tap the picture to focus, zoom and brightness sliders where the camera has them, switching between the phone's cameras, and taking a photo with the phone's own camera app instead.
- Rejoining: a player who drops out gets their place, color and score back, even in the middle of a round. Players who are away show as such between rounds.
- A host whose page closed can carry on with the same players and scores. When the host ends the game, everyone is told.
- Settings, kept in the browser: name, language, vibration, keeping the screen on and the round length. The camera last used to scan is remembered, with its zoom and brightness.
- A countdown of three seconds before every round.
- After a round, everyone sees who caught how many sparks, golden ones among them, and touched how many mines.
- Players can say they are ready for the next round: once every player is ready, it starts by itself. The host sees how many are ready.
- Players can just watch for a while, without their dot, and play along again from the next round on, with their score.
- Sounds for sparks, golden sparks, mines, the countdown and the end of a round, with a mute button next to the scores and a switch in the settings.
- Every player's dot carries a shape as well as a colour, also in the lists, for players who tell colours apart badly.
- The host is told when a player's connection keeps stalling.
- Free play: before the first round, a banner above the arena says that points do not count yet, and they do not; sparks and mines work as in a round. After a round, the banner says it is over.
- A big clock above the arena during a round, with a bar that runs down and turns red, ticking, for the last ten seconds. "Go!" flashes as a round starts.
- Points won rise from the dot that won them, as "+1" or "+3".
- Steering with keys (arrow keys or WASD) and game controllers (left stick or D-pad), and an optional joystick on the screen, on the left or the right. Enter, Space or a controller's Start button starts a round on the host's phone.
- Every key and controller button can be changed in the settings.
- A small graph of the connection in the top line. The debug report, also reachable from the graph and after a round, shows a larger graph and holds how well the connection kept up, second by second: ping, messages and data per second, lost pings and stalls, beside the log, which notes when a connection stalls and recovers. It can be copied, downloaded or sent.

### Changed

- More room for names: the top line holds ×, the clock or banner, the connection graph and the sound button, and the scores get a line of their own below, wrapping with many players. The arena sits right below them and no longer jumps when a round starts; the joystick sits at the bottom, smaller on short screens.
- Phones with this version and phones with the version before cannot play together: update both.
- While the host is alone, _Add player_ is the highlighted button, as adding players is what comes next.
- The settings are in sections: game, controls, app, data and help.
- Your own score is marked in the list of scores.
- When Bluetooth cannot start, the app says whether Bluetooth or Location is off, and adds a code that a debug report explains.

### Fixed

- On phones, the whole game could vanish but for the arena as a round started: the growing countdown made the page wider than the screen, and the phone zoomed. The game now always fits the screen.
- The Download button in the debug report is centred like the others.
- An update no longer hangs at "Android's installer takes over" when the installer does not open: the dialog now says when Android waits for your confirmation, when the update was cancelled or failed, and offers to try again if the installer stays closed.
- The app's texts fit the app: no more "no app", the phone instead of the browser, Bluetooth on the start screen, and no tip to open a page once online. Phones of different versions say how to update both the website and the app.
- A new screen opens at its top, instead of scrolled down as far as the screen before.
- The back button no longer closes the Android app from every screen: it goes back from the settings and other screens and closes dialogs, does nothing during a game, and leaves the app only from the start screen.
- Joining a game over Bluetooth works on newer Android versions: the app now also asks for Location, which finding games nearby needs. Approximate is enough.
- After allowing the app to install apps, an update installs right away, without downloading again.

[Unreleased]: https://github.com/FionaPreroll/vibe-p2pgame/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/FionaPreroll/vibe-p2pgame/releases/tag/v0.2.0
