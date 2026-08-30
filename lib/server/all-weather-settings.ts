import fs from "fs"
import path from "path"
import { isContractTenor, type ContractTenor } from "@/lib/all-weather/setup"
import {
  DEFAULT_ALL_WEATHER_VARIANT_ID,
  isDefaultAllWeatherVariant,
  parseAllWeatherVariantId,
  type AllWeatherVariantId,
} from "@/lib/all-weather/variants"

const DATA_ROOT = path.join(process.cwd(), "data", "all-weather")

export type AllWeatherSettings = {
  contractTenor: ContractTenor
}

const DEFAULT_SETTINGS: AllWeatherSettings = {
  contractTenor: "current",
}

function settingsFile(variantId: AllWeatherVariantId) {
  if (isDefaultAllWeatherVariant(variantId)) return path.join(DATA_ROOT, "settings.json")
  return path.join(DATA_ROOT, variantId, "settings.json")
}

function ensureDir(variantId: AllWeatherVariantId) {
  const dir = isDefaultAllWeatherVariant(variantId) ? DATA_ROOT : path.join(DATA_ROOT, variantId)
  fs.mkdirSync(dir, { recursive: true })
}

function parseSettings(raw: Partial<AllWeatherSettings> | null | undefined): AllWeatherSettings {
  return {
    contractTenor: isContractTenor(raw?.contractTenor) ? raw.contractTenor : DEFAULT_SETTINGS.contractTenor,
  }
}

export function readAllWeatherSettings(variantId?: AllWeatherVariantId | null): AllWeatherSettings {
  const id = parseAllWeatherVariantId(variantId)
  const file = settingsFile(id)
  if (!fs.existsSync(file)) {
    if (!isDefaultAllWeatherVariant(id)) return readAllWeatherSettings(DEFAULT_ALL_WEATHER_VARIANT_ID)
    return { ...DEFAULT_SETTINGS }
  }
  try {
    return parseSettings(JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<AllWeatherSettings>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeAllWeatherSettings(
  patch: Partial<AllWeatherSettings>,
  variantId?: AllWeatherVariantId | null,
): AllWeatherSettings {
  const id = parseAllWeatherVariantId(variantId)
  const next: AllWeatherSettings = {
    ...readAllWeatherSettings(id),
    ...patch,
  }
  if (!isContractTenor(next.contractTenor)) next.contractTenor = DEFAULT_SETTINGS.contractTenor
  ensureDir(id)
  fs.writeFileSync(settingsFile(id), JSON.stringify(next, null, 2), "utf-8")
  return next
}
