# Spot EMI gaps (基差现货)

Generated 2026-10-28 Asia/Shanghai (unit/FX hygiene).

## Covered (60 products, 77 series)
A AD AG AL AO AU B BR BU BZ C CF CJ CS CU CY EB EG FG HC I J JD JM L LG LH M MA NI OI OP P PB PF PG PK PL PP PR PX RB RM RR RS RU SA SC SF SH SM SN SP SR SS TA UR V Y ZN
(+ FX helper USDCNY / EMM00058124, not a CS product)

## Newly added this pass (unit/FX convertible)
| product | emi_code | scale / FX | note |
|---|---|---|---|
| OP | EMI01772836 | ×1 | 汇易 四级花生油 元/吨 |
| CY | EMI01732836 | ×1000 | 农业部 棉纱 元/千克→元/吨 |
| JD | EMI01772901 | ×500 | 汇易 鸡蛋 元/千克→元/500千克 |
| CJ | EMI01004684 | ×1000 | 批发 红枣 元/千克→元/吨 |
| PX | EMI01755706 | ×USDCNY | CFR 美元/吨 × 中间价 |
| SC | EMI01794453 | ×USDCNY | 胜利原油 美元/桶 × 中间价 |

Live math: store **raw** EMI in DB; `unitScale` (+ optional `fxCode`) applied in `loadEdbCommoditySpot`.

## Gaps (still)
FU LU NR BB FB AP

## Skipped with reason
- AP: only weekly 商务部 元/千克
- BB/FB: no usable daily CNY
- NR/FU/LU: sparse / USD / futures-only

## Live fit
- REPORT_FIT updated this run: enter15/exit35 + ruleHygiene=true (clear Pareto after unit/FX)
- other knobs unchanged; no PM2
