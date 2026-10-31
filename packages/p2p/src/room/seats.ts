/**
 * Who has a place in a hosted game, by the token each browser keeps for itself. A player who
 * drops out keeps their place: rejoining with the same token gives back their id, and with it
 * whatever the game keeps under that id, such as a color or a score.
 */
export interface Seat {
  readonly token: string
  readonly id: number
  readonly name: string
}

export interface Claim {
  readonly id: number
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
      return { id: seat.id, rejoined: true }
    }
    return { id: this.nextId++, rejoined: false }
  }

  /** Keeps the place of a player who left, for when they come back. */
  leave(seat: Seat): void {
    this.away.set(seat.token, seat)
  }

  /** Players who left and may come back, in the order they joined. */
  awaySeats(): Seat[] {
    return [...this.away.values()].sort((a, b) => a.id - b.id)
  }

  get next(): number {
    return this.nextId
  }
}
