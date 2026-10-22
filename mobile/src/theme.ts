export const colors = {
  bg: "#F3F0EA",
  card: "#FFFcf7",
  text: "#1C1917",
  muted: "#7A756E",
  line: "#E4DDD2",
  navy: "#1A1814",
  ink: "#1A1814",
  gold: "#9A7B4F",
  up: "#B42318",
  down: "#067647",
  flat: "#7A756E",
  chip: "#EBE6DC",
  chipOn: "#1A1814",
  dangerBg: "#F8EBE8",
  danger: "#9F1239",
  upBg: "#F8EBE8",
  downBg: "#E7F4EC",
}

export function returnColor(value: number | null): string {
  if (value == null || value === 0) return colors.flat
  return value > 0 ? colors.up : colors.down
}

export function returnBg(value: number | null): string {
  if (value == null || value === 0) return colors.chip
  return value > 0 ? colors.upBg : colors.downBg
}
