export const FUTURES_TOP_SECTOR_HREF = "/ma/dashboard/futures-market#section-futures-amount"

export type SectorAmount = { sector: string; amount: number }

export type FuturesTopSectorDay = {
  date: string
  sectors: SectorAmount[]
}

/**
 * The largest block on 商品期货日成交额排行.
 * A tie keeps the sector name that sorts first, so the winner is stable.
 */
export function topSector(day: FuturesTopSectorDay): SectorAmount | null {
  const rows = day.sectors.filter((row) => row.sector && Number.isFinite(row.amount) && row.amount > 0)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || rows.length === 0) return null
  return rows.reduce((best, row) => {
    if (row.amount > best.amount) return row
    if (row.amount === best.amount && row.sector < best.sector) return row
    return best
  })
}

export function futuresTopSectorMessage(input: {
  today: FuturesTopSectorDay
  previous: FuturesTopSectorDay
}): { title: string; body: string; href: string } | null {
  const current = topSector(input.today)
  const prior = topSector(input.previous)
  if (!current || !prior || current.sector === prior.sector) return null
  return {
    title: `${input.today.date} 成交额最大板块换成${current.sector}`,
    body: `${input.today.date} 商品期货日成交额最大的板块是${current.sector}（${formatYi(current.amount)}），上一交易日 ${input.previous.date} 是${prior.sector}（${formatYi(prior.amount)}）。`,
    href: FUTURES_TOP_SECTOR_HREF,
  }
}

function formatYi(amount: number): string {
  return `${(amount / 100_000_000).toFixed(2)}亿`
}
