export const INSTRUCTION_SIDE_ITEMS = [
  { key: "cmd-initiate", label: "发起指令" },
  { key: "cmd-handled", label: "我处理的" },
  { key: "cmd-mine", label: "我发起的" },
  { key: "cmd-all", label: "所有指令" },
] as const

export type InstructionSideKey = (typeof INSTRUCTION_SIDE_ITEMS)[number]["key"]

export const INSTRUCTION_SIDE_KEYS = new Set<string>(
  INSTRUCTION_SIDE_ITEMS.map((item) => item.key),
)

export const DEFAULT_INSTRUCTION_SIDE: InstructionSideKey = "cmd-initiate"
