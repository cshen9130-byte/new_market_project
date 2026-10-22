"use client"

import { useEffect, useState } from "react"
import { Avatar, AvatarImage } from "@/components/ui/avatar"

export function UserAvatar({
  avatarUrl,
  className,
}: {
  name?: string | null
  avatarUrl?: string | null
  className?: string
  fallbackClassName?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [avatarUrl])

  if (!avatarUrl || failed) return null
  return (
    <Avatar className={className}>
      <AvatarImage
        src={avatarUrl}
        alt=""
        onLoadingStatusChange={(status) => {
          if (status === "error") setFailed(true)
        }}
      />
    </Avatar>
  )
}
