import { getNavFieldValue, type NavRow, type BenchmarkPoint } from "./shared"
import { buildAlignedBenchmarkValues, formatDateRange } from "./performanceChartUtils"

export interface PeriodStatBlock {
  periodRet: number
  annRet: number
  annVol: number
  sharpe: number
  calmar: number
  downsideRisk: number
  maxDD: number
  ddRecoveryDays: number | null
  longestNoNewHighDays: number
  maxDDInterval: string
  ddRecoveryInterval: string | null
  longestNoNewHighInterval: string
  sortino: number
  correlation: number
  infoRatio: number
  trackingError: number
  alpha: number
  beta: number
  skewness: number
  kurtosis: number
  var95: number
}

export interface PeriodStatsResult {
  dateRange: string
  fund: PeriodStatBlock
  bench: PeriodStatBlock | null
  excess: PeriodStatBlock | null
}

export function computePeriodStats(
  rows: NavRow[],
  navType: string,
  benchmarkData: BenchmarkPoint[],
  hasBenchmark: boolean,
  excessByDivision: boolean,
): PeriodStatsResult | null {
  if (rows.length < 3) return null

  const _mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
  const _std = (arr: number[], ddof = 1): number => {
    if (arr.length <= ddof) return NaN
    const m = _mean(arr)
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - ddof))
  }
  const _skew = (arr: number[]): number => {
    if (arr.length < 3) return NaN
    const m = _mean(arr)
    const s = _std(arr)
    if (!isFinite(s) || s === 0) return NaN
    return arr.reduce((sum, v) => sum + ((v - m) / s) ** 3, 0) / arr.length
  }
  const _kurt = (arr: number[]): number => {
    if (arr.length < 4) return NaN
    const m = _mean(arr)
    const s = _std(arr)
    if (!isFinite(s) || s === 0) return NaN
    return arr.reduce((sum, v) => sum + ((v - m) / s) ** 4, 0) / arr.length - 3
  }
  const _var95 = (arr: number[]): number => {
    if (arr.length < 5) return NaN
    return [...arr].sort((a, b) => a - b)[Math.floor(arr.length * 0.05)]
  }

  const navVals = rows.map((r) => getNavFieldValue(r, navType))
  const dateTsArr = rows.map((r) => new Date(r.price_date).getTime())
  const totalDays = (dateTsArr[dateTsArr.length - 1] - dateTsArr[0]) / 86400000
  const years = Math.max(totalDays / 365.25, 1 / 365)

  const gaps = []
  for (let i = 1; i < dateTsArr.length; i++) gaps.push((dateTsArr[i] - dateTsArr[i - 1]) / 86400000)
  gaps.sort((a, b) => a - b)
  const medGap = gaps[Math.floor(gaps.length / 2)] || 1
  const ppy = medGap <= 2 ? 252 : medGap <= 10 ? 52 : medGap <= 20 ? 26 : medGap <= 45 ? 12 : 4

  const fundRets: number[] = []
  for (let i = 1; i < navVals.length; i++) {
    fundRets.push(navVals[i - 1] > 0 ? navVals[i] / navVals[i - 1] - 1 : 0)
  }

  const fundPeriodRet = navVals[navVals.length - 1] / navVals[0] - 1
  const fundAnnRet = Math.pow(1 + fundPeriodRet, 1 / years) - 1
  const fundAnnVol = fundRets.length > 1 ? _std(fundRets) * Math.sqrt(ppy) : NaN
  const RF = 0.02
  const fundSharpe = isFinite(fundAnnVol) && fundAnnVol > 0 ? (fundAnnRet - RF) / fundAnnVol : NaN

  let peak = navVals[0]
  let peakTs = dateTsArr[0]
  let maxDD = 0
  let troughTs = dateTsArr[0]
  let maxDDPeakVal = navVals[0]
  let maxDDPeakTs = dateTsArr[0]
  let longestNoNewHigh = 0
  let curHighTs = dateTsArr[0]
  let longestNoNewHighStartTs = dateTsArr[0]
  let longestNoNewHighEndTs = dateTsArr[0]
  for (let i = 0; i < navVals.length; i++) {
    if (navVals[i] > peak) {
      peak = navVals[i]
      peakTs = dateTsArr[i]
      curHighTs = dateTsArr[i]
    } else {
      const d = (dateTsArr[i] - curHighTs) / 86400000
      if (d > longestNoNewHigh) {
        longestNoNewHigh = d
        longestNoNewHighStartTs = curHighTs
        longestNoNewHighEndTs = dateTsArr[i]
      }
    }
    const dd = (peak - navVals[i]) / peak
    if (dd > maxDD) {
      maxDD = dd
      troughTs = dateTsArr[i]
      maxDDPeakVal = peak
      maxDDPeakTs = peakTs
    }
  }
  let ddRecoveryDays: number | null = null
  let ddRecoveryEndTs: number | null = null
  for (let i = 0; i < navVals.length; i++) {
    if (dateTsArr[i] > troughTs && navVals[i] >= maxDDPeakVal) {
      ddRecoveryDays = Math.round((dateTsArr[i] - troughTs) / 86400000)
      ddRecoveryEndTs = dateTsArr[i]
      break
    }
  }

  const fundCalmar = maxDD > 0 ? fundAnnRet / maxDD : NaN
  const downRets = fundRets.filter((r) => r < 0)
  const fundDsr = downRets.length > 0
    ? Math.sqrt(downRets.reduce((s, r) => s + r * r, 0) / downRets.length) * Math.sqrt(ppy)
    : 0
  const fundSortino = fundDsr > 0 ? (fundAnnRet - RF) / fundDsr : NaN

  const fund: PeriodStatBlock = {
    periodRet: fundPeriodRet,
    annRet: fundAnnRet,
    annVol: fundAnnVol,
    sharpe: fundSharpe,
    calmar: fundCalmar,
    downsideRisk: fundDsr,
    maxDD,
    ddRecoveryDays,
    longestNoNewHighDays: Math.round(longestNoNewHigh),
    maxDDInterval: formatDateRange(maxDDPeakTs, troughTs),
    ddRecoveryInterval: ddRecoveryEndTs !== null ? formatDateRange(troughTs, ddRecoveryEndTs) : null,
    longestNoNewHighInterval: formatDateRange(longestNoNewHighStartTs, longestNoNewHighEndTs),
    sortino: fundSortino,
    correlation: NaN,
    infoRatio: NaN,
    trackingError: NaN,
    alpha: NaN,
    beta: NaN,
    skewness: _skew(fundRets),
    kurtosis: _kurt(fundRets),
    var95: _var95(fundRets),
  }

  let bench: PeriodStatBlock | null = null
  let excess: PeriodStatBlock | null = null

  if (hasBenchmark && benchmarkData.length) {
    const benchAligned = buildAlignedBenchmarkValues(rows, benchmarkData, "nav", navType)
    const baseIdx = benchAligned.findIndex((v) => v !== null)

    if (baseIdx >= 0 && baseIdx < navVals.length - 1) {
      const fRetsAl: number[] = []
      const bRetsAl: number[] = []
      for (let i = Math.max(1, baseIdx); i < benchAligned.length; i++) {
        const bp = benchAligned[i - 1]
        const bc = benchAligned[i]
        if (bp !== null && bc !== null && bp > 0) {
          fRetsAl.push(navVals[i] / navVals[i - 1] - 1)
          bRetsAl.push(bc / bp - 1)
        }
      }

      const bLevels: Array<{ v: number; ts: number }> = []
      for (let i = 0; i < benchAligned.length; i++) {
        if (benchAligned[i] !== null) bLevels.push({ v: benchAligned[i]!, ts: dateTsArr[i] })
      }

      if (bLevels.length >= 2 && bRetsAl.length >= 2) {
        const bPeriodRet = bLevels[bLevels.length - 1].v / bLevels[0].v - 1
        const bAnnRet = Math.pow(1 + bPeriodRet, 1 / years) - 1
        const bAnnVol = _std(bRetsAl) * Math.sqrt(ppy)
        const bSharpe = isFinite(bAnnVol) && bAnnVol > 0 ? (bAnnRet - RF) / bAnnVol : NaN

        let bPeak = bLevels[0].v
        let bPeakTs = bLevels[0].ts
        let bMaxDD = 0
        let bTroughTs = bLevels[0].ts
        let bMaxDDPeakVal = bLevels[0].v
        let bMaxDDPeakTs = bLevels[0].ts
        let bLongestNoNewHigh = 0
        let bCurHighTs = bLevels[0].ts
        let bLongestNoNewHighStartTs = bLevels[0].ts
        let bLongestNoNewHighEndTs = bLevels[0].ts
        for (const { v, ts } of bLevels) {
          if (v > bPeak) {
            bPeak = v
            bPeakTs = ts
            bCurHighTs = ts
          } else {
            const d = (ts - bCurHighTs) / 86400000
            if (d > bLongestNoNewHigh) {
              bLongestNoNewHigh = d
              bLongestNoNewHighStartTs = bCurHighTs
              bLongestNoNewHighEndTs = ts
            }
          }
          const dd = (bPeak - v) / bPeak
          if (dd > bMaxDD) {
            bMaxDD = dd
            bTroughTs = ts
            bMaxDDPeakVal = bPeak
            bMaxDDPeakTs = bPeakTs
          }
        }
        let bDDRecoveryDays: number | null = null
        let bDDRecoveryEndTs: number | null = null
        for (const { v, ts } of bLevels) {
          if (ts > bTroughTs && v >= bMaxDDPeakVal) {
            bDDRecoveryDays = Math.round((ts - bTroughTs) / 86400000)
            bDDRecoveryEndTs = ts
            break
          }
        }

        const bCalmar = bMaxDD > 0 ? bAnnRet / bMaxDD : NaN
        const bDownRets = bRetsAl.filter((r) => r < 0)
        const bDsr = bDownRets.length > 0
          ? Math.sqrt(bDownRets.reduce((s, r) => s + r * r, 0) / bDownRets.length) * Math.sqrt(ppy)
          : 0
        const bSortino = bDsr > 0 ? (bAnnRet - RF) / bDsr : NaN

        const mf = _mean(fRetsAl)
        const mb = _mean(bRetsAl)
        const cov = fRetsAl.reduce((s, v, i) => s + (v - mf) * (bRetsAl[i] - mb), 0) / fRetsAl.length
        const sf = _std(fRetsAl)
        const sb = _std(bRetsAl)
        const corr = isFinite(sf) && sf > 0 && isFinite(sb) && sb > 0 ? cov / (sf * sb) : NaN
        const varB = bRetsAl.reduce((s, v) => s + (v - mb) ** 2, 0) / bRetsAl.length
        const beta = varB > 0 ? cov / varB : NaN
        const alpha = isFinite(beta) ? fundAnnRet - (RF + beta * (bAnnRet - RF)) : NaN

        const excessRets = excessByDivision
          ? fRetsAl.map((r, i) => (1 + r) / (1 + bRetsAl[i]) - 1)
          : fRetsAl.map((r, i) => r - bRetsAl[i])
        const trackingError = excessRets.length > 1 ? _std(excessRets) * Math.sqrt(ppy) : NaN
        const excessAnnRet = excessByDivision
          ? Math.pow((1 + fundPeriodRet) / (1 + bPeriodRet), 1 / years) - 1
          : fundAnnRet - bAnnRet
        const infoRatio = isFinite(trackingError) && trackingError > 0 ? excessAnnRet / trackingError : NaN

        if (excessByDivision && excessRets.length >= 2) {
          const exPeriodRet = (1 + fundPeriodRet) / (1 + bPeriodRet) - 1
          const exAnnRet = Math.pow(1 + exPeriodRet, 1 / years) - 1
          const exAnnVol = _std(excessRets) * Math.sqrt(ppy)
          const exSharpe = isFinite(exAnnVol) && exAnnVol > 0 ? (exAnnRet - RF) / exAnnVol : NaN

          const exLevels: Array<{ v: number; ts: number }> = []
          let exNav = 1
          let retIdx = 0
          for (let i = Math.max(1, baseIdx); i < benchAligned.length; i++) {
            const bp = benchAligned[i - 1]
            const bc = benchAligned[i]
            if (bp !== null && bc !== null && bp > 0 && navVals[i - 1] > 0) {
              if (exLevels.length === 0) exLevels.push({ v: 1, ts: dateTsArr[i - 1] })
              exNav *= 1 + excessRets[retIdx]
              exLevels.push({ v: exNav, ts: dateTsArr[i] })
              retIdx++
            }
          }

          let exPeak = exLevels[0]?.v ?? 1
          let exPeakTs = exLevels[0]?.ts ?? dateTsArr[0]
          let exMaxDD = 0
          let exTroughTs = exPeakTs
          let exMaxDDPeakVal = exPeak
          let exMaxDDPeakTs = exPeakTs
          let exLongestNoNewHigh = 0
          let exCurHighTs = exPeakTs
          let exLongestNoNewHighStartTs = exPeakTs
          let exLongestNoNewHighEndTs = exPeakTs
          for (const { v, ts } of exLevels) {
            if (v > exPeak) {
              exPeak = v
              exPeakTs = ts
              exCurHighTs = ts
            } else {
              const d = (ts - exCurHighTs) / 86400000
              if (d > exLongestNoNewHigh) {
                exLongestNoNewHigh = d
                exLongestNoNewHighStartTs = exCurHighTs
                exLongestNoNewHighEndTs = ts
              }
            }
            const dd = (exPeak - v) / exPeak
            if (dd > exMaxDD) {
              exMaxDD = dd
              exTroughTs = ts
              exMaxDDPeakVal = exPeak
              exMaxDDPeakTs = exPeakTs
            }
          }
          let exDDRecoveryDays: number | null = null
          let exDDRecoveryEndTs: number | null = null
          for (const { v, ts } of exLevels) {
            if (ts > exTroughTs && v >= exMaxDDPeakVal) {
              exDDRecoveryDays = Math.round((ts - exTroughTs) / 86400000)
              exDDRecoveryEndTs = ts
              break
            }
          }

          const exCalmar = exMaxDD > 0 ? exAnnRet / exMaxDD : NaN
          const exDownRets = excessRets.filter((r) => r < 0)
          const exDsr = exDownRets.length > 0
            ? Math.sqrt(exDownRets.reduce((s, r) => s + r * r, 0) / exDownRets.length) * Math.sqrt(ppy)
            : 0
          const exSortino = exDsr > 0 ? (exAnnRet - RF) / exDsr : NaN

          excess = {
            periodRet: exPeriodRet,
            annRet: exAnnRet,
            annVol: exAnnVol,
            sharpe: exSharpe,
            calmar: exCalmar,
            downsideRisk: exDsr,
            maxDD: exMaxDD,
            ddRecoveryDays: exDDRecoveryDays,
            longestNoNewHighDays: Math.round(exLongestNoNewHigh),
            maxDDInterval: formatDateRange(exMaxDDPeakTs, exTroughTs),
            ddRecoveryInterval: exDDRecoveryEndTs !== null ? formatDateRange(exTroughTs, exDDRecoveryEndTs) : null,
            longestNoNewHighInterval: formatDateRange(exLongestNoNewHighStartTs, exLongestNoNewHighEndTs),
            sortino: exSortino,
            correlation: NaN,
            infoRatio: NaN,
            trackingError: NaN,
            alpha: NaN,
            beta: NaN,
            skewness: _skew(excessRets),
            kurtosis: _kurt(excessRets),
            var95: _var95(excessRets),
          }
        }

        bench = {
          periodRet: bPeriodRet,
          annRet: bAnnRet,
          annVol: bAnnVol,
          sharpe: bSharpe,
          calmar: bCalmar,
          downsideRisk: bDsr,
          maxDD: bMaxDD,
          ddRecoveryDays: bDDRecoveryDays,
          longestNoNewHighDays: Math.round(bLongestNoNewHigh),
          maxDDInterval: formatDateRange(bMaxDDPeakTs, bTroughTs),
          ddRecoveryInterval: bDDRecoveryEndTs !== null ? formatDateRange(bTroughTs, bDDRecoveryEndTs) : null,
          longestNoNewHighInterval: formatDateRange(bLongestNoNewHighStartTs, bLongestNoNewHighEndTs),
          sortino: bSortino,
          correlation: 1,
          infoRatio: NaN,
          trackingError: 0,
          alpha: 0,
          beta: 1,
          skewness: _skew(bRetsAl),
          kurtosis: _kurt(bRetsAl),
          var95: _var95(bRetsAl),
        }
        fund.correlation = corr
        fund.infoRatio = infoRatio
        fund.trackingError = trackingError
        fund.alpha = alpha
        fund.beta = beta
      }
    }
  }

  return {
    dateRange: `${rows[0].price_date} ~ ${rows[rows.length - 1].price_date}`,
    fund,
    bench,
    excess,
  }
}
