import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

/**
 * Server-side Supabase client
 * Creates a new client for each request (important for Fluid compute)
 */
export async function createClient() {
  // Bypass Supabase in dev if enabled
  if (process.env.DEV_AUTH_BYPASS === "true") {
    const email = process.env.DEV_AUTH_EMAIL || "demo.user@example.com"
    return {
      auth: {
        async getUser() {
          return {
            data: { user: { id: "dev-user", email } },
            error: null,
          }
        },
        async signOut() {
          return { error: null }
        },
      },
    } as any
  }

  const cookieStore = await cookies()

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Called from Server Component - can be ignored with proxy
        }
      },
    },
  })
}
