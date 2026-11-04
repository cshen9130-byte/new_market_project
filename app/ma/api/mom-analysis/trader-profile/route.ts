import { runTraderProfile } from "@/lib/server/trader-profile-run"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(req: Request) {
  return runTraderProfile(req, { source: "mom" })
}
