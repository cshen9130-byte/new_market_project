# 股指期货年化基差率

Daily charts for IH / IF / IC / IM. Checked against 开心基差 (sign flipped) and 火富牛 股指期货升贴水率 on 2026-11-03.

Code: `lib/server/index-basis-rate.ts`, `lib/client/cffex-expiry.ts`, `components/ma/index-basis-rate-chart.tsx`.

## Formula

```
年化基差率 = (F − S) / S / T × 365 × 100
```

- **F** is the futures close of the contract that held this term that day.
- **S** is the index close (`raw_spot_daily`, EmQuant preferred).
- **T** is calendar days from that day to the contract's expiry. Expiry is the third Friday of the contract month.
- A negative number is 贴水 (futures below the index). 开心基差 plots `(S − F)`, so flip their chart before comparing.

Skip **T < 2**. Expiry day turns a few ticks into hundreds of percent. Do not floor T at 1 and still plot the point.

## Which contract

The line is the term the user is looking at, rolled every day. It is not one expiry stretched across the whole history.

CFFEX lists four contracts: 当月, 下月, 当季, 下季. 当季 and 下季 are the next two quarter months (March, June, September, December) after 下月.

| Chart role | 开心基差 | Continuous close | Example on 2026-11-02 |
| --- | --- | --- | --- |
| 近月 | 当月 | `{product}L.CFX` | IH2611 |
| 远月 | 下月 | `{product}L1.CFX` | IH2612 |
| 近季 | 当季 | `{product}L2.CFX` | IH2703 |
| 远季 | 下季 | `{product}L3.CFX` | IH2706 |

On each day, take the contract that held that role **on that day**, and use that contract's own T. IH2703 today is 当季, so its history is every past 当季 (IH2506 on 2025-04-07, IH2612 on 2026-09-07, and so on), not IH2703's September 2027 expiry applied backwards.

A named month that is not in today's list uses only its own prints. A continuous symbol (`IH0`) follows 近月. The live header and the intraday line use the selected contract's own price and its own remaining days.

## Price source

1. That day's close in `raw_futures_contracts_daily` (close, else clear).
2. If that row is missing, the matching continuous close in `raw_futures_daily` (`IHL` / `IHL1` / `IHL2` / `IHL3`). Use **close**, not settle. On days both exist, the closes are the same contract.

`raw_futures_contracts_daily` has no IH rows from **2025-05-06 through 2025-07-18**, plus shorter holes. Connecting those gaps draws a straight line across the middle of the chart. The continuous legs cover those sessions back to 2023-01-03 and are what fill the line.

## Do not

- Do not annualize the continuous front price with a far contract's remaining life. A 2% discount over 400 days prints about −1% and erases the April 2025 spike.
- Do not annualize that same front price with the front month's last week. Eight days turns a 2% discount into about −85%, which is not that far contract's basis.
- Do not reuse one expiry for every term. 近月 and 当季 are different prices and different T on the same day.

## Checks

Sign below is ours. 开心基差 is the opposite sign.

| Day | Term | Contract | T | Ours | Reference |
| --- | --- | --- | --- | --- | --- |
| 2025-04-07 | 当季 | IH2506 | 74 | −14.85% | 开心基差 当季 spike about +15% |
| 2025-04-07 | 下季 | IH2509 | 165 | −9.35% | 开心基差 下季 spike about +9% |
| 2025-04-07 | 下月 | IH2505 | 39 | −25.50% | 开心基差 下月 spike about +25% |
| 2025-04-07 | 当月 | IH2504 | 11 | −78.26% | 当月 only; 开心基差 leaves 当月 off in the quarter view |
| 2025-08-04 | 当月 / 下月 / 下季 | that day's listed | | +0.97% / +0.29% / +0.23% | 开心基差 tooltips −0.97% / −0.29% / −0.23% |
| 2025-06-18 | 下月 | inside the old hole | | −18.31% | Was the straight line; now a real point |
| 2026-09-07 | 当月 | IH2609 | 11 | −14.74% | 火富牛 IH dip about −14% in September 2026 |

火富牛's September 2026 dip is the **当月** line. The 当季 line that day is about −9%.
