/** Minimal registry so the edge proxy can abort scheduled ETL without importing the full job module. */

type YieldHandle = {
  abort: AbortController
  yieldToUserTraffic: boolean
}

declare global {
  // eslint-disable-next-line no-var
  var __scheduledEmailParseYield: YieldHandle | undefined
}

export function registerScheduledEmailParseYield(
  abort: AbortController,
  yieldToUserTraffic: boolean,
): void {
  globalThis.__scheduledEmailParseYield = { abort, yieldToUserTraffic }
}

export function clearScheduledEmailParseYield(): void {
  globalThis.__scheduledEmailParseYield = undefined
}

export function abortScheduledEmailParseForUserPriority(): void {
  const run = globalThis.__scheduledEmailParseYield
  if (!run?.yieldToUserTraffic) return
  console.log(
    "[email-parse-fetch-job] user mutation detected — aborting scheduled ETL immediately",
  )
  run.abort.abort(new DOMException("yielded to user traffic", "AbortError"))
}
