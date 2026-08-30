import type { AllWeatherVariantId } from "./variants"
import { loadVariantSnapshot } from "./variants"
import type { SnapshotPosition, StrategySnapshot } from "./universe"
import { IM_SPEC } from "./universe"

export const LIVE_UNIVERSE_VERSION = 3

const DROP_BONDS = new Set(["TL", "TF", "TS"])

function scalePosition(pos: SnapshotPosition, newRisk: number): SnapshotPosition {
  const factor = pos.riskShare > 0 ? newRisk / pos.riskShare : 1
  return {
    ...pos,
    targetWeight: pos.targetWeight * factor,
    weightShare: pos.weightShare * factor,
    riskContrib: pos.riskContrib * factor,
    riskShare: newRisk,
  }
}

function makeIm(ic: SnapshotPosition, newRisk: number): SnapshotPosition {
  return {
    asset: "IM",
    label: "中证1000 IM",
    sleeve: "Equity",
    lots: 0,
    price: IM_SPEC.refPrice,
    multiplier: IM_SPEC.multiplier,
    marginRate: IM_SPEC.marginRate,
    notional: 0,
    margin: 0,
    targetWeight: ic.targetWeight,
    weightShare: ic.weightShare,
    assetVol: 0.38,
    riskContrib: ic.riskContrib,
    riskShare: newRisk,
    backtestPnl: 0,
  }
}

export function applyLiveUniverse(src: StrategySnapshot): StrategySnapshot {
  const droppedBonds = src.positions.filter((p) => DROP_BONDS.has(p.asset))
  const kept = src.positions.filter((p) => !DROP_BONDS.has(p.asset))
  const icPos = kept.find((p) => p.asset === "IC")
  const tPos = kept.find((p) => p.asset === "T")
  const bondRisk = (tPos?.riskShare ?? 0) + droppedBonds.reduce((sum, p) => sum + p.riskShare, 0)

  const positions: SnapshotPosition[] = []
  for (const pos of kept) {
    if (pos.asset === "T" && bondRisk > 0) {
      positions.push(scalePosition(pos, bondRisk))
      continue
    }
    if (pos.asset === "IC" && icPos) {
      positions.push(pos)
      positions.push(makeIm(pos, pos.riskShare))
      continue
    }
    positions.push(pos)
  }

  const specs = src.specs.some((s) => s.asset === "IM") ? src.specs : [...src.specs, IM_SPEC]
  const lastBudget = { ...src.lastBudget }
  for (const sleeve of ["Equity", "Bonds", "Gold", "Commodity"] as const) {
    lastBudget[sleeve] = positions.filter((p) => p.sleeve === sleeve).reduce((sum, p) => sum + p.riskShare, 0)
  }
  return {
    ...src,
    universe: "U25+T+IM",
    positions,
    specs,
    lastBudget,
  }
}

export function loadLiveStrategySnapshot(variantId?: AllWeatherVariantId | null): StrategySnapshot {
  return applyLiveUniverse(loadVariantSnapshot(variantId))
}

export function universeKey(positions: Array<{ asset: string }>) {
  return positions
    .map((p) => p.asset)
    .sort()
    .join(",")
}
