# @fionapreroll/app-updates

Updates for Android apps made with [Capacitor](https://capacitorjs.com/), from the app's own GitHub release, without the Play Store: the app looks for a newer build, downloads it and hands it to Android's installer, which asks the player.

- **The release** holds the APK and a `version.json` naming its build, which CI writes beside it. The app compares that build with its own, the APK's `versionCode`.
- **Downloads go on where they stopped**, after a pause, a lost connection or closing the app: the part downloaded so far is kept per build, and only the rest is asked for.
- **The dialog says what the download costs**: its size, and a warning on mobile data or another metered connection. It shows the progress, pauses and resumes.
- **Android's installer** gets the APK as an installer session, which reports back: when it waits for the player's confirmation, when the update is in, when the player said no, or why it failed. Where no session can be made, the APK is opened with the installer the old way. The first time, Android wants the player to allow the app to install apps: the plugin opens that setting, and installing goes on by itself when the player comes back, without downloading again.
- **Only the app's own releases**, named in its Capacitor config, are read and downloaded from, over HTTPS; the page cannot name any other place. Android installs an update only if it is signed with the same key as the app installed, so every build must be signed alike.

In a browser there is no native side: looking for updates fails quietly, and a game simply does not offer them there.

## Installing

From [GitHub's npm registry](https://github.com/FionaPreroll/vibe-p2pgame/pkgs/npm/app-updates) (see `@fionapreroll/p2p`'s README for the `.npmrc`), in a Capacitor 8 app:

```bash
pnpm add @fionapreroll/app-updates
```

Or without logging in, from the file on the version's release:

```bash
pnpm add https://github.com/FionaPreroll/vibe-p2pgame/releases/download/app-updates-v0.1.0/fionapreroll-app-updates-0.1.0.tgz
```

Name the app's releases in `capacitor.config.ts`, then sync:

```ts
const config: CapacitorConfig = {
  // …
  plugins: {
    AppUpdater: { releases: 'https://github.com/<owner>/<repository>/releases/' },
  },
}
```

```bash
npx cap sync android
```

`cap sync` adds the native plugin to the app's Android project, with the permissions below; nothing to register by hand.

## How an app uses it

```ts
import { AppUpdates, updateOnStart } from '@fionapreroll/app-updates'
import { askAboutUpdates, offerUpdate } from '@fionapreroll/app-updates/dialog'

const updates = new AppUpdates({
  releases: 'https://github.com/<owner>/<repository>/releases/latest/download/',
  apk: 'my-game.apk',
  log: (line) => console.debug(line), // optional: builds and outcomes, nothing else
})

// At the start of the app: ask once, then look at every start if the player said yes.
await updateOnStart(
  updates,
  {
    asked: () => mySettings.updatesAsked,
    enabled: () => mySettings.checkUpdates,
    answer: (yes) => saveSettings({ updatesAsked: true, checkUpdates: yes }),
  },
  {
    ask: () => askAboutUpdates(t),
    offer: (release) => offerUpdate(updates, release, t),
  },
)

// From the settings: look now.
const check = await updates.check() // { kind: 'newer', release, installed } | 'current' | 'failed'
if (check.kind === 'newer') offerUpdate(updates, check.release, t, { language: 'de' })
```

- `releases` must lie within the releases in the Capacitor config; the address `…/releases/latest/download/` follows the release marked _latest_.
- **Texts** are the app's own: `t(key, values)` gives the text for each `UpdateTextKey` in the player's language, with `{name}` values filled in (see `src/dialog.ts` for which values each text gets).
- **Styles** are the app's too: a dialog is a `.modal.update` with a `.card`, `.buttons` (the first closes it), a `.warning`, a `progress` and a `.status`.
- `opened: (modal, close) => …` in the dialogs' options hands each dialog to the app as it opens, for its back button, for example.
- Without the dialogs, `install(release, onProgress)`, `pause()`, `continueInstall()`, `isDownloaded`, `partialBytes`, `network()` and `onInstallEvent` do the same steps for a dialog of the app's own.

### The release

CI publishes `version.json` beside the APK, with the build number that is also the APK's `versionCode`, the commit and the APK's size in bytes:

```json
{ "build": 42, "commit": "0123abcd…", "size": 4226513 }
```

For example, in a GitHub workflow, after building the APK with `versionCode` set to `github.run_number`:

```bash
printf '{"build":%s,"commit":"%s","size":%s}\n' "$GITHUB_RUN_NUMBER" "$GITHUB_SHA" "$(stat -c %s my-game.apk)" > version.json
gh release upload "$TAG" my-game.apk version.json --clobber
```

### Testing

`@fionapreroll/app-updates/testing` has `FakeUpdater`, the native side without a phone: an installed build, a release, a download the test finishes, fails or pauses, the right to install apps, and the installer's answers. Give it to `new AppUpdates(options, fake)`.

## Permissions

Merged into the app's manifest from the plugin's own (`android/src/main/AndroidManifest.xml`):

| Permission                 | Why                                                           |
| -------------------------- | ------------------------------------------------------------- |
| `INTERNET`                 | Reading `version.json` and downloading the APK                |
| `ACCESS_NETWORK_STATE`     | Warning before a download over mobile data                    |
| `REQUEST_INSTALL_PACKAGES` | Handing the APK to Android's installer, which asks the player |

It also brings a `FileProvider` of its own, for the installer where no session can be made.

**Google Play** does not allow apps to update themselves. A build for the Play Store leaves this package out: with no package, there is no plugin and none of its permissions, and `check()` simply fails, so the app offers nothing.

## The native side

`AppUpdaterPlugin` (`android/src/main/java/…/appupdates`) keeps only what needs Android. Its decisions are in `UpdateRules`, plain Java with JUnit tests beside it (`android/src/test/java`): which releases a config may name, which addresses are within them, how a download goes on where it stopped, its limits (an APK of at most 200 MB, a text of at most 64 KB), how often it tells its progress, and what the installer's answers mean. Its files are in the app's cache, in `updates/`: the APK downloaded last as `update.apk`, and the part of a running download as `update-<build>.part`.
