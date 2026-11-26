# ima 点睛 — 周度业绩 fetch limit

Only the folder **周度业绩** inside **点睛焱究所 → 4. 周度业绩排名更新及业绩点评**. Do not download the other top-level folders (尽调报告, 周报, 主题研究, and the rest). Inside 周度业绩, skip the folder named **2025**.

The only automatic job is Wednesday 10:00 Beijing: the **latest week folder** inside 周度业绩 (about 4 xlsx). Do not schedule or resume a history fill of the older week folders. Download those only when the user asks in the current request.

Fetching a file’s original bytes spends a **daily 资料获取 quota**. It is not the chat-token allowance, and slowing the calls does not raise it.

Credentials: `IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY`, or `ima_api/api_key.txt`, or server storage `ima/api_key.txt`. Do not copy the key into docs, logs, or git.

## The limit we hit

On **2026-11-26**, `get_media_info` started returning:

> 资料获取次数已达上限，请明天再尝试

That run had been pointed at the wrong folders (尽调报告). It still shows the cap: after **20** new originals that morning (about **12.6 MB**), plus **4** ranking workbooks earlier the same day, the next original fetch failed and every later one failed the same way. ima does not publish the exact daily number. Treat “a few dozen original files per day” as the observed ceiling, and treat that error string as the stop signal. Those mistaken 尽调报告 files are not part of this job.

These calls do **not** spend that quota:

- `search_knowledge_base`
- `get_knowledge_list` (folder listing)

周度业绩 is about **46** week folders, almost all with **4** workbooks, plus the **2025** folder which is skipped. Listing folders does not spend the quota. Do not use that as a reason to keep downloading older weeks.

A separate **burst** limit still exists (`110021` 请求频控 on the wiki API, `20002` on the notes API). The 2026-11-26 run did not hit it. Spacing calls (the mirror waits about 1.2s between ima calls) avoids the burst limit only.

The “20G 空间” banner in the ima client is account storage, not this quota.

## What to do

**Automatic job** (`scripts/ma/run_ima_dianjing_rank.ts`, cron Wednesday 10:00 Beijing). This is the only ima download that runs by itself. It opens only `周度业绩`, ignores the folder named `2025`, and downloads the latest week folder (the name like `1116-1120` with the latest end date). About **4 xlsx** and **9** ima calls. Files go to `外部私募业绩排行/ima点睛/`.

**Older weeks are not automatic.** Do not run `scripts/ma/run_ima_dianjing_mirror.ts`, and do not continue a stopped history fill the next day, unless the user asks for those weeks in the current request. If they do: stay inside `周度业绩`, skip `2025`, skip every other top-level folder, and stop at the first `资料获取次数已达上限` instead of retrying that day.
