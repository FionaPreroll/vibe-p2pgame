import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import { describeError, log } from './log'
import { isApp } from './native'
import { settings, updateSettings } from './settings'

/**
 * In-app updates for the Android app, from the release "Spark Hunt for Android" on GitHub,
 * which CI replaces with every build of main. Its version.json names the build; the app compares
 * that with its own build number and, if the player wants, downloads the new APK and hands it
 * to Android's installer (AppUpdaterPlugin in the Android project). Only in the app, and only
 * when the player has switched it on: see the settings.
 */

/** The newest release's files: `version.json` and `spark-hunt.apk`. */
export const RELEASE = 'https://github.com/FionaPreroll/vibe-p2pgame/releases/latest/download/'

/** A download's progress, in bytes; `total` is -1 while unknown. */
export interface Progress {
  readonly done: number
  readonly total: number
}

/** What the phone's connection costs, as far as Android knows. */
export interface Network {
  readonly online: boolean
  /** Paid by the amount, as mobile data and some hotspots are. */
  readonly metered: boolean
  readonly cellular: boolean
}

/** The native side, as AppUpdaterPlugin.java offers it. */
export interface Updater {
  info(): Promise<{ build: number; name: string }>
  fetchText(options: { url: string }): Promise<{ text: string }>
  /** Downloads a build, going on from what an earlier download left; rejects "paused". */
  download(options: { url: string; build: number }): Promise<void>
  /** Stops the running download where it is. */
  pauseDownload(): Promise<void>
  /** The bytes of a build an earlier download left. */
  partial(options: { build: number }): Promise<{ bytes: number }>
  network(): Promise<Network>
  /** The build of the APK downloaded last, or -1. */
  downloaded(): Promise<{ build: number }>
  /** Whether the app may hand APKs to the installer, without opening any setting. */
  canInstall(): Promise<{ allowed: boolean }>
  install(): Promise<void>
  addListener(
    event: 'progress',
    listener: (progress: unknown) => void,
  ): Promise<PluginListenerHandle>
}

export const AppUpdater = registerPlugin<Updater>('AppUpdater')

/** What the release says about its build. */
export interface Release {
  readonly build: number
  readonly commit: string
  /** The APK's size in bytes, or null where the release does not say (builds before 11). */
  readonly size: number | null
}

/** The largest APK the app downloads, as AppUpdaterPlugin.java allows. */
const MAX_APK_BYTES = 200 * 1024 * 1024

/**
 * The release's version.json, checked: a whole build number above 0 and a commit hash, and the
 * APK's size, if it is a sound one.
 */
export function parseRelease(value: unknown): Release | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { build, commit, size } = value as Record<string, unknown>
  if (!Number.isSafeInteger(build) || (build as number) < 1) return undefined
  if (typeof commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(commit)) return undefined
  const sound =
    Number.isSafeInteger(size) && (size as number) > 0 && (size as number) <= MAX_APK_BYTES
  return { build: build as number, commit, size: sound ? (size as number) : null }
}

/** A progress event from the native side, checked. */
export function parseProgress(value: unknown): Progress | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { done, total } = value as Record<string, unknown>
  if (!Number.isSafeInteger(done) || (done as number) < 0) return undefined
  if (!Number.isSafeInteger(total) || (total as number) < -1) return undefined
  return { done: done as number, total: total as number }
}

/** What looking for an update found. */
export type UpdateCheck =
  | { readonly kind: 'newer'; readonly release: Release; readonly installed: number }
  | { readonly kind: 'current'; readonly installed: number }
  | { readonly kind: 'failed' }

/** Looks for a newer build in the release. Without internet, or with a broken release: failed. */
export async function checkForUpdate(updater: Updater = AppUpdater): Promise<UpdateCheck> {
  try {
    const [{ build }, { text }] = await Promise.all([
      updater.info(),
      updater.fetchText({ url: `${RELEASE}version.json` }),
    ])
    const release = parseRelease(JSON.parse(text))
    if (!release) throw new Error('version.json is not sound')
    log('updates', `installed build ${build}, release build ${release.build}`)
    return release.build > build
      ? { kind: 'newer', release, installed: build }
      : { kind: 'current', installed: build }
  } catch (error) {
    log('updates', `no update information: ${describeError(error)}`)
    return { kind: 'failed' }
  }
}

/**
 * The release, if it is newer than the app installed; null if not, and also when there is no
 * internet or anything else fails, so that the game always starts as usual.
 */
