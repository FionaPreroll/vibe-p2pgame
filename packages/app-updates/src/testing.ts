import type { Network, UpdaterNative } from './index.ts'

/**
 * AppUpdaterPlugin without a phone, for tests of games: `FakeUpdater` plays the native side, with
 * an installed build, a release, a download the test lets finish, fail or pause, the right to
 * install apps, and Android's installer, whose answers the test sends. Give it to
 * `new AppUpdates(options, fake)`.
 */
export class FakeUpdater implements UpdaterNative {
  /** The app installed. */
  installedBuild = 5
  /** The release's version.json, or an error to throw, as without internet. */
  release: string | Error = '{"build":7,"commit":"0123abc"}'
  /** The build of the APK downloaded, or -1. */
  cached = -1
  /** The bytes an earlier download left. */
  partialBytes = 0
  /** Whether Android lets the app install apps. */
  allowed = true
  connection: Network = { online: true, metered: false, cellular: false }
  /** Whether downloads finish by themselves, or wait for `finish`, `fail` or a pause. */
  autoFinish = false
  /** What the test may look at: every call, by method. */
  readonly calls: { method: string; options?: unknown }[] = []

  private readonly listeners = new Map<string, Set<(value: unknown) => void>>()
  private finishDownload: ((build: number) => void) | undefined
  private failDownload: ((error: unknown) => void) | undefined

  count(method: string): number {
    return this.calls.filter((call) => call.method === method).length
  }

  async info() {
    this.calls.push({ method: 'info' })
    return { build: this.installedBuild, name: `${this.installedBuild}-test` }
  }

  async fetchText(options: { url: string }) {
    this.calls.push({ method: 'fetchText', options })
    if (this.release instanceof Error) throw this.release
    return { text: this.release }
  }

  download(options: { url: string; build: number }): Promise<void> {
    this.calls.push({ method: 'download', options })
    return new Promise((resolve, reject) => {
      this.finishDownload = (build) => {
        this.cached = build
        resolve()
      }
      this.failDownload = reject
      if (this.autoFinish) {
        this.progress(500, 1000)
        this.progress(1000, 1000)
        this.finish(options.build)
      }
    })
  }

  /** Lets the running download finish, leaving that build in the cache. */
  finish(build: number): void {
    const done = this.finishDownload
    this.finishDownload = this.failDownload = undefined
    done?.(build)
  }

  /** Lets the running download fail. */
  fail(error: unknown): void {
    const failed = this.failDownload
    this.finishDownload = this.failDownload = undefined
    failed?.(error)
  }

  async pauseDownload() {
    this.calls.push({ method: 'pauseDownload' })
    this.fail(Object.assign(new Error('Paused'), { code: 'paused' }))
  }

  async partial(options: { build: number }) {
    this.calls.push({ method: 'partial', options })
    return { bytes: this.partialBytes }
  }

  async network() {
    this.calls.push({ method: 'network' })
    return this.connection
  }

  async downloaded() {
    this.calls.push({ method: 'downloaded' })
    return { build: this.cached }
  }

  async canInstall() {
    this.calls.push({ method: 'canInstall' })
    return { allowed: this.allowed }
  }

  async install() {
    this.calls.push({ method: 'install' })
    if (!this.allowed) throw Object.assign(new Error('Not allowed'), { code: 'permission' })
    if (this.cached < 0) throw Object.assign(new Error('Nothing downloaded'), { code: 'nothing' })
    return { way: 'session' }
  }

  async addListener(event: 'progress' | 'install', listener: (value: unknown) => void) {
    this.calls.push({ method: 'addListener', options: event })
    const set = this.listeners.get(event) ?? new Set()
    this.listeners.set(event, set)
    set.add(listener)
    return { remove: async () => void set.delete(listener) }
  }

  /** Tells the download's progress, as the native side does; also values that are not sound. */
  progress(done: unknown, total: unknown): void {
    this.emit('progress', { done, total })
  }

  /** Answers as Android's installer does: `confirm`, `success`, `aborted` or `failure`. */
  installer(status: unknown, message = ''): void {
    this.emit('install', { status, message })
  }

  /** How many listen to an event now. */
  listening(event: 'progress' | 'install'): number {
    return this.listeners.get(event)?.size ?? 0
  }

  emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value)
  }
}
