import { recordInteractiveUserTraffic } from "@/lib/server/user-activity-priority"
import { abortScheduledEmailParseForUserPriority } from "@/lib/server/scheduled-job-yield-registry"
import { updateSession } from "./supabase/proxy"

export default async function proxy(request: Request) {
  try {
    const url = new URL(request.url)
    const method = request.method
    recordInteractiveUserTraffic(url.pathname, method, request.headers.get("x-market-user-id"))
    const m = method.toUpperCase()
    if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
      abortScheduledEmailParseForUserPriority()
    }
  } catch {
    // never block requests for activity tracking
  }
  return await updateSession(request as any)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
