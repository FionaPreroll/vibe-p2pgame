import { describe, expect, it } from 'vitest'
import { MAX_AGE_MS, parseHostedGame, parseJoinedGame } from './saved'

const NOW = 1_800_000_000_000

describe('parseJoinedGame', () => {
  it('offers a recent game, and not an old or broken one', () => {
    expect(parseJoinedGame({ host: 'Ada', savedAt: NOW - 1000 }, NOW)).toEqual({
      host: 'Ada',
      savedAt: NOW - 1000,
    })
    expect(parseJoinedGame({ host: 'Ada', savedAt: NOW - MAX_AGE_MS }, NOW)).toBeNull()
    expect(parseJoinedGame({ host: 'Ada', savedAt: NOW + 1000 }, NOW)).toBeNull()
    expect(parseJoinedGame({ host: 3, savedAt: NOW }, NOW)).toBeNull()
    expect(parseJoinedGame(undefined, NOW)).toBeNull()
  })
})

describe('parseHostedGame', () => {
  const game = {
    savedAt: NOW - 60_000,
    hostScore: 4,
    nextId: 3,
    players: [
      { token: 'aaaa', id: 1, name: 'Bo', score: 2 },
      { token: 'bbbb', id: 2, name: 'Cy', score: 0 },
    ],
  }

  it('reads a saved game', () => {
    expect(parseHostedGame(game, NOW)).toEqual(game)
  })

  it('drops old games and anything malformed', () => {
    expect(parseHostedGame({ ...game, savedAt: NOW - MAX_AGE_MS - 1 }, NOW)).toBeNull()
    expect(parseHostedGame({ ...game, nextId: -1 }, NOW)).toBeNull()
    expect(parseHostedGame({ ...game, hostScore: 1.5 }, NOW)).toBeNull()
    expect(parseHostedGame({ ...game, players: 'none' }, NOW)).toBeNull()
    expect(
      parseHostedGame({ ...game, players: [{ token: 'x', id: 0, name: 'Host', score: 0 }] }, NOW),
    ).toBeNull()
    expect(parseHostedGame({ ...game, players: [{ token: 'x', id: 1, score: 0 }] }, NOW)).toBeNull()
  })
})
