import { authService } from "@/lib/auth"
import {
  parsePaperState,
  type PaperScope,
  type PaperState,
} from "@/lib/client/paper-trading"

function headers(): Record<string, string> {
  const user = authService.getCurrentUser()
  return user
    ? { "x-market-user-id": user.id, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" }
}

export async function fetchPaperTradingSlices(): Promise<{ team: PaperState; mine: PaperState; userId: string | null }> {
  const res = await fetch("/ma/api/paper-trading", { headers: headers(), cache: "no-store" })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || res.statusText)
  return {
    team: parsePaperState(data?.team),
    mine: parsePaperState(data?.mine),
    userId: typeof data?.userId === "string" ? data.userId : null,
  }
}

export async function savePaperTradingSlice(scope: PaperScope, state: PaperState, knownIds?: string[]) {
  const res = await fetch("/ma/api/paper-trading", {
    method: "PUT",
    headers: headers(),
    cache: "no-store",
    body: JSON.stringify({ scope, state, knownIds }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || res.statusText)
  return data
}
