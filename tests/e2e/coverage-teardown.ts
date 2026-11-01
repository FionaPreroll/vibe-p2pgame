import MCR from 'monocart-coverage-reports'
import { coverageOptions, covering } from './coverage'

/** After the browser tests: the coverage every test recorded, as coverage/e2e/lcov.info. */
export default async function teardown(): Promise<void> {
  if (covering) await MCR(coverageOptions).generate()
}
