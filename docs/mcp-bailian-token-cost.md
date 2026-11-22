# MCP 百炼 token cost

Handoff from the 22 November 2026 bill check. Next week’s job is to see whether MCP calls to 百炼 are reasonable, and to keep new API design cheap.

百炼 is billed per token. A knowledge-base answer that resends a long note is the expensive case. Data tools that only read Postgres are free on this line.

## Bill, 22 Nov 2026

Source: Aliyun console, 费用与成本, month still open (through about 22 Nov).

| Month | Total | Notes |
| --- | ---: | --- |
| 2026-06 | ¥11.01 | |
| 2026-07 | ¥594.03 | One tall bar. The website chat log for July is too small to explain it. |
| 2026-08 | ¥44.99 | |
| 2026-09 | ¥50.26 | |
| 2026-10 | ¥44.93 | |
| 2026-11 | ¥178.26 | About ¥133 above October, and the month was not finished. |

November split from the tooltip:

| Product | Amount | Share |
| --- | ---: | ---: |
| 大模型服务平台百炼 | ¥147.01 | 79% |
| 云数据传输 | ¥30.13 | 16% |
| 共享流量包 | ¥7.12 | 4% |

The ECS box itself is not the line that grew. The increase to explain is 百炼, plus a smaller jump in outbound traffic.

Prices used below are the public 华北2（北京）list prices checked the same day (no promo discount). Confirm on the 百炼 console before treating a yuan figure as exact.

| Model | Input | Output |
| --- | ---: | ---: |
| qwen-plus, input ≤ 128K | ¥0.8 / million | ¥2 / million (non-thinking). Thinking output is ¥8 / million |
| qwen-plus, 128K–256K | ¥2.4 / million | much higher |
| qwen-max | ¥2.4 / million | ¥9.6 / million |
| text-embedding-v4 | ¥0.5 / million | — |

One qwen-plus question with ~20,000 input tokens and a short answer is about ¥0.02. ¥147 is on the order of several million such calls, or fewer calls with a much larger prompt or a more expensive model.

## What the website log can and cannot see

Only the knowledge-base **chat page** used to write a token row (`appendTokenUsage` in `app/api/knowledge-base/chat/route.ts`). Storage is `/root/market_dashboard_storage/token_usage/records.json` on the production host. That file’s last write at check time was 13 Nov 2026.

Chat-page totals in that file:

| Month | Who | Calls | Tokens |
| --- | --- | ---: | ---: |
| 2026-05 | cshen | 1,577 | 12.9M (mostly qwen-turbo) |
| 2026-06 | cshen | 656 | 3.8M |
| 2026-07 | cshen, plus small amounts from others | ~80 | ~0.7M |
| 2026-10 | cshen only | 24 | 271k |
| 2026-11 | cshen only, all on 13 Nov | 6 | 73k |

November’s 73k tokens are well under ¥1. October’s chat-page use is a few yuan at most. July’s ¥594 is the same gap: the chat log is about ¥1. **The chat page did not cause the November jump.**

These DashScope callers do **not** write that log unless noted:

| Caller | Model | Hits 百炼? |
| --- | --- | --- |
| MCP `kb_ask` | qwen-plus by default (`kbModelMode` falls back to `plus`) | Yes. This is the unlogged knowledge-base path. |
| MCP `kb_search` | embedding only (`text-embedding-v4`) | Yes, but a query embedding is tiny. |
| MCP `kb_read`, `kb_list` | none | No. |
| MCP MOM tools (`/ma/api/mom-data/mcp`) | none | No. |
| MCP fund-data tools other than kb_* and AI 研究员 | none | No. |
| MCP `ai_researcher_*` | qwen-plus, and similar-fund images can use `qwen-vl-max` | Yes. Still no token row. The route handlers do not return usage. |
| 网页 chat | qwen-plus / flash / max | Yes, and it is logged. |
| Contract OCR, investment-note generate, speech-to-text | vision or chat | Yes. November volumes were small (about 24 extract jobs, about 11 note generations). |
| Knowledge-base embedding | text-embedding-v4 | Yes. November added about 600 chunks (~0.7M characters). The whole index is ~23k chunks / ~25M characters, on the order of ¥10–20 lifetime, not a November spike. |

