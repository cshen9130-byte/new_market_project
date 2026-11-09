/** Benchmark groups for the 公募指增 weekly workbook. */

export const PUBLIC_ENHANCED_BUCKET_ORDER = [
  "300指增",
  "500指增",
  "1000指增",
  "2000指增",
  "国证2000指增",
  "A500指增",
  "上证50指增",
  "创业板指增",
  "创业板综指增",
  "科创50指增",
  "科创100指增",
  "科创综指指增",
  "科创创业50指增",
  "中证800指增",
  "中证全指指增",
  "北证50指增",
  "其他指增",
] as const

export type PublicEnhancedBucket = (typeof PUBLIC_ENHANCED_BUCKET_ORDER)[number]

/** Absolute-return sheet. The others are excess versus the bucket benchmark. */
export const PUBLIC_ENHANCED_ABSOLUTE_BUCKET = "其他指增"

export function publicEnhancedBucket(input: {
  benchmark?: string | null
  name?: string | null
  typeL2?: string | null
  trackMethod?: string | null
}): PublicEnhancedBucket | null {
  const type = input.typeL2 ?? ""
  const track = input.trackMethod ?? ""
  const text = `${input.benchmark ?? ""} ${input.name ?? ""}`
  if (/债券|全债|固收/.test(type) || /债券|全债/.test(text)) return null
  const enhanced = track === "增强指数型" || /指数增强|增强指数|增强策略/.test(text)
  if (!enhanced) return null
  if (/科创创业50|双创50/.test(text)) return "科创创业50指增"
  if (/科创板?\s*50|科创50/.test(text)) return "科创50指增"
  if (/科创板?\s*100|科创100/.test(text)) return "科创100指增"
  if (/科创/.test(text)) return "科创综指指增"
  if (/创业板综/.test(text)) return "创业板综指增"
  if (/创业板/.test(text)) return "创业板指增"
  if (/A500|中证A500/.test(text)) return "A500指增"
  if (/国证2000/.test(text)) return "国证2000指增"
  if (/中证2000|(?<!国证)2000指数/.test(text)) return "2000指增"
  if (/1000/.test(text)) return "1000指增"
  if (/小盘500/.test(text)) return "其他指增"
  if (/中证500|500指数/.test(text)) return "500指增"
  if (/沪深300|中证300/.test(text)) return "300指增"
  if (/中证800/.test(text)) return "中证800指增"
  if (/中证全指|中证A股指数/.test(text)) return "中证全指指增"
  if (/北证50/.test(text)) return "北证50指增"
  if (/上证50/.test(text)) return "上证50指增"
  return "其他指增"
}
