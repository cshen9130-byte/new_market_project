"use client"

import { InstructionsInitiateView } from "./InstructionsInitiateView"
import { InstructionsListView } from "./InstructionsListView"
import {
  DEFAULT_INSTRUCTION_SIDE,
  INSTRUCTION_SIDE_KEYS,
  type InstructionSideKey,
} from "./instructions-nav"

function resolveSide(side: string): InstructionSideKey {
  if (INSTRUCTION_SIDE_KEYS.has(side)) return side as InstructionSideKey
  return DEFAULT_INSTRUCTION_SIDE
}

export function InstructionsSection({ side }: { side: string }) {
  const resolved = resolveSide(side)

  if (resolved === "cmd-initiate") {
    return <InstructionsInitiateView />
  }

  if (resolved === "cmd-handled") {
    return <InstructionsListView variant="handled" />
  }

  if (resolved === "cmd-mine") {
    return <InstructionsListView variant="mine" />
  }

  return <InstructionsListView variant="all" />
}
