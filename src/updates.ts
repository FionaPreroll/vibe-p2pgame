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

/** The native side, as AppUpdaterPlugin.java offers it. */
export interface Updater {
  info(): Promise<{ build: number; name: string }>
  fetchText(options: { url: string }): Promise<{ text: string }>
  download(options: { url: string }): Promise<void>
  /** The build of the APK downloaded last, or -1. */
  downloaded(): Promise<{ build: number }>
  /** Whether the app may hand APKs to the installer, without opening any setting. */
  canInstall(): Promise<{ allowed: boolean }>
  install(): Promise<void>
  addListener(
    event: 'progress',
    listener: (progress: { percent: number }) => void,
  ): Promise<PluginListenerHandle>
}

export const AppUpdater = registerPlugin<Updater>('AppUpdater')

/** What the release says about its build. */
export interface Release {
  readonly build: number
  readonly commit: string
}

/** The release's version.json, checked: a whole build number above 0 and a commit hash. */
export function parseRelease(value: unknown): Release | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { build, commit } = value as Record<string, unknown>
  if (!Number.isSafeInteger(build) || (build as number) < 1) return undefined
  if (typeof commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(commit)) return undefined
  return { build: build as number, commit }
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

export type InstallResult = 'installing' | 'permission' | 'failed'

/**
 * Downloads the release's APK, unless it is already here, and hands it to Android's installer,
 * which asks the player. `permission`: Android first wants the player to allow the app to
 * install apps, in the settings that have just opened; `continueInstall` goes on from there,
 * without downloading again.
 */
export async function installUpdate(
  release: Release,
  onProgress: (percent: number) => void,
  updater: Updater = AppUpdater,
): Promise<InstallResult> {
  if ((await downloadedBuild(updater)) !== release.build) {
    const listener = await updater
      .addListener('progress', ({ percent }) => onProgress(percent))
      .catch(() => null)
    try {
      await updater.download({ url: `${RELEASE}spark-hunt.apk` })
    } catch (error) {
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
