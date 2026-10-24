"use client"

import { useEffect, useState } from "react"

type BridgeUser = {
  id?: string
  name?: string
  email?: string
  role?: string
  permissions?: Record<string, unknown>
}

export default function OpenMomBriefingPage() {
  const [message, setMessage] = useState("正在打开 MOM 简报…")

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "")
    if (!raw) {
      setMessage("缺少登录信息，请从手机版 MOM 每日风控重新打开。")
      return
    }
    let user: BridgeUser
    try {
      user = JSON.parse(decodeURIComponent(raw)) as BridgeUser
    } catch {
      setMessage("登录信息无法识别，请从手机版重新打开。")
      return
    }
    const id = String(user?.id || "").trim()
    if (!id || id.length > 80) {
      setMessage("登录信息无法识别，请从手机版重新打开。")
      return
    }
    localStorage.setItem("currentUser", JSON.stringify({
      id,
      name: String(user.name || ""),
      email: String(user.email || ""),
      role: user.role,
      permissions: user.permissions,
    }))
    try {
      window.sessionStorage.setItem("momEmbedBriefing", "1")
    } catch {}
    window.location.replace("/ma/dashboard/mom-analysis/risk-report?tab=briefing&embed=1")
  }, [])

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "sans-serif" }}>
      <p>{message}</p>
    </main>
  )
}
