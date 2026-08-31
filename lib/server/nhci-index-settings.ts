import fs from "fs"
import path from "path"
import { isContractTenor, type ContractTenor } from "@/lib/all-weather/setup"

const DATA_ROOT = path.join(process.cwd(), "data", "nhci-index")
const SETTINGS_FILE = path.join(DATA_ROOT, "settings.json")

export type NhciIndexSettings = {
  contractTenor: ContractTenor
}

const DEFAULT_SETTINGS: NhciIndexSettings = {
  contractTenor: "current",
}

function parseSettings(raw: Partial<NhciIndexSettings> | null | undefined): NhciIndexSettings {
  return {
    contractTenor: isContractTenor(raw?.contractTenor) ? raw.contractTenor : DEFAULT_SETTINGS.contractTenor,
  }
}

export function readNhciIndexSettings(): NhciIndexSettings {
  if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS }
  try {
    return parseSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as Partial<NhciIndexSettings>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeNhciIndexSettings(patch: Partial<NhciIndexSettings>): NhciIndexSettings {
  const next: NhciIndexSettings = {
    ...readNhciIndexSettings(),
    ...patch,
  }
  if (!isContractTenor(next.contractTenor)) next.contractTenor = DEFAULT_SETTINGS.contractTenor
  fs.mkdirSync(DATA_ROOT, { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf-8")
  return next
}
