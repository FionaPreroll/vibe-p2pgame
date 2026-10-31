import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
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

/**
 * The release, if it is newer than the app installed; null if not, and also when there is no
 * internet or anything else fails, so that the game always starts as usual.
 */
export async function availableUpdate(updater: Updater = AppUpdater): Promise<Release | null> {
  try {
    const [{ build }, { text }] = await Promise.all([
      updater.info(),
      updater.fetchText({ url: `${RELEASE}version.json` }),
    ])
    const release = parseRelease(JSON.parse(text))
    return release && release.build > build ? release : null
  } catch {
    return null
  }
}

export type InstallResult = 'installing' | 'permission' | 'failed'

/**
 * Downloads the newest APK and hands it to Android's installer, which asks the player.
 * `permission`: Android first wants the player to allow the app to install apps, in the settings
 * that have just opened; then it can be tried again.
 */
export async function installUpdate(
  onProgress: (percent: number) => void,
  updater: Updater = AppUpdater,
): Promise<InstallResult> {
  const listener = await updater
    .addListener('progress', ({ percent }) => onProgress(percent))
    .catch(() => null)
  try {
    await updater.download({ url: `${RELEASE}spark-hunt.apk` })
    await updater.install()
    return 'installing'
  } catch (error) {
    return (error as { code?: unknown })?.code === 'permission' ? 'permission' : 'failed'
  } finally {
    await listener?.remove()
  }
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
