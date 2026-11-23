---
name: ma-jy-weekly-download
description: "为当前用户创建定时任务：运行本地脚本下载 JY 跟踪池周报 Excel（默认股票和期货）并保存到该用户自己的目录。脚本路径和保存目录随人变化。定时任务本身不调用 MCP、不做分析、不生成报告。"
description_zh: "定时下载 JY 跟踪池周报 Excel"
version: 1.0.0
author: MA
---
# 定时下载 JY 跟踪池周报

这个技能只负责两件事：按当前用户写好本机下载脚本，并在 WorkBuddy 里建一个定时任务去跑它。定时任务跑起来之后不再分析数据，也不生成 HTML。

## 登录与权限（必须遵守）

1. 密钥只用当前这位用户自己的。从该用户本机的 WorkBuddy MCP 配置读取「MA 基金数据」的 `x-api-key`，写进只有他能用的密钥文件。不要把密钥写进脚本、定时任务正文、技能或聊天回复。
2. 配置里没有密钥时停下来，请他用自己的 MA 账号连接「MA 基金数据」，或把自己的基金数据 API Key 放进密钥文件。不要从别的脚本、别的同事目录或聊天记录里复制密钥。
3. 不要调用 `weekly_review` 或其他金融 MCP 工具来代替这个脚本。设置阶段只写文件和创建定时任务。
4. 脚本路径、保存目录都按当前用户来，不要沿用 `C:\Users\Administrator\...`，也不要把脚本留在带日期的 `automation-日期` 目录里。

## 写到这台电脑上的文件

技能目录里的 `download_jy_reports.py` 是模板，原样复制，不要改逻辑，也不要在里面填密钥。

复制到稳定位置：

- Windows：`%USERPROFILE%\WorkBuddy\scripts\download_jy_reports.py`
- 其他系统：`$HOME/WorkBuddy/scripts/download_jy_reports.py`

同目录再写两个文件。

`jy-weekly.config.json`：

```json
{
  "mcp_url": "https://8.154.33.143/ma/api/fund-data/mcp",
  "key_file": "fund-data.key",
  "out_dir": "<这个用户的保存目录>",
  "pools": "jy",
  "variants": ["equity", "futures"]
}
```

`fund-data.key`：一行，当前用户自己的基金数据 API Key，不要多空格。

保存目录没说时，用该用户的「文档\JY周报」（Windows 是 `%USERPROFILE%\Documents\JY周报`）。用户指定了别的文件夹就用他指定的。`out_dir` 写成这台电脑上的绝对路径。

默认只下股票和期货两份 JY 跟踪池周报。用户还要公募指增或外部榜时，才把 `public` 或 `external` 加进 `variants`。

## 定时任务

在 WorkBuddy 里新建定时任务，不要改用操作系统的计划任务，除非用户明确要求。

没另说时间时：名称「下载JY跟踪池周报Excel」，每周四 16:30，长期有效，不推送到企业微信。权限用「允许完全访问」，因为要在本机运行 Python 并写文件。

任务正文用下面这一段，只替换尖括号里的两个路径。不要写入密钥，不要改步骤。

```text
运行本地脚本下载并保存 JY 跟踪池周报 Excel（股票、期货），不要调用任何 MCP 金融数据工具、不做分析、不生成报告或 HTML。

步骤：
1. 执行命令：python "<脚本的绝对路径>"（超时设 600 秒）。该脚本会自动完成：直连 fund-data MCP 服务发起 equity 和 futures 两个 weekly_review 计算任务、轮询至 done、解码 base64 并保存到 <保存目录的绝对路径>，文件名格式 JY跟踪池-周度回顾(股票/期货)-YYYYMMDD.xlsx，已存在同日期文件则自动跳过。
2. 若脚本退出码为 0：只简要报告两个文件的保存路径与大小（可用 ls -l 查看目录确认本周新文件），并说明哪些是新下载、哪些是已存在跳过。脚本 stdout 里 action=new 是新文件，action=skip 是已存在。
3. 若脚本退出码为 1 或运行报错：明确说明失败原因（脚本 stderr 输出），不要编造，不要自行改用 MCP 工具重试整个流程（仅在脚本明确提示网络/协议错误时可重试一次脚本）。
```

创建前先在本机执行一次该命令，超时同样 600 秒。退出码为 0 再保存定时任务，并把这次的路径、大小，以及新文件或跳过，告诉用户。退出码为 1 就把 stderr 原样说明，不要改用 MCP 工具重做。

## 交给别人时

每人导入本技能后，在自己的电脑上再建自己的脚本、密钥文件和定时任务。不要把某个人的 `fund-data.key`、`jy-weekly.config.json` 或定时任务正文拷给下一个人。
