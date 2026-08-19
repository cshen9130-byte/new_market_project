import { NextResponse } from "next/server"

import { getIndexSpotRealtime } from "@/lib/server/index-spot-realtime"
import { getQvixRealtime } from "@/lib/server/qvix-realtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const [spotRes, ivRes] = await Promise.allSettled([getIndexSpotRealtime(), getQvixRealtime()])
  const spots = spotRes.status === "fulfilled" ? spotRes.value : {}
  const iv = ivRes.status === "fulfilled" ? ivRes.value : {}
  const errors = [
    spotRes.status === "rejected" ? String(spotRes.reason?.message || spotRes.reason) : null,
    ivRes.status === "rejected" ? String(ivRes.reason?.message || ivRes.reason) : null,
  ].filter(Boolean)
  return NextResponse.json({
    ok: true,
    spots,
    iv,
    error: errors.length ? errors.join("；") : undefined,
  })
}
