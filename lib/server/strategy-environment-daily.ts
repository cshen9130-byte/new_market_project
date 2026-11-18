/**
 * Rebuild the strategy-environment snapshot: eight scores plus each sleeve's
 * peer NAV curve. The page only reads the snapshot, so this is the slow part.
 */

import { loadStrategyCompare } from "@/lib/server/strategy-environment-compare"
import { loadStrategyEnvironment } from "@/lib/server/strategy-environment"
import { readStrategySnapshot } from "@/lib/server/strategy-environment-snapshot"

const FRESH_MS = 18 * 60 * 60 * 1000

let running: Promise<void> | null = null

export async function refreshStrategyEnvironmentDaily(force = false): Promise<void> {
  if (!force) {
    const existing = await readStrategySnapshot("board")
    if (existing && Date.now() - existing.updatedAt < FRESH_MS) {
      console.log("[strategy-environment] snapshot is under 18h old, skip")
      return
    }
  }
  const started = Date.now()
  const data = await loadStrategyEnvironment(true)
  console.log(`[strategy-environment] board asOf=${data.asOf ?? "none"} in ${Date.now() - started}ms`)
  for (const item of data.strategies) {
    const step = Date.now()
    try {
      const compare = await loadStrategyCompare(item.key, [])
      console.log(
        `[strategy-environment] compare ${item.key} points=${compare?.points.length ?? 0} peers=${compare?.peerCount ?? 0} in ${Date.now() - step}ms`,
      )
    } catch (err) {
      console.error(`[strategy-environment] compare ${item.key}`, err)
    }
  }
  console.log(`[strategy-environment] daily snapshot done in ${Date.now() - started}ms`)
}

export function runScheduledStrategyEnvironment(): void {
  if (running) {
    console.log("[strategy-environment] daily snapshot already running")
    return
  }
  running = refreshStrategyEnvironmentDaily(false)
    .catch((err) => console.error("[strategy-environment] daily snapshot failed", err))
    .finally(() => {
      running = null
    })
}
