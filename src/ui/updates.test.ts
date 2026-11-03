// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))
vi.mock('../native', () => ({ isApp: () => true }))

const { AppUpdates } = await import('@fionapreroll/app-updates')
const { FakeUpdater } = await import('@fionapreroll/app-updates/testing')
const { handleBack, setBackAction } = await import('../back')
const { setLanguage } = await import('../i18n')
const { forgetSettings, settings } = await import('../settings')
const { RELEASE } = await import('../updates')
const { offer, offerUpdates } = await import('./updates')

/**
 * Spark Hunt's update dialogs, from @fionapreroll/app-updates (whose own tests play them through):
 * in Spark Hunt's words and language, and closed by Android's back button.
 */

const release = { build: 9, commit: 'abc1234', size: 20_000_000 }
const dialog = () => document.querySelector<HTMLElement>('.modal')
const settle = () => vi.advanceTimersByTimeAsync(0)
function button(name: string): HTMLButtonElement {
  const found = [...(dialog()?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent === name && !b.hidden,
  )
  if (!found) throw new Error(`no visible button "${name}"`)
  return found
}
function setup() {
  const fake = new FakeUpdater()
  return { fake, updates: new AppUpdates({ releases: RELEASE, apk: 'spark-hunt.apk' }, fake) }
}

beforeEach(() => {
  vi.useFakeTimers()
  setLanguage('en')
  document.body.replaceChildren()
  localStorage.clear()
  forgetSettings()
  // Dialogs of earlier tests are dropped from the back button's list.
  setBackAction(() => {})
  handleBack(() => {})
})

describe('the question at the first start', () => {
  it('looks for updates at every start only if the player says yes, and is asked once', async () => {
    const { updates, fake } = setup()
    const starting = offerUpdates(updates)
    await settle()
    expect(dialog()?.textContent).toContain('Should Spark Hunt look for a new version')
    button('Yes, look').click()
    await starting
    await settle()
    expect(settings()).toMatchObject({ checkUpdates: true, updatesAsked: true })
    // Build 7 is out: offered, in Spark Hunt's words.
    expect(dialog()?.textContent).toContain('A new version of Spark Hunt is ready (build 7).')
    expect(fake.count('fetchText')).toBe(1)
  })

  it('takes Android’s back button as no', async () => {
    const starting = offerUpdates(setup().updates)
    await settle()
    handleBack(() => {})
    await starting
    expect(dialog()).toBeNull()
    expect(settings()).toMatchObject({ checkUpdates: false, updatesAsked: true })
  })
})

describe('the update dialog', () => {
  it('speaks German, and closes with Android’s back button, pausing nothing that is not running', async () => {
    setLanguage('de')
    const { updates, fake } = setup()
    offer(release, updates)
    await settle()
    expect(dialog()?.textContent).toContain('Der Download ist 20,0 MB groß.')
    handleBack(() => {})
    expect(dialog()).toBeNull()
    expect(fake.count('pauseDownload')).toBe(0)
  })
})
