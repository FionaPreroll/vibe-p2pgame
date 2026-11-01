// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))

/** The Nearby that `bluetooth()` gives the screens: this phone's, on the fake air of a test. */
const phone = vi.hoisted(() => ({ nearby: undefined as unknown }))
vi.mock('../bluetooth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../bluetooth')>()),
  bluetooth: () => phone.nearby,
}))
/** What comes after joining, the game screen and the QR screen, is tested elsewhere. */
const join = vi.hoisted(() => ({ play: vi.fn(), joinScreen: vi.fn() }))
vi.mock('./join', () => join)

const { Nearby, NearbyStartError } = await import('@fionapreroll/p2p-nearby')
const { NearbyAir } = await import('@fionapreroll/p2p-nearby/testing')
const { SERVICE_ID } = await import('../bluetooth')
const { setLanguage } = await import('../i18n')
const { GuestSession } = await import('../session/guest')
const { HostSession } = await import('../session/host')
const { joinedGame } = await import('../session/saved')
const { bluetoothHostDialog, bluetoothJoinScreen, startErrorText } = await import('./bluetoothUi')
type JoinRequest = import('@fionapreroll/p2p-nearby').JoinRequest
type Peer = import('@fionapreroll/p2p-nearby').Peer
type FakeNearby = import('@fionapreroll/p2p-nearby/testing').FakeNearby

/**
 * The Bluetooth screens of the Android app, on the fake Nearby of `@fionapreroll/p2p-nearby`:
 * this phone runs the screen, the other phone is driven by the test, and the game's real
 * sessions join over it.
 */

const later = (ms = 0) => vi.advanceTimersByTimeAsync(ms)
let air: InstanceType<typeof NearbyAir>
let sessions: { close(): void }[] = []

/** This phone, whose Nearby the screens use. */
function thisPhone(id: string): { nearby: InstanceType<typeof Nearby>; fake: FakeNearby } {
  const fake = air.phone(id)
  const nearby = new Nearby({ serviceId: SERVICE_ID }, fake)
  phone.nearby = nearby
  return { nearby, fake }
}

/** Another phone, driven by the test. */
function otherPhone(id: string) {
  const fake = air.phone(id)
  return { nearby: new Nearby({ serviceId: SERVICE_ID }, fake), fake }
}

function button(name: string, within: ParentNode = document): HTMLButtonElement {
  const found = [...within.querySelectorAll('button')].find((b) => b.textContent === name)
  if (!found) throw new Error(`no button "${name}"`)
  return found
}
const status = () => document.querySelector('.status')?.textContent

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  })
  setLanguage('en')
  localStorage.clear()
  document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'app' }))
  air = new NearbyAir()
  join.play.mockReset()
  join.joinScreen.mockReset()
})

afterEach(() => {
  for (const session of sessions) session.close()
  sessions = []
  vi.useRealTimers()
})

describe('startErrorText', () => {
  it('says why Bluetooth did not start, with the code a debug report explains', () => {
    const error = (kind: string, code: string) =>
      new NearbyStartError(kind as InstanceType<typeof NearbyStartError>['kind'], code, '')
    expect(startErrorText(error('permission', 'permission'))).toMatch(/allow.*\(permission\)$/i)
    expect(startErrorText(error('location-off', 'location-off'))).toMatch(
      /location.*\(location-off\)$/i,
    )
    expect(startErrorText(error('bluetooth-off', 'bluetooth-off'))).toMatch(/\(bluetooth-off\)$/)
    expect(startErrorText(error('unavailable', 'unavailable'))).toMatch(/\(unavailable\)$/)
    expect(startErrorText(error('radio', 'nearby-8007'))).toMatch(/\(nearby-8007\)$/)
    // Anything else still gets a text, with what the error says.
    expect(startErrorText(new Error('boom'))).toMatch(/\(boom\)$/)
  })
})

