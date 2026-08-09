"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { authService } from "@/lib/auth"

export default function ClassicPage() {
  const router = useRouter()

  useEffect(() => {
    const user = authService.getCurrentUser()
    if (!user) {
      router.replace("/login")
    } else if (user.role !== "admin" && !user.permissions?.classic && !user.permissions?.ma) {
      router.replace("/dashboard")
    } else {
      router.replace("/ma/dashboard")
    }
  }, [router])

  return null
}
