# 跟踪池 rules

投资 → 跟踪池 → 跟踪产品 (`/ma/dashboard/private-funds?tab=investment&side=inv-tracking`).

The list 最新净值日期 must be the same date the product page shows. A stale list cache is a bug even when the cache row was written by an earlier, correct refresh.

## Pools

Team tabs come from `tracking_custom_pools` (`scope = team`). Two client-only tabs are not membership tables:

| Tab | Key | Membership |
|---|---|---|
| 全部 | `all` | Union of the visible team pools only |
| JY跟踪池 | `jy` / `tracking` | `tracking_pool` |
| 精选池 / 核心池 / hy跟踪池 / FOF&MOM跟踪 | `selected`, `core`, `hy`, `fof` | `selected_pool`, `core_pool`, `hy_tracking_pool`, `fof_mom_tracking` |
| Custom team pools | `custom_*` | `user_custom_pool` |
| 我的跟踪 全部 | `mine_all` | Union of that user's mine pools |
| 默认我的跟踪 | `mine_default` | Per-user rows, not the team tables |

Rules that have already been broken once and must stay:

- **全部 does not include the hidden BFL catalog.** `private_fund_info_bfl` and `type6_ops_team_full` are the fund universe. They must not show up as rows on 全部.
- **`bfl` and `bfl_ops` stay hidden** from the sidebar, pickers, and membership chips. Do not delete their rows to hide them.
- **JY跟踪池 is add-only for FOF底层 私募持仓.** New private-fund holdings are inserted. Leaving a FOF holding does not remove the tracking row.
- **邮箱运维池 (`custom_email_nav`) follows email NAV plus FOF 估值表 holdings.** Name-only identities (`email_nav_name`) are not the same as 备案号 rows (`email_nav_etl`). Do not let one sync delete the other.
- **Removing a product from 全部 removes it from every visible team pool.** Removing it from one named pool removes only that pool.
- **Parent and share class.** When a parent and its A/B/C share are both in the same pool, the list hides the parent so the same fund is not two rows. A second share code for that same name, and a 估值表 subject path that maps to the same 备案号, are not extra products. See the 2026-10-14 note below.

## 最新净值日期

The column is `latest_nav_date` on `/ma/api/tracking-funds/list`.

Sources, newest trading day wins:

1. Team / manual NAV, when its date is on or after the row already shown. Same-date team NAV must not replace a cached 复权 涨跌幅 with a 单位/单位 change.
2. `private_fund_info.latest_nav` / `latest_nav_date`. 火富牛 writes this when it stores `private_fund_nav`. It does not rebuild `ops_tracking_funds_list_cache`.
3. `ops_tracking_funds_list_cache`, filled by `refreshTrackingFundsListCache` (nightly `investment_pool_metrics`).

The product page already treats a newer `private_fund_info.latest_nav_date` as the tip (`app/ma/api/private-funds/[beian_hao]/route.ts`). The list has to do the same. Opening the product is not the way the list gets the date.

### What must not come back (2026-10-09)

**Symptom.** On 跟踪产品, a large block of funds showed 最新净值日期 **2026-08-28** (some **2026-08-21**). 最新变动日期 was already September or October. Opening the product showed a later NAV, often **2026-09-30** or **2026-09-24**. About **5,075** cache rows were stuck on 2026-08-28. For **4,990** of them, `private_fund_info.latest_nav_date` was already later, and `private_fund_nav` had those later rows. Example: SABF94 cache **2026-08-28 / 1.7762**, refreshed **2026-09-10**; `private_fund_nav` and the product page both had **2026-09-30 / 1.7557**. `BatchNavResolver.resolveAt` on that day also returned 2026-09-30. The resolver was not the bug. The list was still serving the September 10 cache row.

