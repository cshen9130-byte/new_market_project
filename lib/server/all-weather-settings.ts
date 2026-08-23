import fs from "fs"
import path from "path"
import { isContractTenor, type ContractTenor } from "@/lib/all-weather/setup"

const DATA_DIR = path.join(process.cwd(), "data", "all-weather")
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json")

export type AllWeatherSettings = {
  contractTenor: ContractTenor
}

const DEFAULT_SETTINGS: AllWeatherSettings = {
  contractTenor: "current",
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function readAllWeatherSettings(): AllWeatherSettings {
  if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as Partial<AllWeatherSettings>
    return {
      contractTenor: isContractTenor(raw.contractTenor) ? raw.contractTenor : DEFAULT_SETTINGS.contractTenor,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeAllWeatherSettings(patch: Partial<AllWeatherSettings>): AllWeatherSettings {
  const next: AllWeatherSettings = {
    ...readAllWeatherSettings(),
    ...patch,
  }
  if (!isContractTenor(next.contractTenor)) next.contractTenor = DEFAULT_SETTINGS.contractTenor
  ensureDir()
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf-8")
  return next
}
