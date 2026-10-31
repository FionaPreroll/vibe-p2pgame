/**
 * Who has a place in a hosted game, by the token each browser keeps for itself. A player who
 * drops out keeps their place: rejoining with the same token gives back their id, and with it
 * their color and their score, even in the middle of a round.
 */
export interface Seat {
  readonly token: string
  readonly id: number
  readonly name: string
  readonly score: number
}

export interface Claim {
  readonly id: number
  readonly score: number
  readonly rejoined: boolean
}

export class Seats {
  private readonly away = new Map<string, Seat>()

  constructor(
    private nextId = 1,
    away: readonly Seat[] = [],
  ) {
    for (const seat of away) {
      this.away.set(seat.token, seat)
      this.nextId = Math.max(this.nextId, seat.id + 1)
    }
  }

  /** A place for a player who says hello: their old one if they had one, or a new one. */
  claim(token: string): Claim {
    const seat = this.away.get(token)
    if (seat) {
      this.away.delete(token)
      return { id: seat.id, score: seat.score, rejoined: true }
    }
    return { id: this.nextId++, score: 0, rejoined: false }
  }

  /** Keeps the place of a player who left, for when they come back. */
  leave(seat: Seat): void {
    this.away.set(seat.token, seat)
  }

  /** Players who left and may come back, in the order they joined. */
  awaySeats(): Seat[] {
    return [...this.away.values()].sort((a, b) => a.id - b.id)
  }

  /** A new round starts from nothing for everyone, away or not. */
  resetScores(): void {
    for (const [token, seat] of this.away) this.away.set(token, { ...seat, score: 0 })
  }

  get next(): number {
    return this.nextId
  }
}