**Why it returned.** This is the same stale-list bug as SBHK26 (list stuck on 2026-06-30 while the product page had moved on). The read-path check that recomputed a tip more than 10 days old (`STALE_LIST_NAV_DAYS` in `needsNavMetricsRecompute`) was later skipped whenever `RUN_BACKGROUND_JOBS=0`. That skip is intentional: a page of `BatchNavResolver` work hung 跟踪产品. Production web sets that flag, so the skip is the normal list path. Nightly cache rebuild has not rewritten these rows since 2026-09-10, and 火富牛 kept writing `private_fund_info` after that. The list therefore froze on the last cache date, which for this weekly batch was 2026-08-28.

**Fix.**

- `overlayPlatformInfoNavOnTrackRows` runs on every tracking-list response, after the team-NAV overlay. If `private_fund_info` has a later China trading day on or before the cutoff, the row's 最新净值日期, 最新单位净值, 最新涨跌幅, and 近一周/一月/三月/六月/一年 use that tip and `private_fund_nav`. A newer team/manual date still wins. An equal date does not replace the cached 复权 涨跌幅. `preserve_high_nav_scale` funds are left on the cache tip.
- The list SQL sorts and selects with the same newer `private_fund_info` date, so sorting by 最新净值日期 is not still ordered by the stale cache. Weekends stay on the cache date. A statutory holiday that the SQL weekday check lets through is put back on the cache tip in the overlay.
- The advanced tip is written back to `ops_tracking_funds_list_cache` only when it moves the date forward. Readers that query the cache table directly (weekly review, MCP) then see it too.
- The browser list cache key at the time of this fix was `tracking_list_cache_v9`. v8 kept the stale page for up to 3 days. The key is now `tracking_list_cache_v10` (see 2026-10-14).

**Do not regress this by**

- Turning `corrupt-only` back into a full `BatchNavResolver` scan of the page. That hang is why the stale-date check was disabled. The platform-info overlay is the replacement.
- Removing the overlay, the SQL `pinfo_tip` date, or the write-back because a nightly rebuild "should" refresh the cache. 火富牛 updates `private_fund_info` between rebuilds, and a missed rebuild is exactly how 2026-08-28 lasted a month.
- Replacing a same-date cached 涨跌幅 with 单位净值/单位净值. That mismatches the product page on dividend dates.
- Copying this list logic into MOM / `public.mom_*`. Tracking-pool NAV and MOM 每日风控 stay separate.

### What must not come back (2026-10-14)

**Symptom.** On 跟踪产品 → 全部, searching 诚奇浦江CTA1号 showed two rows both named 诚奇浦江CTA1号A类. One was 2026-10-13 / 1.4610 / about −0.90%, which matches the product page. The other was still 2026-10-09 / **+0.34%**. The same search also showed the parent 诚奇浦江CTA1号 and a second parent-looking row whose 备案号 was the 估值表 subject `场外_已上市_开放式_私募_成本.诚奇浦江CTA1号`, also stuck on +0.34%.

**Why.** Four memberships were the same fund, stored under different codes:

| Code | Name in the pool | List tip |
|---|---|---|
| `SB595A` | 诚奇浦江CTA1号私募证券投资基金A类份额 | 2026-10-13 / 1.460967 / −0.90% |
| `SSB595A` | 诚奇浦江CTA1号私募证券投资基金A类 | 2026-10-09 / 1.4625 / **+0.34%** |
| `SSB595` | 诚奇浦江CTA1号 | 2026-10-12 / 1.4743 / +0.81% |
| `场外_已上市_开放式_私募_成本.诚奇浦江CTA1号` | same subject path | 2026-10-09 / 1.4625 / **+0.34%** |

`SB595A` is the tiered A share of parent `SSB595`. `SSB595A` is that same share with an extra S. Hiding the parent only removes a row that does not end in A/B/C, so both share codes stayed. Each code has its own `ops_tracking_funds_list_cache` row, so the alias kept serving 2026-10-09 even after the product page (and `SB595A`) had 2026-10-13. The subject-path row is already mapped to `SSB595` in `FOF_VALUATION_CODE_ALIASES`, but the list matched on the raw 备案号, and the name key still included the `场外_…` prefix, so it did not collapse into the parent.