describe('the host’s Bluetooth dialog', () => {
  async function hosting() {
    const host = thisPhone('HOST1')
    const session = new HostSession('Hosty')
    sessions.push(session)
    const parent = document.getElementById('app') as HTMLElement
    bluetoothHostDialog(session, 'Hosty', parent)
    await later()
    return { host, session }
  }

  /** A player phone that finds the host and asks to join, as the game would. */
  async function asking(id: string, name: string) {
    const player = otherPhone(id)
    const found: Peer[] = []
    player.nearby.onFound = (peer) => found.push(peer)
    await player.nearby.look(name)
    await later()
    const dialing = player.nearby.dial(found[0] as Peer, name)
    const joining = GuestSession.join(dialing.connection, name, `token-${id}-123`)
    joining.then((guest) => sessions.push(guest)).catch(() => {})
    await later()
    return { player, dialing, joining }
  }

  it('shows each request with its code, and lets the player in once the host accepts', async () => {
    const { host, session } = await hosting()
    expect(status()).toMatch(/waiting/i)
    expect(host.fake.role).toBe('host')
    const { dialing, joining } = await asking('PLAY1', 'Bo')

    const digits = await dialing.digits
    const row = document.querySelector('.requests li') as HTMLElement
    expect(row.textContent).toContain(`Bo wants to join. Code: ${digits}`)

    button('Accept', row).click()
    expect([...row.querySelectorAll('button')].every((b) => b.disabled)).toBe(true)
    await joining
    await later()
    expect(session.world.players.map((p) => p.name)).toEqual(['Hosty', 'Bo'])
    expect(document.querySelector('.toast')?.textContent).toBe('Bo joined.')
    // In: the dialog closes, and the host stops advertising.
    expect(document.querySelector('.modal')).toBeNull()
    expect(host.fake.role).toBeNull()
  })

  it('turns a player down, and drops a request the player took back', async () => {
    await hosting()
    const first = await asking('PLAY1', 'Bo')
    const second = await asking('PLAY2', 'Cy')
    expect(document.querySelectorAll('.requests li')).toHaveLength(2)

    const bo = [...document.querySelectorAll('.requests li')].find((li) =>
      li.textContent?.includes('Bo'),
    ) as HTMLElement
    button('Reject', bo).click()
    await later()
    await expect(first.joining).rejects.toThrow()
    expect(document.querySelectorAll('.requests li')).toHaveLength(1)

    // Cy's phone gives up: the request goes from the list.
    second.dialing.connection.close()
    await later()
    expect(document.querySelectorAll('.requests li')).toHaveLength(0)
    expect(document.querySelector('.modal')).not.toBeNull()
  })

  it('stops advertising when cancelled, and takes no request after', async () => {
    const { host, session } = await hosting()
    button('Cancel').click()
    await later()
    expect(document.querySelector('.modal')).toBeNull()
    expect(host.fake.role).toBeNull()
    host.fake.emit('request', { endpointId: 'LATE1', name: 'Late', digits: '1234', incoming: true })
    expect(document.querySelector('.requests li')).toBeNull()
    expect(session.world.players).toHaveLength(1)
  })

  it('says why Bluetooth did not start', async () => {
    const host = thisPhone('HOST1')
    host.fake.startError = Object.assign(new Error('no'), { code: 'bluetooth-off' })
    const session = new HostSession('Hosty')
    sessions.push(session)
    bluetoothHostDialog(session, 'Hosty', document.getElementById('app') as HTMLElement)
    await later()
    expect(status()).toMatch(/Bluetooth.*\(bluetooth-off\)$/)
  })
})

