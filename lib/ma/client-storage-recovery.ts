/** Clear MA dashboard client caches that can crash renders when corrupted. */
export function clearMaClientCaches(options?: { keepLogin?: boolean }): void {
  if (typeof window === "undefined") return
  const keepLogin = options?.keepLogin !== false
  const login = keepLogin ? localStorage.getItem("currentUser") : null

  for (const key of Object.keys(localStorage)) {
    if (
      key.startsWith("tracking_list_cache:") ||
      key.startsWith("tracking_") ||
      key.startsWith("inv_") ||
      key.startsWith("ops_") ||
      key.startsWith("dd_diligence_") ||
      key.startsWith("ma_fund_compares") ||
      key.startsWith("portfolio_metric_templates") ||
      key.startsWith("private_fund_mgr_favorites") ||
      key.startsWith("fof_underlying_favorites") ||
      key.startsWith("tracking_mgr_favorites")
    ) {
      localStorage.removeItem(key)
    }
  }

  if (login) localStorage.setItem("currentUser", login)
}
