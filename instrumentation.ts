export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // Production PM2 runs crons in `new_market_project_worker` (RUN_BACKGROUND_JOBS=0 on web).
  // Local `next dev` / single-process deploys keep the previous in-process scheduler.
  if (process.env.RUN_BACKGROUND_JOBS === "0") {
    console.log(
      "[background-jobs] skipped in next-server (RUN_BACKGROUND_JOBS=0) — use PM2 worker",
    )
    return
  }

  const { registerBackgroundJobs } = await import("./lib/server/background-jobs-scheduler")
  await registerBackgroundJobs()
}