**Fix.** `sqlVisibleTrackingIdentity` in `lib/server/tracking-list-identity.ts` runs on every 跟踪产品 list (全部, named team pools, and custom pools), before LIMIT. The `keyed` CTE must stay materialized and must already contain `family_key`, `name_key`, `canon_share`, `canon_code`, `share_parent_code`, and `share_s_parent_code`.

- Keep one share when `canonicalizeShareClassBeianCode` of a row equals another row's 备案号 and the fund names match (`SSB595A` drops, `SB595A` stays). Do not rewrite a code whose canonical form is not in the list (`SB595A` must not become `B595A`).
- Hide the parent when its family key matches, or when its 备案号 is the share's base or `S` plus that base.
- Drop a known 估值表 / custodian alias when `canonicalProductCode` points at another row in the same list. The name key strips the `场外_…` subject prefix before comparing names.
- `visibleTrackingBeianCodes` is the same rule for tests (`lib/server/tracking-list-identity.test.ts`).
- The browser list cache key for this fix was `tracking_list_cache_v10`. v9 kept the four-row page. It moved to `tracking_list_cache_v11` on 2026-10-15. The server one-shot `_trackingListShareAliasDedupeV1` drops the in-memory list JSON once per process.
- Keyword search does not use that list SQL. `resolveTrackingKeywordBeianCodes` loads the tracked-name catalog and `buildFastKeywordCachedBody` selects `ops_tracking_funds_list_cache` by those 备案号. The catalog must be passed through `collapseTrackingIdentities` first. Skipping that is how a search for 诚奇浦江CTA1号 still returned all four rows after the list SQL filter existed.
- The extra memberships (`SSB595A`, `SSB595`, and the 估值表 subject path) were removed from the pool tables and `ops_tracking_funds_list_cache` on 2026-10-14 so the running server, which only knows the old keyword query, stops listing them. `SB595A` stays. A later sync may insert an alias again; the catalog collapse above is what keeps it off the search results.

After the filter, this search returns only `SB595A` (2026-10-13 / 1.4610 / about −0.90%).

**Do not regress this by**

- Treating two share codes as two products because both end in A/B/C. Parent-hiding does not remove `SSB595A` beside `SB595A`.
- Canonicalizing every S-prefixed share in place. `canonicalizeShareClassBeianCode("SB595A")` is not a reason to rename the row when `B595A` is not listed.
- Comparing fund names without stripping a 估值表 subject prefix. `场外_已上市_开放式_私募_成本.诚奇浦江CTA1号` is `诚奇浦江CTA1号`.
- Adding a new custodian or 估值表 code without a `FOF_VALUATION_CODE_ALIASES` entry. The list only collapses aliases that map is explicit about.
- Putting the regexes back inside the EXISTS. That nested loop made 全部 take about 6 seconds.
- Bumping only the server cache. The browser key has to move too, or the old duplicate page stays for days.
- Filtering only the unscoped list SQL. A keyword search (the 诚奇浦江CTA1号 box) uses the name catalog and the list cache, and must collapse identities there too.

### What must not come back (2026-10-15)

**Symptom.** 跟踪产品 showed 卓尚天道1号 (`SGT288`) 最新涨跌幅 **+35.01%** next to unit NAV 1.0498 on 2026-10-13. The product page for that date is **−0.25%** (1.0498 / 1.0524 − 1).

**Why.** `private_fund_info` already had 2026-10-13 / 1.0498, and `private_fund_nav` stopped at 2026-09-22 (unit 1.0524, 累计 0.777548). The list overlay appended the new unit NAV as if it were 复权, so the day return was 1.0498 / 0.777548 − 1.

**Fix.** `extendNavHistoryWithUnitTip` carries the previous 复权 forward by the unit change. Do not push `{ return_nav: tip.nav }` for a date missing from `private_fund_nav`. The browser list cache key is `tracking_list_cache_v11`; v10 kept the +35.01% row for up to 3 days.
