import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

/** The worker's own file. Browsers fetch it afresh to look for a new version of the game. */
export const WORKER_FILE = 'sw.js'

/**
 * Adds the service worker to production builds: once the game has loaded, it keeps every file of
 * the build, so the game also starts offline, on a hotspot without internet.
 */
export function serviceWorker(): Plugin {
  let outDir = ''
  return {
    name: 'vibe-p2pgame-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    // After the build has written everything, public files included.
    async closeBundle() {
      await writeServiceWorker(outDir)
    },
  }
}

/**
 * Writes the worker into a finished build, with the list of its files and a version made from
 * their contents, so that every change to the game is a new worker.
 */
export async function writeServiceWorker(folder: string): Promise<void> {
  const files = (await filesIn(folder)).filter(
    (file) => file !== WORKER_FILE && !file.endsWith('.map'),
  )
  const hash = createHash('sha256')
  for (const file of files) hash.update(`${file}\n`).update(await readFile(join(folder, file)))
  await writeFile(join(folder, WORKER_FILE), workerSource(files, hash.digest('hex').slice(0, 16)))
}

/** Every file below a folder, as sorted paths with forward slashes. */
async function filesIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

/**
 * The worker as plain JavaScript, as browsers run it. Files are relative to the worker, which
 * sits at the top of the game's folder.
 *
 * - Installing keeps every file in a cache named after the worker's scope and the version,
 *   fetched past the browser's HTTP cache so that no file of an older version slips in.
 * - Activating removes older versions of this scope only: on a shared origin such as
 *   github.io, other sites' caches stay. It then takes over pages that are already open.
 * - Requests inside the scope come from the cache, page loads get index.html, and anything
 *   else goes to the network. Lookups ignore Vary headers: servers such as Vite's vary on the
 *   Origin header, which the game's own module requests carry and the worker's did not.
 * - A new version waits until the page asks it to take over. The game asks as soon as one has
 *   installed, so the next start runs it.
 */
export function workerSource(files: readonly string[], version: string): string {
  return `// vibe-p2pgame's service worker, written by tools/serviceWorker.ts during the build.
const FILES = ${JSON.stringify(files)}
const SCOPE = self.registration.scope
const PREFIX = 'vibe-p2pgame ' + SCOPE + ' '
const CACHE = PREFIX + ${JSON.stringify(version)}
const INDEX = new URL('index.html', SCOPE).href

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' })))),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.match(request.mode === 'navigate' ? INDEX : request, { ignoreVary: true }),
      )
      .then((cached) => cached ?? fetch(request)),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting()
})
`
}