A cell whose retrieved text never names the column returns `暂无数据` and does **not** call the chat model (`cellEmpty` in `askKnowledgeBaseQuestion`).

## Traffic we could see (nginx, 8–22 Nov only)

Logs before 8 Nov had already rotated. Tool name is not in the access log, only the URL, so a fund-data POST is not proof of `kb_ask`.

What is solid:

- **9 Nov and 13 Nov, office IP `116.237.193.158`.** WorkBuddy 5.6.4, then 5.11.2, sent on the order of 25,000 and then 14,000 **GET**s per day at the fund-data and MOM MCP URLs. Bodies were ~200 bytes. Those are reconnect polls. They do not call 百炼. Several accounts log in from that office address (cshen most often that week, also sunjie, BEyondoubt, and others). Do not assign the poll storm to one person from the IP alone.
- **16 Nov, same office IP.** A Python client (`Python-urllib`) made **29,452 POSTs** to the MOM MCP and downloaded about **1.1 GB**. MOM MCP does not call 百炼. This matches the ¥30 云数据传输 line.
- **Fund-data POSTs with large replies (about 20–100 KB),** the ones that *can* be `kb_ask` or an AI 研究员 tool:
  - 16–19 Nov, mostly `124.79.105.65`. The only login ever recorded from that address is **benc** (one success on 9 Nov). Roughly 300 large replies on the 16th and the 19th, about 150 on the 17th, about 110 on the 18th.
  - 20–21 Nov, mostly `61.170.144.214`, which is **chenpeifeng**’s login address. About 190 large replies on the 20th and about 40 on the 21st.
  - 22 Nov, about 66 large replies from the office IP.

Hundreds of ordinary qwen-plus calls do not add up to ¥147. Either many more calls happened on 1–7 Nov (logs gone), the prompts were far above 20k tokens, a dearer model was used (qwen-max, qwen-vl), or something else on this Aliyun account called 百炼 without passing through nginx. WorkBuddy’s own chat, if pointed at this same 百炼 account, would do that and would be invisible here.

Next week, the decisive page is the 百炼 console’s 调用统计 for November, grouped by model and by API key. The website log cannot finish the attribution until that is in hand.

## Why a knowledge-base call gets big

Website folder ask (`buildRetrievalContext` in `lib/server/knowledge-chat.ts`):

- Up to `KB_FULL_READ_FILES` (3) files.
- A note of at most `KB_SHORT_FILE_CHARS` (24,000) characters is sent whole, so a view on a later page is still in the prompt.
- Assembled prompt cap `KB_CONTEXT_CHARS` is 28,000 characters.
- Grounded mode adds `KB_GROUNDED_RULE`: the model must emit citation JSON. That is output tokens, and it is how we keep quotes honest.
- Every ask also embeds the question (`text-embedding-v4`). That part is cheap.

That size is reasonable for **one** opinion question. It is not reasonable as the body of every cell in a grid.

The waste we already know about:

1. **One model call per table cell.** `docs/workbuddy/skills/ma-kb-qa/SKILL.md` tells the agent to call `kb_ask` once per cell and not to invent the whole table in one reply. A 10×8 grid is 80 calls. Before the change below, each call could resend the same notes.
2. **`file_path` sent the entire file** with no character cap. A long PDF on that argument is a large prompt even when the question is one sentence.
3. **Default model is qwen-plus**, including MCP. qwen-flash exists and is cheaper, but opinion and 填表 answers were deliberately kept off turbo/flash because quality and rate limits were worse. Do not flip the default just to save money without checking answers.
4. **Retries and polls.** The GET storms do not cost 百炼. Repeated POSTs of the same question do.

Embedding the corpus, contract OCR, and the chat page were checked and are too small for the November 百炼 line.

