import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export default async function Home() {
  if (process.env.DEV_AUTH_BYPASS === "true") {
    redirect("/dashboard")
    return null
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect("/dashboard")
  } else {
    // No login module; render home for unauthenticated users
    return null
  }
}
