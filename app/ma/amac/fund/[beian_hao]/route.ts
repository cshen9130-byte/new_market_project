import { NextResponse } from "next/server"
import { amacFundSearchUrl } from "@/lib/amac-urls"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type AmacFundResult = {
  url?: string | null
}

type AmacFundResponse = {
  content?: AmacFundResult[]
}

function resolveAmacFundPageUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path
  return `https://gs.amac.org.cn${path.startsWith("/") ? path : `/${path}`}`
}

async function lookupAmacFundUrl(registerNumber: string): Promise<string | null> {
  const res = await fetch(
    "https://gs.amac.org.cn/amac-infodisc/api/pof/fund?page=0&size=5",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://gs.amac.org.cn/amac-infodisc/res/pof/fund/index.html",
        "User-Agent": "Mozilla/5.0 (compatible; MarketWebsite/1.0)",
      },
      body: JSON.stringify({ keywordCode: registerNumber }),
      cache: "no-store",
    },
  )

  if (!res.ok) return null

  const data = (await res.json()) as AmacFundResponse
  const match = data.content?.find((item) => item.url)
  return match?.url ? resolveAmacFundPageUrl(match.url) : null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  const { beian_hao } = await params
  const fallback = amacFundSearchUrl(beian_hao)

  if (!beian_hao) {
    return NextResponse.redirect(fallback, 302)
  }

  try {
    const directUrl = await lookupAmacFundUrl(beian_hao)
    if (directUrl) {
      return NextResponse.redirect(directUrl, 302)
    }
  } catch {
    // Fall back to AMAC search page.
  }

  return NextResponse.redirect(fallback, 302)
}
