import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'

/**
 * Updates for an Android app made with Capacitor, from the app's own GitHub release, which its
 * CI replaces with every build. The release holds the APK and a `version.json` naming its build
 * (see the README); the app compares that with its own build number, the APK's `versionCode`,
 * and, if the player wants, downloads the new APK and hands it to Android's installer
 * (AppUpdaterPlugin, android/). Android installs it only if it is signed with the same key.
 *
 * The native side is checked like any other source: every answer and event is read field by
 * field. It reads and downloads only from the releases named in the app's Capacitor config, so
 * a page cannot send it anywhere else. In a browser there is no native side: looking fails
 * quietly.
 */

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
export interface UpdaterNative {
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
  /** Hands the APK to Android's installer: as a session, which tells how it goes, or not. */
  install(): Promise<{ way?: string }>
  addListener(
    event: 'progress' | 'install',
    listener: (value: unknown) => void,
  ): Promise<PluginListenerHandle>
}

let native: UpdaterNative | undefined

/** The native plugin, registered with Capacitor when first needed. */
export function updaterNative(): UpdaterNative {
  native ??= registerPlugin<UpdaterNative>('AppUpdater')
  return native
}

/** What the release says about its build. */
export interface Release {
  readonly build: number
  readonly commit: string
  /** The APK's size in bytes, or null where the release does not say. */
  readonly size: number | null
}

/** The largest APK the app downloads, as AppUpdaterPlugin.java allows. */
export const MAX_APK_BYTES = 200 * 1024 * 1024

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

/** What Android's installer says about a session (see AppUpdaterPlugin.install). */
export interface InstallEvent {
  /** Its dialog asking the player is open, the update is in, the player said no, or it failed. */
  readonly status: 'confirm' | 'success' | 'aborted' | 'failure'
  /** Android's own words, for a failure. */
  readonly message: string
}

const INSTALL_STATUSES: readonly InstallEvent['status'][] = [
  'confirm',
  'success',
  'aborted',
  'failure',
]

/** An install event from the native side, checked. */
export function parseInstallEvent(value: unknown): InstallEvent | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { status, message } = value as Record<string, unknown>
  if (!INSTALL_STATUSES.includes(status as InstallEvent['status'])) return undefined
  return {
    status: status as InstallEvent['status'],
    message: typeof message === 'string' ? message.slice(0, 200) : '',
  }
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

export type InstallResult = 'installing' | 'permission' | 'paused' | 'failed'

export interface AppUpdatesOptions {
  /**
   * Where the newest release's files are, ending in `/`, such as
   * `https://github.com/<owner>/<repo>/releases/latest/download/`. It must lie within the
   * releases named in the app's Capacitor config (`plugins.AppUpdater.releases`), which the
   * native side keeps to.
   */
  readonly releases: string
  /** The APK's name in the release, such as `my-game.apk`. */
  readonly apk: string
  /** What happens, for a debug report: builds and outcomes, nothing else. */
  readonly log?: (line: string) => void
}

/** An error as a short line: its code and message, whatever kind of error it is. */
function describe(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error).slice(0, 200)
  const { code, message } = error as { code?: unknown; message?: unknown }
  return [code, message]
    .filter((part) => part !== undefined && part !== '')
    .map(String)
    .join(': ')
    .slice(0, 200)
}

/** An app's updates from its release. */
export class AppUpdates {
  private readonly log: (line: string) => void

  constructor(
    readonly options: AppUpdatesOptions,
    readonly native: UpdaterNative = updaterNative(),
  ) {
    if (!/^https:\/\/\S+\/$/.test(options.releases)) {
      throw new Error('releases must be an HTTPS address ending in /')
    }
    if (!/^[\w.-]+\.apk$/.test(options.apk)) throw new Error('apk must be a file name')
    this.log = options.log ?? (() => {})
  }

  /** The build number and name of the app installed, or null where the native side cannot say. */
  async installed(): Promise<{ build: number; name: string } | null> {
    const info = await this.native.info().catch(() => null)
    if (!info || !Number.isSafeInteger(info.build)) return null
    return { build: info.build, name: typeof info.name === 'string' ? info.name.slice(0, 100) : '' }
  }

  /** Looks for a newer build in the release. Without internet, or with a broken release: failed. */
  async check(): Promise<UpdateCheck> {
    try {
      const [{ build }, { text }] = await Promise.all([
        this.native.info(),
        this.native.fetchText({ url: `${this.options.releases}version.json` }),
      ])
      if (!Number.isSafeInteger(build)) throw new Error('no build number')
      const release = parseRelease(JSON.parse(text))
      if (!release) throw new Error('version.json is not sound')
      this.log(`installed build ${build}, release build ${release.build}`)
      return release.build > build
        ? { kind: 'newer', release, installed: build }
        : { kind: 'current', installed: build }
    } catch (error) {
      this.log(`no update information: ${describe(error)}`)
      return { kind: 'failed' }
    }
  }

