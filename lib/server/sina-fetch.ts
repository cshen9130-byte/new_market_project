export const SINA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

export async function sinaGet(url: string, referer = "https://finance.sina.com.cn") {
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": SINA_UA,
      Referer: referer,
    },
  })
  if (!res.ok) throw new Error(`sina ${res.status}`)
  return res.text()
}

export function chinaWallToUnix(day: string) {
  const [datePart, clockPart = "00:00:00"] = day.trim().split(/\s+/)
  const [year, month, date] = datePart.split("-").map(Number)
  const [hour, minute] = clockPart.split(":").map(Number)
  if (![year, month, date, hour, minute].every((n) => Number.isFinite(n))) return null
  return Math.floor(Date.UTC(year, month - 1, date, hour, minute, 0) / 1000)
}
