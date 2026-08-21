import { AsyncLocalStorage } from "node:async_hooks"

export type RiskDataSource = "mom" | "account"

export const riskSourceAls = new AsyncLocalStorage<RiskDataSource>()

export function getRiskSource(): RiskDataSource {
  return riskSourceAls.getStore() ?? "mom"
}

export function parseSourceFromRequest(req: Request): RiskDataSource {
  try {
    const url = new URL(req.url)
    if (url.searchParams.get("source") === "account") return "account"
    if (req.headers.get("x-risk-source") === "account") return "account"
  } catch {
    // ignore malformed URLs
  }
  return "mom"
}

export function withRiskSource<H extends (req: Request) => Promise<Response>>(
  handler: H,
): H {
  return (async (req: Request) => {
    const source = parseSourceFromRequest(req)
    return riskSourceAls.run(source, () => handler(req))
  }) as H
}
