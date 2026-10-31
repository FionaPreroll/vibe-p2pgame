import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { serviceWorker, workerSource, writeServiceWorker } from './serviceWorker.ts'

const SCOPE = 'https://example.com/game/'
const CACHE = `vibe-p2pgame ${SCOPE} v2`

interface FakeRequest {
  readonly url: string
  readonly method?: string
  readonly mode?: string
  readonly cache?: string
}

/**
 * Runs the worker's code against a stand-in for the browser's worker scope. Responses are
 * strings: "file …" from the cache, "network …" from the network.
 */
function startWorker(caches: Map<string, Map<string, string>> = new Map()) {
  const listeners = new Map<string, (event: object) => void>()
  const added: FakeRequest[] = []
  const lookups: unknown[] = []
  const cacheStorage = {
    async open(name: string) {
      const entries = caches.get(name) ?? new Map<string, string>()
      caches.set(name, entries)
      return {
        async addAll(requests: FakeRequest[]) {
          added.push(...requests)
          for (const request of requests) entries.set(request.url, `file ${request.url}`)
        },
        async match(key: string | FakeRequest, options?: unknown) {
          lookups.push(options)
          return entries.get(typeof key === 'string' ? key : key.url)
        },
      }
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
  }
  const self = {
    registration: { scope: SCOPE },
    clients: { claim: vi.fn(async () => {}) },
    skipWaiting: vi.fn(async () => {}),
    addEventListener: (type: string, listener: (event: object) => void) => {
      listeners.set(type, listener)
    },
  }
  class Request {
    readonly url: string
    readonly cache: string | undefined
    constructor(url: string, init?: { cache?: string }) {
      this.url = new URL(url, SCOPE).href
      this.cache = init?.cache
    }
  }
  const network = vi.fn(async (request: FakeRequest) => `network ${request.url}`)
  const code = workerSource(['index.html', 'assets/game.js'], 'v2')
  new Function('self', 'caches', 'Request', 'fetch', code)(self, cacheStorage, Request, network)

  /** Fires an event at the worker and waits for what it waits on; returns its response. */
  async function fire(type: string, fields: object = {}): Promise<string | undefined> {
    let waited: Promise<unknown> = Promise.resolve()
    let response: Promise<string> | undefined
    listeners.get(type)?.({
      ...fields,
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise
      },
      respondWith: (promise: Promise<string>) => {
        response = promise
      },
    })
    await waited
    return response
  }
  const get = (url: string, mode = 'cors') =>
    fire('fetch', { request: { method: 'GET', url, mode } })
  return { caches, added, lookups, self, network, fire, get }
}

describe('service worker', () => {
  it('keeps every file of the build when it installs, past the HTTP cache', async () => {
    const worker = startWorker()
    await worker.fire('install')
    expect([...(worker.caches.get(CACHE)?.keys() ?? [])]).toEqual([
      `${SCOPE}index.html`,
      `${SCOPE}assets/game.js`,
    ])
    expect(worker.added.map((request) => request.cache)).toEqual(['reload', 'reload'])
  })

  it('serves files and page loads from the cache, and the rest from the network', async () => {
    const worker = startWorker()
    await worker.fire('install')
    expect(await worker.get(`${SCOPE}assets/game.js`)).toBe(`file ${SCOPE}assets/game.js`)
    expect(await worker.get(`${SCOPE}?from=home`, 'navigate')).toBe(`file ${SCOPE}index.html`)
    expect(await worker.get(`${SCOPE}assets/new.js`)).toBe(`network ${SCOPE}assets/new.js`)
    // Module requests carry an Origin header that the worker's own requests did not.
    expect(worker.lookups).toEqual(Array(3).fill({ ignoreVary: true }))
  })

  it('leaves other requests and other sites on the origin alone', async () => {
    const worker = startWorker()
    await worker.fire('install')
    const post = { request: { method: 'POST', url: `${SCOPE}assets/game.js`, mode: 'cors' } }
    expect(await worker.fire('fetch', post)).toBeUndefined()
    expect(await worker.get('https://example.com/other/app.js')).toBeUndefined()
    expect(worker.network).not.toHaveBeenCalled()
  })

  it('removes older versions of its own scope, then takes over open pages', async () => {
    const old = `vibe-p2pgame ${SCOPE} v1`
    const elsewhere = 'vibe-p2pgame https://example.com/other/ v1'
    const worker = startWorker(
      new Map([
        [old, new Map()],
        [elsewhere, new Map()],
        ['another-app', new Map()],
        [CACHE, new Map()],
      ]),
    )
    await worker.fire('activate')
    expect([...worker.caches.keys()]).toEqual([elsewhere, 'another-app', CACHE])
    expect(worker.self.clients.claim).toHaveBeenCalledOnce()
  })

  it('takes over only when the page asks', async () => {
    const worker = startWorker()
    await worker.fire('message', { data: 'hello' })
    expect(worker.self.skipWaiting).not.toHaveBeenCalled()
    await worker.fire('message', { data: 'skipWaiting' })
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce()
  })
})

describe('writeServiceWorker', () => {
  let folder = ''
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  const versionOf = (code: string) => /const CACHE = PREFIX \+ "([0-9a-f]+)"/.exec(code)?.[1]

  it('lists the files of a build, without itself and source maps, and versions them', async () => {
    folder = await mkdtemp(join(tmpdir(), 'vibe-laser-sw-'))
    await mkdir(join(folder, 'assets'))
    await writeFile(join(folder, 'index.html'), '<!doctype html>')
    await writeFile(join(folder, 'assets', 'game.js'), 'play()')
    await writeFile(join(folder, 'assets', 'game.js.map'), '{}')
    await writeFile(join(folder, 'sw.js'), 'an older worker')
    await writeServiceWorker(folder)
    const first = await readFile(join(folder, 'sw.js'), 'utf8')
    expect(first).toContain('const FILES = ["assets/game.js","index.html"]')

    await writeServiceWorker(folder)
    expect(versionOf(await readFile(join(folder, 'sw.js'), 'utf8'))).toBe(versionOf(first))
    await writeFile(join(folder, 'assets', 'game.js'), 'play(); win()')
    await writeServiceWorker(folder)
    expect(versionOf(await readFile(join(folder, 'sw.js'), 'utf8'))).not.toBe(versionOf(first))
  })

  it('runs as a build plugin once the build is written', async () => {
    folder = await mkdtemp(join(tmpdir(), 'vibe-laser-sw-'))
    await mkdir(join(folder, 'out'))
    await writeFile(join(folder, 'out', 'index.html'), '<!doctype html>')
    const plugin = serviceWorker()
    expect(plugin.apply).toBe('build')
    const configResolved = plugin.configResolved as (config: object) => void
    configResolved({ root: folder, build: { outDir: 'out' } })
    await (plugin.closeBundle as () => Promise<void>)()
    expect(await readFile(join(folder, 'out', 'sw.js'), 'utf8')).toContain('["index.html"]')
  })
})
