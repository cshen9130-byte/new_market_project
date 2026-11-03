export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { ensureDevPostgresTunnel } = await import("./lib/server/dev-prod-db-tunnel")
  await ensureDevPostgresTunnel().catch((err) => {
    console.error("[dev-db]", err instanceof Error ? err.message : err)
  })

  // Production PM2 runs crons in `new_market_project_worker` (RUN_BACKGROUND_JOBS=0 on web).
  // Local `next dev` / single-process deploys keep the previous in-process scheduler.
  // The four default IV charts still capture here, so their minutes are stored
  // when this process is the one serving the page.
  if (process.env.RUN_BACKGROUND_JOBS === "0") {
    const { registerDefaultIvMinuteCapture } = await import("./lib/server/background-jobs-scheduler")
    registerDefaultIvMinuteCapture()
    console.log(
      "[background-jobs] skipped in next-server (RUN_BACKGROUND_JOBS=0) — use PM2 worker",
    )
    return
  }

  const { registerBackgroundJobs } = await import("./lib/server/background-jobs-scheduler")
  await registerBackgroundJobs()
}
