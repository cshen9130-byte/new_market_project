/**
 * Caps how many quant-strategy SQL calls run at once.
 * One account used to open ~18 queries, and the page fired the core and full
 * requests together, so Postgres pool clients waited past connectionTimeoutMillis
 * and failed with "timeout exceeded when trying to connect".
 */
export class QuerySlots {
  private active = 0
  private waiters: Array<() => void> = []

  constructor(private readonly limit: number) {}

  acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  release(): void {
    this.active = Math.max(0, this.active - 1)
    const next = this.waiters.shift()
    if (next) next()
  }
}

export async function usingQuerySlots<T>(slots: QuerySlots, fn: () => Promise<T>): Promise<T> {
  await slots.acquire()
  try {
    return await fn()
  } finally {
    slots.release()
  }
}
