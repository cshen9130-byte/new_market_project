import snapshot from "./strategy-snapshot.json"

export type SnapshotPosition = (typeof snapshot.positions)[number]
export type StrategySnapshot = typeof snapshot

export function loadNhciSnapshot(): StrategySnapshot {
  return snapshot
}
