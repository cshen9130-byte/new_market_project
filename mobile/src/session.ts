import type { User } from "@/types"

export type Session = {
  baseUrl: string
  user: User | null
}

let current: Session = { baseUrl: "", user: null }

export function getSession(): Session {
  return current
}

export function setSession(next: Session) {
  current = next
}