  /**
   * The release, if it is newer than the app installed; null if not, and also when there is no
   * internet or anything else fails, so that the app always starts as usual.
   */
  async available(): Promise<Release | null> {
    const check = await this.check()
    return check.kind === 'newer' ? check.release : null
  }

  /**
   * Downloads the release's APK, unless it is already here, and hands it to Android's installer,
   * which asks the player. A download goes on from what an earlier one left. `paused`: the player
   * paused it (`pause`), and calling this again goes on. `permission`: Android first wants the
   * player to allow the app to install apps, in the settings that have just opened;
   * `continueInstall` goes on from there, without downloading again.
   */
  async install(
    release: Release,
    onProgress: (progress: Progress) => void,
  ): Promise<InstallResult> {
    if (!(await this.isDownloaded(release))) {
      const listener = await this.native
        .addListener('progress', (value) => {
          const progress = parseProgress(value)
          if (progress) onProgress(progress)
        })
        .catch(() => null)
      try {
        await this.native.download({
          url: `${this.options.releases}${this.options.apk}`,
          build: release.build,
        })
      } catch (error) {
        if ((error as { code?: unknown })?.code === 'paused') {
          this.log('download paused')
          return 'paused'
        }
        this.log(`download failed: ${describe(error)}`)
        return 'failed'
      } finally {
        await listener?.remove()
      }
      const build = await this.downloadedBuild()
      if (build !== release.build) {
        // The release changed while downloading, or the file is not the app: nothing is installed.
        this.log(`downloaded build ${build}, expected ${release.build}`)
        return 'failed'
      }
    } else {
      this.log(`build ${release.build} is downloaded already`)
    }
    return this.handOver()
  }

  /** Pauses the running download; `install` goes on from there. */
  async pause(): Promise<void> {
    await this.native.pauseDownload().catch(() => {})
  }

  /** Whether the release's APK is downloaded already, ready to install. */
  async isDownloaded(release: Release): Promise<boolean> {
    return (await this.downloadedBuild()) === release.build
  }

  /** The bytes of the release an earlier download left, to go on from; 0 for none. */
  async partialBytes(release: Release): Promise<number> {
    const { bytes } = await this.native
      .partial({ build: release.build })
      .catch(() => ({ bytes: 0 }))
    return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0
  }

  /** What the connection costs now; free if Android cannot say, so as not to scare for nothing. */
  async network(): Promise<Network> {
    const found = await this.native.network().catch(() => null)
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
  async continueInstall(): Promise<InstallResult> {
    const { allowed } = await this.native.canInstall().catch(() => ({ allowed: false }))
    return allowed === true ? this.handOver() : 'permission'
  }

  /** Calls back with what Android's installer says; the result stops listening. */
  async onInstallEvent(listener: (event: InstallEvent) => void): Promise<() => void> {
    const handle = await this.native
      .addListener('install', (value) => {
        const event = parseInstallEvent(value)
        if (!event) return
        this.log(`installer: ${event.status}${event.message ? ` (${event.message})` : ''}`)
        listener(event)
      })
      .catch(() => null)
    return () => void handle?.remove()
  }

  private async handOver(): Promise<InstallResult> {
    try {
      const way = (await this.native.install())?.way
      this.log(`handed to the installer${typeof way === 'string' ? ` (${way.slice(0, 20)})` : ''}`)
      return 'installing'
    } catch (error) {
      this.log(`not installed: ${describe(error)}`)
      return (error as { code?: unknown })?.code === 'permission' ? 'permission' : 'failed'
    }
  }

  private async downloadedBuild(): Promise<number> {
    const { build } = await this.native.downloaded().catch(() => ({ build: -1 }))
    return Number.isSafeInteger(build) ? build : -1
  }
}

/** The dialogs the start of an app may show (see `updateOnStart`). */
export interface StartDialogs {
  /** Asks once whether to look for updates at every start. */
  ask(): Promise<boolean>
  /** Offers a newer version. */
  offer(release: Release): void
}

/** Where the app keeps the player's answer: the game's own settings. */
export interface UpdateChoice {
  /** Whether the player was asked yet. */
  asked(): boolean
  /** Whether to look at every start. */
  enabled(): boolean
  /** Keeps the player's answer to the question at the first start. */
  answer(yes: boolean): void
}

/**
 * At the app's start: asks once, at the first start, whether to look for updates (off unless the
 * player says yes), then looks if that is on, and offers what it finds. Call it in the app only.
 */
export async function updateOnStart(
  updates: AppUpdates,
  choice: UpdateChoice,
  dialogs: StartDialogs,
): Promise<void> {
  if (!choice.asked()) choice.answer(await dialogs.ask())
  if (!choice.enabled()) return
  const release = await updates.available()
  if (release) dialogs.offer(release)
}
