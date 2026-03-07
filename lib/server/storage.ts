import path from "path"

const DEFAULT_STORAGE_ROOT = path.resolve(process.cwd(), "..", "market_dashboard_storage")

export function getServerStorageRoot() {
  return path.resolve(process.env.MARKET_DASHBOARD_STORAGE_DIR || DEFAULT_STORAGE_ROOT)
}

export function getServerStorageDisplayRoot() {
  return process.env.MARKET_DASHBOARD_STORAGE_DIR?.trim() || "服务器部署时由 MARKET_DASHBOARD_STORAGE_DIR 指定"
}

export function getServerStoragePath(...segments: string[]) {
  return path.join(getServerStorageRoot(), ...segments)
}