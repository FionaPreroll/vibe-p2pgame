import { describe, expect, it } from 'vitest'
import { Seats } from './seats'

describe('Seats', () => {
  it('gives new players new ids', () => {
    const seats = new Seats()
    expect(seats.claim('a')).toEqual({ id: 1, score: 0, rejoined: false })
    expect(seats.claim('b')).toEqual({ id: 2, score: 0, rejoined: false })
  })

  it('gives a player who comes back their id and score', () => {
    const seats = new Seats()
    const { id } = seats.claim('a')
    seats.claim('b')
    seats.leave({ token: 'a', id, name: 'Ada', score: 7 })
    expect(seats.awaySeats().map((s) => s.name)).toEqual(['Ada'])
    expect(seats.claim('a')).toEqual({ id, score: 7, rejoined: true })
    expect(seats.awaySeats()).toEqual([])
    expect(seats.claim('c').id).toBe(3)
  })

  it('starts after the ids of players kept from a saved game', () => {
    const seats = new Seats(1, [{ token: 'a', id: 4, name: 'Ada', score: 2 }])
    expect(seats.claim('new').id).toBe(5)
    expect(seats.claim('a')).toEqual({ id: 4, score: 2, rejoined: true })
  })

  it('resets the scores of players away when a round starts', () => {
    const seats = new Seats()
    seats.leave({ token: 'a', id: 1, name: 'Ada', score: 7 })
    seats.resetScores()
    expect(seats.claim('a').score).toBe(0)
  })
})