## Already changed in the working tree (not a reason to skip the investigation)

These edits are local until the next production deploy. They do not explain history. They make the next week measurable and cheaper.

- MCP `kb_ask` records tokens for the signed-in account: `channel: "mcp"`, `tool: "kb_ask"`. The admin page AI Token table has a 来源 column. Older rows have no channel and are the website chat.
- New rows append to `token_usage/records.jsonl`. The old `records.json` is still read. Two Node processes no longer rewrite one JSON array on every call.
- MCP table-cell asks set `compactCell`. Each file contributes a header plus the paragraphs around the column name and the row label, capped at 6,000 characters (`cellFocusText` / `CELL_FILE_CHARS`). The whole prompt for a cell is capped at 12,000 characters.
- MCP `file_path` on a long file is cut to about 12,000 characters around the question, instead of the whole document.
- A normal opinion question from MCP still uses the 28,000-character note context. Shrinking that drops the later-page view the tests are there to protect (`lib/server/knowledge-retrieval.test.ts`).
- A cell with no passage naming the column still skips the model.

`kb_search`, `kb_read`, and `kb_list` still do not call the chat model. AI 研究员 MCP tools still do not record tokens.

## Design rule

Token fees are part of the API. When adding or changing a tool that can reach DashScope:

1. **Read this file first.** Prefer a tool that returns data or a short quote over a tool that calls qwen-plus.
2. **Log every chat call** through `appendTokenUsage` with `userId`, `userName`, `model`, `channel: "mcp"`, `tool`, and a short `questionPreview`. If the handler cannot see usage metadata, fix that before shipping the tool. Embedding calls can stay unlogged only while they stay one short query.
3. **Put a character budget on the prompt** and name it next to the tool. Do not send a whole file because it was handy. Reuse `compactCell` / `contextCharBudget` rather than a new uncapped path.
4. **Do not call the chat model to say “no data”.** If retrieval already shows the column or the fact is absent, return that without a completion.
5. **Do not multiply full-context calls.** One call per cell is allowed only because the cell prompt is the short window. A new “fill this grid” tool should ask once per column, or once per file, and return the cells together. Do not add a tool whose instructions say “call the model once per cell” and then attach the full note each time.
6. **Keep qwen-plus as the opinion default** until a cheaper model is checked on real 填表 and 路演 questions. Do not expose qwen-max as a silent default. Vision (`qwen-vl-max`) is a separate, higher bill: image tokens on similar-fund charts need their own cap.
7. **Stay under the 128K input tier.** qwen-plus jumps from ¥0.8 to ¥2.4 per million input tokens above 128K, and output jumps with it. A budget around 12,000–28,000 characters stays in the cheap tier.
8. **MOM MCP stays off this bill.** Do not route MOM tools through a chat model to format numbers the database already returned.
9. **Do not put `DASHSCOPE_API_KEY` in WorkBuddy, skills, or docs.** Agents should call our MCP. A copied key spends 百炼 with no row in our log.

## Next week checklist

1. 百炼 调用统计 for 1–22 Nov 2026: model, token in/out, and which API key. That is the missing split of the ¥147.
2. After deploy, read `records.jsonl` and group MCP `kb_ask` by `userName`, day, and `questionPreview`. 填表 questions look like `列：「…」，行：「…」`.
3. Compare those previews with benc (16–19 Nov) and chenpeifeng (20–21 Nov). Confirm the IPs are still theirs before naming anyone in a conclusion.
4. Price a sample of real prompts: cell window vs a 28k opinion ask vs any `file_path` call. If the console shows qwen-max or qwen-vl, the website default is not what spent the money.
5. Decide whether the one-call-per-cell skill line stays. It stays acceptable only while the cell prompt stays on the short window. If a grid is still expensive after deploy, add one column-level tool instead of raising the cap.
6. Add token rows for `ai_researcher_*` before treating those tools as measured.
7. July’s ¥594 is a separate hole. The chat log does not explain it. Only the July 调用统计 can.
