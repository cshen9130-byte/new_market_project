# CTA 利润 harder gaps — 2026-10-30 (Asia/Shanghai)

## Calib
GTJAQH009.WI; LIVE stays **profitRetBlend scale3** (`49c04048`). NO PM2. CloudAgents off.

## Choice / 妙想 exhaust
- `user-mx-ds-mcp` `mx_macro_data` + server EmQuant `c.edbquery` on EMI02082650–750.
- **No daily EMI found** for: NI/PB smelting, I/J/JM coke/ore margins, SC/FU/BU crack, MA/PP/L/EG process margins.
- Monthly-only (not catalogued): EMI01765676 naphtha crack, EMI01765677 MTO, EMI01968337 EG.
- Independent coke / iron-ore import profit: Choice empty.

## Catalog correctness fix (clear data win; not REPORT_FIT)
`c.edbquery` showed prior product labels were **swapped**:

| code | was | correct NAME | product now |
|---|---|---|---|
| EMI02082690 | ZN | 毛利:PTA | **TA** |
| EMI02082698 | RB | 毛利:电解铝 | **AL** |
| EMI01961310 | AL | 锌锭利润 | **ZN** |
| EMI02082720 | TA | 毛利:螺纹钢 | **RB** |
| EMI02082722 | RB「线材」 | 毛利:铝棒 | **deleted** |

New confirmed Baichuan (EmQuant **访问超限** this session — not upserted yet):
EMI02082734→RB 线材, EMI02082710→AU 金, EMI02082697→PF 涤纶长丝, EMI02082701/731→BR.

DB after remap: **32 codes / 21026 rows / 10737 nn** (was 33 before deleting 722).

## Retests vs LIVE (eval_to 2026-10-02)
| pass | clear_wins | note |
|---|---:|---|
| remap-only `tmp_profit_remap_retest` | **0** | LIVE 3m cr0.43 lvl0.67 end2.30/2.54 |
| futProxy gap-fill on `tmp_profit_futproxy_retest` | **0** | pure edb worse; LIVE unchanged |

## Futures proxies (designed + tested; default **off**)
`futuresBuiltProfitProxies` + `REPORT_FIT.profitUseFutProxy=false`:
- I: `RB − 1.6·I − 0.5·J`
- J/JM: `J − 1.33·JM`
- SC/FU/LU: `0.5·FU + 0.5·LU − SC·7.33`
- BU: `BU − SC·7.33`
- PP/MA: `PP − 3·MA`; L: `L − 3·MA`; EG: `EG − 1.5·MA`

## Promote?
**No.** LIVE `49c04048` retained.

## Residual
NI/PB still no Choice daily; cracks/blacks/chem process margins still need denser vendor EMI or better proxy construction; retry AU/线材/涤纶 upsert when EmQuant quota recovers.
