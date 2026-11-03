import {
  AppUpdates,
  updateOnStart as onStart,
  type StartDialogs,
  type UpdateCheck,
} from '@fionapreroll/app-updates'
import { log } from './log'
import { isApp } from './native'
import { settings, updateSettings } from './settings'

/**
 * In-app updates for the Android app, from the release "Spark Hunt for Android", which CI
 * replaces with every build of main: `@fionapreroll/app-updates` does the work, with the
 * release named here and in capacitor.config.ts. Only in the app, and only when the player has
 * switched it on: see the settings.
 */

/** The newest release's files: `version.json` and `spark-hunt.apk`. */
export const RELEASE = 'https://github.com/FionaPreroll/vibe-p2pgame/releases/latest/download/'

let made: AppUpdates | undefined

/** Spark Hunt's updates, made when first needed. */
export function appUpdates(): AppUpdates {
  made ??= new AppUpdates({
    releases: RELEASE,
    apk: 'spark-hunt.apk',
    log: (line) => log('updates', line),
  })
  return made
}

/** Looks for a newer build now. */
export function checkForUpdate(): Promise<UpdateCheck> {
  return appUpdates().check()
}

/** The build number and name of the app installed, for About and the debug report. */
export async function appBuild(): Promise<{ build: number; name: string }> {
  const info = await appUpdates().installed()
  if (!info) throw new Error('No package info')
  return info
}

/**
 * At the app's start: asks once, at the first start, whether to look for updates (off unless the
 * player says yes), then looks if that is on, and offers what it finds. In a browser it does
 * nothing: there, the service worker updates the game.
 */
export async function updateOnStart(
  dialogs: StartDialogs,
  updates: AppUpdates = appUpdates(),
): Promise<void> {
  if (!isApp()) return
  await onStart(
    updates,
    {
      asked: () => settings().updatesAsked,
      enabled: () => settings().checkUpdates,
      answer: (yes) => updateSettings({ checkUpdates: yes, updatesAsked: true }),
    },
    dialogs,
  )
}
