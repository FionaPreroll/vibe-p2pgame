import { describe, expect, it } from 'vitest'
import { Seats } from './seats.ts'

describe('Seats', () => {
  it('gives new players new ids', () => {
    const seats = new Seats()
    expect(seats.claim('a')).toEqual({ id: 1, rejoined: false })
    expect(seats.claim('b')).toEqual({ id: 2, rejoined: false })
  })

  it('gives a player who comes back their id', () => {
    const seats = new Seats()
    const { id } = seats.claim('a')
    seats.claim('b')
    seats.leave({ token: 'a', id, name: 'Ada' })
    expect(seats.awaySeats().map((s) => s.name)).toEqual(['Ada'])
    expect(seats.claim('a')).toEqual({ id, rejoined: true })
    expect(seats.awaySeats()).toEqual([])
    expect(seats.claim('c').id).toBe(3)
  })

  it('starts after the ids of players kept from a saved game', () => {
    const seats = new Seats(1, [{ token: 'a', id: 4, name: 'Ada' }])
    expect(seats.next).toBe(5)
    expect(seats.claim('new').id).toBe(5)
    expect(seats.claim('a')).toEqual({ id: 4, rejoined: true })
  })
})
