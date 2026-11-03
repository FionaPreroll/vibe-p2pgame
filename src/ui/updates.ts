import type { AppUpdates, Release } from '@fionapreroll/app-updates'
import { askAboutUpdates, type DialogOptions, offerUpdate } from '@fionapreroll/app-updates/dialog'
import { currentLanguage, t } from '../i18n'
import { appUpdates, updateOnStart } from '../updates'
import { cancelOnBack } from './dom'

/** The library's dialogs in Spark Hunt's words, closed by Android's back button too. */
function options(): DialogOptions {
  return { language: currentLanguage(), opened: (modal, close) => cancelOnBack(modal, close) }
}

/** At the app's start, with the library's dialogs: see `updateOnStart`. */
export function offerUpdates(updates?: AppUpdates): Promise<void> {
  return updateOnStart(
    { ask: () => askAboutUpdates(t, options()), offer: (release) => offer(release, updates) },
    updates,
  )
}

/** A new version: download and install it now, or later (see `offerUpdate`). */
export function offer(release: Release, updates: AppUpdates = appUpdates()): void {
  offerUpdate(updates, release, t, options())
}
