# Changelog

All changes players can notice are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Spark Hunt, a game for phones side by side: every player steers a glowing dot to the spot they touch and catches sparks, golden ones counting three. A round lasts a minute, and up to eight phones play together.
- An Android app, which plays together with the website and works without internet from its first start. Its newest build is always on the repository's releases page. In the app, a button opens Google's own QR scanner, which focuses and zooms by itself.
- Bluetooth in the Android app: when joining or adding a player, choose QR code or Bluetooth. Over Bluetooth, no Wi-Fi is needed; the host picks players from those nearby and compares a code with them. One game can mix both.
- The Android app can look for a new version when it starts and install it, if you agree at its first start or switch it on in the settings. Android asks before installing.
- Mines: touching a red mine costs two points, and a score can drop below zero. A mine goes off with a flash that shows whose points it took, then appears again elsewhere. A new mine is grey and harmless for its first second, and never appears right next to a player. More players, more mines.
- Phones that run different versions of the game say so when pairing, instead of playing a game one of them cannot fully show.
- Phones connect directly over Wi-Fi, for example a hotspot opened by one of them, without internet, a server or an app. To join, the new player scans the host's QR code, then the host scans the code on the player's phone.
- The host's QR code also works with the phone's own camera app, which opens the game and joins at once. Without a camera, the codes can be copied and pasted as text.
- Once opened online, the game also starts without internet, and browsers can install it as an app.
- English and German, chosen by the browser's language or in the settings.
- Help for cameras that will not focus on a screen: tap the picture to focus, zoom and brightness sliders where the camera has them, switching between the phone's cameras, and taking a photo with the phone's own camera app instead.
- Rejoining: a player who drops out gets their place, color and score back, even in the middle of a round. Players who are away show as such between rounds.
- A host whose page closed can carry on with the same players and scores. When the host ends the game, everyone is told.
- Settings, kept in the browser: name, language, vibration, keeping the screen on and the round length. The camera last used to scan is remembered, with its zoom and brightness.

[Unreleased]: https://github.com/FionaPreroll/vibe-p2pgame/commits/main
