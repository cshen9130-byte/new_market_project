import type { FactorDmlReport } from "@/lib/ma/quant-factor-dml"

type Hit = {
  name: string
  family: string
  how: string
  theta: number | null
  outcome: "direction" | "intensity"
  verdict: "used" | "dependent" | "confounded" | "timing" | "absent"
}

function hitsOf(report: FactorDmlReport): Hit[] {
  const rowOf = new Map(report.rows.map((r) => [r.id, r]))
  return (report.audit?.factors ?? []).map((f) => {
    const row = rowOf.get(f.id)
    return {
      name: f.name,
      family: row?.family ?? "",
      how: f.how,
      theta: row?.theta ?? null,
      outcome: f.outcome,
      verdict: f.verdict,
    }
  })
}

function isLocation(h: Hit): boolean {
  return /通道|布林|MAD|距.+高点|距.+低点/.test(h.name)
}

function isMaOrMom(h: Hit): boolean {
  return /偏离MA|偏离EMA|MACD|日动量|日反转|趋势效率|动量加速/.test(h.name)
}

function isIndex(h: Hit): boolean {
  return h.family === "市场" || h.name.startsWith("南华")
}

/**
 * What the factor audit implies for the portrait label and the rule-based
 * strategy inference. Names a mechanism, not the catalog.
 */
export function readFactorSupport(
  report: FactorDmlReport | null | undefined,
  strategyLabel: string,
): { portrait: string; inference: string } | null {
  if (!report?.audit || !report.tested) return null
  const hits = hitsOf(report)
  const used = hits.filter((h) => h.verdict === "used")
  const location = used.filter((h) => h.outcome === "direction" && isLocation(h))
  const locPos = location.filter((h) => (h.theta ?? 0) > 0)
  const locNeg = location.filter((h) => (h.theta ?? 0) < 0)
  const buyStrength = locPos.length >= 2 && locPos.length > locNeg.length
  const sellStrength = locNeg.length >= 2 && locNeg.length > locPos.length
  const threshold = location.some((h) => /最高档/.test(h.how))
  const steepShort = used.some((h) => h.family === "动量" && /高位|变陡/.test(h.how))
  const indexUsed = used.some(isIndex)
  const indexTiedToMarket = hits.some((h) => isIndex(h) && (h.verdict === "confounded" || h.verdict === "timing"))
  const maConfounded = hits.some((h) => h.verdict === "confounded" && isMaOrMom(h))
  const longBeta = strategyLabel.includes("商品多头")
  const shortBeta = strategyLabel.includes("逆商品")
  const hedged = strategyLabel.includes("多空")

  let portrait: string
  if (!used.length) {
    portrait = `「${strategyLabel}」来自对冲度和与南华的收益相关。因子检验没有留下一条能单独站住的开仓规则，所以这个标签还不是某条可复核的入场公式。`
  } else if (buyStrength) {
    const book = hedged
      ? "账面多空对锁，说的是库存两边都有。因子结果说明对锁之后剩下的净敞口不是中性的：品种越靠近自己近期区间的上沿，或越高于自身波动带，下一交易日净开仓越偏多。"
      : "净开仓跟着品种自己的价格位置：越靠近近期区间上沿，或越高于自身波动带，下一交易日越偏多。"
    const trigger = threshold
      ? "较长的通道不是每天按位置加减，只在最高一档才加多，更像突破触发。"
      : "这条关系大体是线性的，位置越高，加得越多。"
    let beta: string
    if (longBeta && !indexUsed && indexTiedToMarket) {
      beta = "这支持「商品多头 beta」，但 beta 不是一条南华交易规则。南华动量没有通过方向检验：长的和没开仓日子里市场自己的涨跌分不开，短的只影响开不开仓。和指数正相关，是因为买的是正在走强的品种，这些品种本身跟着商品指数。"
    } else if (longBeta && indexUsed) {
      beta = "南华动量本身也进了开仓规则，商品多头 beta 里有一条直接的指数成分，不只有品种涨跌带出来的暴露。"
    } else if (shortBeta) {
      beta = "开仓在买强势，和「逆商品」的收益相关是反的。逆指数的盈亏更可能来自持有的空头腿或板块配置，不是这条开仓信号。"
    } else {
      beta = indexTiedToMarket
        ? "南华动量没有单独指挥方向，指数暴露是买强势品种时带出来的。"
        : "方向暴露来自这些品种自身的位置，而不是一条单独的指数动量。"
    }
    portrait = `${book}${trigger}${beta}`
  } else if (sellStrength) {
    portrait = hedged
      ? "多空库存之外，净开仓在价格偏高时偏空，剩下的方向是高位减多或加空。若收益仍呈商品多头 beta，那是持仓库存带来的，不是开仓信号。"
      : "价格越靠近区间上沿，净开仓越偏空，开仓在做高位回落，不是追涨。"
  } else {
    portrait = `因子层有开仓规则，但方向不完全站在一边，不能单独把「${strategyLabel}」收成追涨或做回落。`
  }

  const trend = !used.length
    ? "策略推断里的入场规则，没有在因子层被确认。只在简单两比例检验里显著、却和没开仓日子的涨跌分不开的，不能当成这个账户自己的入场。"
    : maConfounded
      ? `策略推断把均线、动量和突破收成同一趋势族。因子层把这族拆开了：能留下的是价格在自身区间里的位置${threshold ? "。较长的通道只在最上档才加多，其余位置仍是越高越加" : ""}。均线偏离和原始动量跟没开仓时市场自己的收益分不开，所以「追均线」不是一条独立规则。`
      : "因子层和规则检验指向同一类入场：净开仓跟着价格位置，而不是一组互相无关的信号。"
  const horizon = steepShort
    ? "短窗口到高位才变陡，用得上的是数日到数周的位置，不是百日趋势，和短周期持仓相符。"
    : buyStrength
      ? "用上的是数周以内的区间位置，不是百日动量。商品多头 beta 因此不是长趋势持有指数。"
      : ""
  const bookVol = "成交量和波动率没有进入净开仓方向，做多还是做空不是某个波动因子在决定。市场变吵时降不降总敞口，仍是上面那条组合风控，两件事不是同一个信号。"
  const inference = [trend, horizon, bookVol].filter(Boolean).join("")

  return { portrait, inference }
}
