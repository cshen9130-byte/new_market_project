import { pinyin } from "pinyin-pro"

/** Two-character surnames. A following given name is still reduced to initials. */
const COMPOUND_SURNAMES = [
  "欧阳", "太史", "端木", "上官", "司马", "东方", "独孤", "南宫", "万俟", "闻人", "夏侯", "诸葛",
  "尉迟", "公羊", "赫连", "澹台", "皇甫", "宗政", "濮阳", "公冶", "太叔", "申屠", "公孙", "慕容",
  "仲孙", "钟离", "长孙", "宇文", "司徒", "鲜于", "司空", "闾丘", "子车", "亓官", "司寇", "巫马",
  "公西", "颛孙", "壤驷", "公良", "漆雕", "乐正", "宰父", "谷梁", "拓跋", "夹谷", "轩辕", "令狐",
  "段干", "百里", "呼延", "东郭", "南门", "羊舌", "微生", "公户", "公玉", "公仪", "梁丘", "公仲",
  "公上", "公门", "公山", "公坚", "左丘", "公伯", "西门", "公祖", "第五", "公乘", "贯丘", "公皙",
  "南荣", "东里", "东宫", "仲长", "子书", "子桑", "即墨", "达奚", "褚师",
].sort((a, b) => b.length - a.length)

function initialOf(ch: string): string {
  if (/[\u4e00-\u9fff]/.test(ch)) {
    const letter = pinyin(ch, { pattern: "first", toneType: "none", type: "array" })
    const text = Array.isArray(letter) ? letter[0] : letter
    return String(text ?? "").slice(0, 1).toLowerCase()
  }
  if (/[A-Za-z]/.test(ch)) return ch.toLowerCase()
  return ""
}

/**
 * Keep the surname and replace the given name with lowercase pinyin initials.
 * 温雪琴 → 温xq. 罗双 → 罗s. A name with no Chinese characters is left as written.
 */
export function maskPersonName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim().replace(/\s+/g, "")
  if (!trimmed || !/[\u4e00-\u9fff]/.test(trimmed)) return trimmed
  const compound = COMPOUND_SURNAMES.find((item) => trimmed.startsWith(item) && trimmed.length > item.length)
  const surname = compound ?? [...trimmed][0]
  const initials = [...trimmed.slice(surname.length)].map(initialOf).join("")
  return `${surname}${initials}`
}
