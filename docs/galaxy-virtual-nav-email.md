# Galaxy Securities daily virtual NAV

## What was wrong

稳博鹏瑞套利2号B类 (`AJX62B`) showed only month-end points (2026-08-31, 2026-09-30, plus 2026-10-08). The August and September numbers come from the parent fund's month-end valuation sheet (`SAJX62`, 估值表4级).

The mailbox already had a daily series. 中国银河证券 sends one mail per day:

```
[虚拟净值][AJX62B]-[稳博鹏瑞套利2号私募证券投资基金B][鑫楚稳增量化1号FOF私募证券投资基金][20260924]
```

The HTML table and the `.xls` attachment both carry that day's official figures. On 2026-09-24 the row is unit NAV 1.1327, cumulative NAV 1.1327, and 计提后虚拟净值 1.1099. The last figure is the investor's value after performance fee. It is not the fund's unit NAV.

The parse log marked these mails 成功. That flag only checks that the HTML contains the words 单位净值 and a decimal. Nothing was written to `ops_email_nav_records`. A count of that table for `AJX62B` / `[虚拟净值][AJX62B]` was 0. The August parse log alone has 45 of these mails across 15 dates.

Three gates dropped the mail:

1. The attachment picker only treated full-width `【虚拟净值】` (and a few other patterns such as `_虚拟净值_`) as a NAV workbook. This file uses half-width `[虚拟净值]`, so the `.xls` was never opened.
2. The body parser's virtual-NAV branch had the same full-width check, and it expected a date like `2026-09-24`. This mail uses `[虚拟净值]` and `20260924`.
3. The generic "单位净值" matcher only accepts a number sitting directly after that label. In this table the number is several columns later (after 产品名称, 产品代码, 客户名称, 参与计提份额, 净值日期).

## What changed

`lib/server/email-nav-extract.ts`

- Subject `[虚拟净值][CODE]-[产品名]…[YYYYMMDD]` is parsed as the product, not the FOF investor named second. Both `[投资者]` and a bare investor name are accepted. `AJX62B` / `稳博鹏瑞套利2号私募证券投资基金B` becomes code `AJX62B` and display name `稳博鹏瑞套利2号B类`.
- The body row is read as 产品名称, 产品代码, 客户名称, 参与计提份额, 净值日期 (`YYYYMMDD` or `YYYY-MM-DD`), 单位净值, 累计单位净值. Stored values are 单位净值 and 累计单位净值.

`lib/server/email-nav-attachment.ts`

- Half-width `[虚拟净值]` on the subject or the `.xls` name is a NAV attachment, so `selectNavTableAttachments` downloads and parses the workbook.

`lib/server/nav-cleaner.ts`

- Workbook columns 虚拟计提业绩报酬, 提取前净值, and 计提后虚拟净值 are not used as 单位净值, 累计净值, or 复权净值. The sheet's 单位净值 and 累计单位净值 columns are.

## Check

```
npx tsx --test lib/server/email-nav-galaxy-virtual.test.ts
```

The test uses the 2026-09-24 AJX62B row and expects unit 1.1327, cumulative 1.1327, date 2026-09-24. It rejects 1.1099.

Mails already in the mailbox were never stored, so they are not on the "already parsed" skip list. A checkpoint that only looks back a few days will not reach them on its own.

## Backfill on 2026-10-12

The chart stayed on the old three points until the mailbox was read again. `data@jinyuasset.com` INBOX was searched from 2026-07-01. The server returned every message in that window (subject search is ignored), and the client kept subjects containing `AJX62B`.

14 workbook rows were stored, from 2026-09-14 through 2026-10-09. 2026-09-24 is unit NAV 1.1327, the same figure as the mail. The product-page cache for `AJX62B` was rebuilt: 15 points, tip 2026-10-09. The older 2026-08-31 valuation point (1.0986) is still the first point. August `[虚拟净值]` mails are no longer in INBOX, so they were not recovered. Reload the fund page to see the new series.