describe('the player’s Bluetooth screen', () => {
  /** A host phone advertising its game, letting in whoever asks if `letIn`. */
  async function hostNearby(id: string, name: string, letIn = true) {
    const host = otherPhone(id)
    const session = new HostSession(name)
    sessions.push(session)
    const requests: JoinRequest[] = []
    host.nearby.onRequest = (request) => {
      requests.push(request)
      if (!letIn) return
      const connection = host.nearby.accept(request)
      if (connection) void session.attach(connection).joined.catch(() => {})
    }
    await host.nearby.host(name)
    return { host, session, requests }
  }

  const hostButtons = () =>
    [...document.querySelectorAll('.hosts button')].map((b) => b.textContent)

  it('lists the games nearby, and drops those that went', async () => {
    const one = await hostNearby('HOST1', 'Hosty')
    await hostNearby('HOST2', 'Alba')
    thisPhone('PLAY1')
    bluetoothJoinScreen('Bo', () => {})
    await later()
    expect(status()).toMatch(/looking/i)
    expect(hostButtons().sort()).toEqual(['Alba', 'Hosty'])

    // Found twice: listed once.
    air.announce()
    await later()
    expect(hostButtons()).toHaveLength(2)

    await one.host.nearby.stop()
    air.find('PLAY1')?.emit('lost', { endpointId: 'HOST1' })
    expect(hostButtons()).toEqual(['Alba'])
  })

  it('shows the code while the host compares it, then plays, and remembers the game', async () => {
    const { session } = await hostNearby('HOST1', 'Hosty', false)
    const player = thisPhone('PLAY1')
    bluetoothJoinScreen('Bo', () => {})
    await later()
    button('Hosty').click()
    await later()
    // Looking stops once a game is chosen.
    expect(player.fake.role).toBeNull()
    expect((document.querySelector('.hosts') as HTMLElement).hidden).toBe(true)
    expect(status()).toMatch(/^Code: \d{4}\. Hosty compares it and lets you in\.$/)
    expect(session.world.players).toHaveLength(1)
  })

  it('plays once the host lets the player in, and remembers the game for a rejoin', async () => {
    await hostNearby('HOST1', 'Hosty')
    thisPhone('PLAY1')
    const onLeave = vi.fn()
    bluetoothJoinScreen('Bo', onLeave)
    await later()
    button('Hosty').click()
    await later(100)
    expect(join.play).toHaveBeenCalledOnce()
    const [guest, name, leave] = join.play.mock.calls[0] as [{ host: string }, string, unknown]
    sessions.push(guest as unknown as { close(): void })
    expect(guest.host).toBe('Hosty')
    expect(name).toBe('Bo')
    expect(leave).toBe(onLeave)
    expect(joinedGame()?.host).toBe('Hosty')
  })

  it('says when the host did not let the player in, and looks again on request', async () => {
    const { host, requests } = await hostNearby('HOST1', 'Hosty', false)
    const player = thisPhone('PLAY1')
    bluetoothJoinScreen('Bo', () => {})
    await later()
    button('Hosty').click()
    await later()
    host.nearby.reject(requests[0] as JoinRequest)
    await later()
    expect(join.play).not.toHaveBeenCalled()
    expect(status()).toContain('The host did not let you in, or the connection broke.')

    button('Try again').click()
    await later()
    expect(player.fake.role).toBe('player')
    expect(hostButtons()).toEqual(['Hosty'])
  })

  it('leaves by its back button, or for the QR code, and stops looking', async () => {
    const player = thisPhone('PLAY1')
    const onLeave = vi.fn()
    bluetoothJoinScreen('Bo', onLeave, 'Hosty')
    await later()
    expect(document.querySelector('.join')?.textContent).toContain(
      'Choose Hosty’s game: you get your place and score back.',
    )
    button('Use a QR code instead').click()
    await later()
    expect(player.fake.role).toBeNull()
    expect(join.joinScreen).toHaveBeenCalledWith('Bo', onLeave, { rejoin: 'Hosty' })

    bluetoothJoinScreen('Bo', onLeave)
    await later()
    expect(player.fake.role).toBe('player')
    button('←').click()
    await later()
    expect(player.fake.role).toBeNull()
    expect(onLeave).toHaveBeenCalledOnce()
  })

  it('says why looking did not start, unless the player left already', async () => {
    const player = thisPhone('PLAY1')
    player.fake.startError = Object.assign(new Error('off'), { code: 'location-off' })
    bluetoothJoinScreen('Bo', () => {})
    await later()
    expect(status()).toMatch(/location.*\(location-off\)$/i)

    bluetoothJoinScreen('Bo', () => {})
    button('←').click()
    await later()
    expect(status()).not.toContain('location-off')
  })
})
