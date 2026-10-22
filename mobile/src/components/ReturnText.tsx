import { Text } from "react-native"
import { returnColor } from "@/theme"

export function ReturnText({
  text,
  value,
  size = 14,
}: {
  text: string
  value: number | null
  size?: number
}) {
  return <Text style={{ color: returnColor(value), fontSize: size, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{text}</Text>
}
