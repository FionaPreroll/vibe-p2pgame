import { rm } from 'node:fs/promises'
import { covering } from './coverage'

/** Before the browser tests: no coverage of an earlier run is mixed into this one's. */
export default async function setup(): Promise<void> {
  if (covering) await rm('coverage/e2e', { recursive: true, force: true })
}