export async function availableUpdate(updater: Updater = AppUpdater): Promise<Release | null> {
  const check = await checkForUpdate(updater)
  return check.kind === 'newer' ? check.release : null
}

export type InstallResult = 'installing' | 'permission' | 'paused' | 'failed'

/**
 * Downloads the release's APK, unless it is already here, and hands it to Android's installer,
 * which asks the player. A download goes on from what an earlier one left. `paused`: the player
 * paused it (`pauseUpdate`), and calling this again goes on. `permission`: Android first wants
 * the player to allow the app to install apps, in the settings that have just opened;
 * `continueInstall` goes on from there, without downloading again.
 */
export async function installUpdate(
  release: Release,
  onProgress: (progress: Progress) => void,
  updater: Updater = AppUpdater,
): Promise<InstallResult> {
  if (!(await isDownloaded(release, updater))) {
    const listener = await updater
      .addListener('progress', (value) => {
        const progress = parseProgress(value)
        if (progress) onProgress(progress)
      })
      .catch(() => null)
    try {
      await updater.download({ url: `${RELEASE}spark-hunt.apk`, build: release.build })
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'paused') {
        log('updates', 'download paused')
        return 'paused'
      }
      log('updates', `download failed: ${describeError(error)}`)
      return 'failed'
    } finally {
      await listener?.remove()
    }
    const build = await downloadedBuild(updater)
    if (build !== release.build) {
      // The release changed while downloading, or the file is not the app: nothing is installed.
      log('updates', `downloaded build ${build}, expected ${release.build}`)
      return 'failed'
    }
  } else {
    log('updates', `build ${release.build} is downloaded already`)
  }
  return handOver(updater)
}

/** Pauses the running download; `installUpdate` goes on from there. */
export async function pauseUpdate(updater: Updater = AppUpdater): Promise<void> {
  await updater.pauseDownload().catch(() => {})
}

/** Whether the release's APK is downloaded already, ready to install. */
export async function isDownloaded(
  release: Release,
  updater: Updater = AppUpdater,
): Promise<boolean> {
  return (await downloadedBuild(updater)) === release.build
}

/** The bytes of the release an earlier download left, to go on from; 0 for none. */
export async function partialBytes(
  release: Release,
  updater: Updater = AppUpdater,
): Promise<number> {
  const { bytes } = await updater.partial({ build: release.build }).catch(() => ({ bytes: 0 }))
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0
}

/** What the connection costs now; free if Android cannot say, so as not to scare for nothing. */
export async function network(updater: Updater = AppUpdater): Promise<Network> {
  const found = await updater.network().catch(() => null)
  return {
    online: found?.online !== false,
    metered: found?.metered === true,
    cellular: found?.cellular === true,
  }
}

/**
 * After the player was sent to allow installing apps: hands the APK to the installer if that is
 * allowed now, without downloading again; `permission` if it still is not.
 */
export async function continueInstall(updater: Updater = AppUpdater): Promise<InstallResult> {
  const { allowed } = await updater.canInstall().catch(() => ({ allowed: false }))
  return allowed ? handOver(updater) : 'permission'
}

async function handOver(updater: Updater): Promise<InstallResult> {
  try {
    await updater.install()
    log('updates', 'handed to the installer')
    return 'installing'
  } catch (error) {
    log('updates', `not installed: ${describeError(error)}`)
    return (error as { code?: unknown })?.code === 'permission' ? 'permission' : 'failed'
  }
}

async function downloadedBuild(updater: Updater): Promise<number> {
  return (await updater.downloaded().catch(() => ({ build: -1 }))).build
}

/** The dialogs the start of the app may show. */
export interface UpdateDialogs {
  /** Asks once whether to look for updates at every start. */
  ask(): Promise<boolean>
  /** Offers a newer version. */
  offer(release: Release): void
}

/**
 * At the app's start: asks once, at the first start, whether to look for updates (off unless the
 * player says yes), then looks if that is on, and offers what it finds. In a browser it does
 * nothing: there, the service worker updates the game.
 */
export async function updateOnStart(
  dialogs: UpdateDialogs,
  updater: Updater = AppUpdater,
): Promise<void> {
  if (!isApp()) return
  if (!settings().updatesAsked) {
    const yes = await dialogs.ask()
    updateSettings({ checkUpdates: yes, updatesAsked: true })
  }
  if (!settings().checkUpdates) return
  const release = await availableUpdate(updater)
  if (release) dialogs.offer(release)
}
