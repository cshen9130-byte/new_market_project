---
name: ma-mom-briefing
description: "下载最新日或指定日的 MOM 风控简报文件。当用户说发我 MOM简报、最新一日简报、下载简报时使用。必须通过用户自己已连接的 MA MOM数据 MCP。只交付文件，不另写分析。"
description_zh: "下载 MOM 风控简报（需本人 MOM数据API）"
version: 1.0.0
author: MA
---
# 下载 MOM 风控简报

用户要文件，不要一篇新写的评论。做法和发 JY 跟踪池周报 Excel 一样：调一次工具，把返回的文件保存后交给用户。

## 登录与权限（必须遵守）

1. 只通过用户已经在 WorkBuddy 中连接的「MA MOM数据」MCP 调用本系统。不要手写 API Key，不要使用环境变量、文档、聊天记录或同事提供的 Key。
2. 若连接器未连接、授权失效，或工具列表为空/报 401，立即停止，请用户点击输入框上方的连接卡片（或到「专家·技能·连接器 → 连接器」里点击 +），用**自己的** MA 系统账号登录并允许授权。然后继续当前任务，不要换一种未授权的方式重试。
3. 没有 MOM数据API 权限时如实说明。不要改用基金数据连接器，也不要改用别人的身份。
4. 不要编造收益或规模。工具没有返回文件时，说明原因，不要自己画一份简报。

## 发文件

一次 `mom_briefing`。

- 用户说「最新日」或没指定日期：不要传 `date`。
- 用户指定某一天：传 `date`，格式 `YYYY-MM-DD`。
- 把 `content_base64` 解码，按 `file_name` 保存。文件名是 `MOM风控简报-YYYY-MM-DD.html`。
- 把这个文件发给用户。不要把 base64 贴进对话，不要改文件里的数字，不要再调用别的 MOM 工具重算。
- 回复只写日期、文件名，以及这是新文件。文末可以放 `page_url`，那是网站上带图表的同一页。

## 定时下载

用户要求每天自动保存时，用技能目录里的 `download_mom_briefing.py`。复制到该用户的 `%USERPROFILE%\WorkBuddy\scripts\`，不要留在带日期的 automation 目录，也不要写死 `Administrator`。

同目录写 `mom-briefing.config.json`：

```json
{
  "mcp_url": "https://8.154.33.143/ma/api/mom-data/mcp",
  "key_file": "mom-data.key",
  "out_dir": "<这个用户的保存目录>"
}
```

`mom-data.key` 只放这位用户自己的 MOM 数据 API Key，从他本机的 MOM 连接配置读取。不要把密钥写进脚本、任务正文或聊天。没说保存目录时，用他的「文档\\MOM简报」。

定时任务正文只运行这条本地命令，超时 180 秒。不要在任务里调用 MCP，不要做分析，不要另生成报告。退出码 0 时说明路径、大小，以及 `action=new` 还是 `action=skip`。退出码 1 时转述 stderr。网络或协议错误才把脚本再跑一次。
