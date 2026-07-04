import { useCallback, useEffect } from "react"

/**
 * Fetch chart data on mount/deps change, then silently refresh every minute
 * while the tab is visible (also on window focus / tab visibility).
 */
export function useChartAutoRefresh(
  loadFn: (showLoading: boolean) => void | Promise<void>,
  deps: React.DependencyList,
  intervalMs = 60_000,
) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loadFn, deps)

  useEffect(() => {
    void load(true)
  }, [load])

  useEffect(() => {
    const handleFocus = () => {
      void load(false)
    }
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void load(false)
      }
    }

    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibility)

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(false)
      }
    }, intervalMs)

    return () => {
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibility)
      window.clearInterval(timer)
    }
  }, [load, intervalMs])
}
