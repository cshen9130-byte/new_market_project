import { loadStrategySnapshot, type StrategySnapshot } from "./universe"

export const DEFAULT_ALL_WEATHER_VARIANT_ID = "vol9-20m" as const

export const ALL_WEATHER_VARIANTS = [
  {
    id: "vol9-20m",
    label: "9% · 2000万",
    hint: "波动目标 9% · 模拟资金 2000 万",
    name: "全天候策略 · 四袖套等权25浮动10-40",
    initialCapital: 20_000_000,
    volTarget: 0.09,
    enforceSleeveFloor: false,
  },
  {
    id: "vol5-10m",
    label: "5% · 1000万",
    hint: "波动目标 5% · 模拟资金 1000 万",
    name: "全天候策略 · 四袖套等权25浮动10-40 · 波动5%",
    initialCapital: 10_000_000,
    volTarget: 0.05,
    enforceSleeveFloor: true,
  },
] as const

export type AllWeatherVariantId = (typeof ALL_WEATHER_VARIANTS)[number]["id"]
export type AllWeatherVariant = (typeof ALL_WEATHER_VARIANTS)[number]

export const ALL_WEATHER_VARIANT_IDS = ALL_WEATHER_VARIANTS.map((item) => item.id)

export function isAllWeatherVariantId(value: unknown): value is AllWeatherVariantId {
  return ALL_WEATHER_VARIANTS.some((item) => item.id === value)
}

export function parseAllWeatherVariantId(value: unknown): AllWeatherVariantId {
  return isAllWeatherVariantId(value) ? value : DEFAULT_ALL_WEATHER_VARIANT_ID
}

export function isDefaultAllWeatherVariant(id: AllWeatherVariantId) {
  return id === DEFAULT_ALL_WEATHER_VARIANT_ID
}

export function getAllWeatherVariant(id?: AllWeatherVariantId | null): AllWeatherVariant {
  const resolved = parseAllWeatherVariantId(id)
  return ALL_WEATHER_VARIANTS.find((item) => item.id === resolved) ?? ALL_WEATHER_VARIANTS[0]
}

export function formatCapitalWan(capital: number) {
  return `${Math.round(capital / 10_000)} 万`
}

export function variantEnforcesSleeveFloor(id?: AllWeatherVariantId | null) {
  return Boolean(getAllWeatherVariant(id).enforceSleeveFloor)
}

/** Same universe and risk mix as the 9% snapshot; leverage scales with vol target. */
export function loadVariantSnapshot(variantId?: AllWeatherVariantId | null): StrategySnapshot {
  const variant = getAllWeatherVariant(variantId)
  const src = loadStrategySnapshot()
  if (isDefaultAllWeatherVariant(variant.id)) return src

  const factor = src.volTarget > 0 ? variant.volTarget / src.volTarget : 1
  return {
    ...src,
    name: variant.name,
    initialCapital: variant.initialCapital,
    volTarget: variant.volTarget,
    volMandate: src.volMandate * factor,
    positions: src.positions.map((pos) => ({
      ...pos,
      targetWeight: pos.targetWeight * factor,
      weightShare: pos.weightShare * factor,
      riskContrib: pos.riskContrib * factor,
    })),
  }
}
