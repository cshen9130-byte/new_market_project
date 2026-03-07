# 市场环境监测系统（Next.js）

本仓库包含主站（赛博风格）以及可选的经典风格子站代码（位于 `market-analysis-website/`）。

## 本地开发

```bash
pnpm install
pnpm dev
```

- 访问：http://localhost:3000
- 登录账户：账户名 `ben`，密码 `123456`

## 构建与生产启动

```bash
pnpm build
pnpm start
```

可选环境变量：

- `NEXT_PUBLIC_CLASSIC_URL`：经典风格站点地址（例如 `http://<SERVER_IP>:3002`）。

在生产环境可将其写入 `.env.production`：

```bash
NEXT_PUBLIC_CLASSIC_URL=http://<SERVER_IP>:3002
```

## 经典风格子站（可选）

子站目录：`market-analysis-website/`

```bash
cd market-analysis-website
pnpm install
pnpm build
pnpm start
```

建议通过反向代理或不同端口提供服务。

## 部署要点

- 推荐 Ubuntu LTS，安装 Node LTS 与 pnpm（通过 Corepack）
- 生产环境使用 `pnpm build` + `pnpm start` 或配合 `systemd` 与 Nginx
- 服务器克隆本仓库至 `/opt` 等目录，并确保目录所有权为运行用户

## Nginx static alias for MOM report

To serve the MOM report directly from Nginx at `/mom_report/` while proxying the Next.js app:

1) Copy the repo to your server and install/build:

```bash
cd /srv/market_dashboard_website
pnpm install --frozen-lockfile
pnpm build
```

2) Start the Next.js app (default on port 3000) with PM2:

```bash
pm2 start ecosystem.config.js
pm2 save
```

3) Install and enable the Nginx site (requires sudo):

```bash
sudo bash scripts/deploy/setup-nginx.sh \
	--domain your.domain.com \
	--app-port 3000 \
	--project-root /srv/market_dashboard_website
```

This creates `/etc/nginx/sites-available/market_dashboard_website.conf` with:
- Reverse proxy to the Next.js app on `127.0.0.1:3000`.
- Static alias for `/mom_report/` mapped to `/srv/market_dashboard_website/public/mom_report/`.

Verify after reload:
- App: `http://your.domain.com/`
- Report: `http://your.domain.com/mom_report/report.html`

In production, `.env.production` sets `NEXT_PUBLIC_MOM_REPORT_URL=/mom_report/report.html` so the button and iframe use the same-origin Nginx alias.

## AI 知识库（外部目录 + DashScope Qwen）

新增页面：`/dashboard/ai-knowledge`

功能：
- 左侧显示服务器外部目录中的资料文件夹和文档，可新建文件夹、上传文件、在线预览、下载。
- 右侧是知识库问答区，使用 LangChain 检索结构和 DashScope Qwen 模型进行文档问答。
- 文档目录默认创建在项目目录之外，避免网站更新时被覆盖。

建议在服务器设置以下环境变量：

```bash
AI_KB_STORAGE_DIR=/root/market_dashboard_storage/ai-knowledge-base
DASHSCOPE_API_KEY=<YOUR_DASHSCOPE_API_KEY>
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_CHAT_MODEL=qwen-plus
DASHSCOPE_EMBEDDING_MODEL=text-embedding-v3
```

说明：
- `AI_KB_STORAGE_DIR` 应指向项目仓库外的持久化目录，例如 `/root/market_dashboard_storage/ai-knowledge-base`。
- 目录会在第一次访问知识库 API 时自动创建，无需手动预建。
- 当前问答支持 `txt`、`md`、`json`、`csv`、`html`、`pdf` 文档；其它文件仍可上传和下载，但不会参与检索。

## 用户与持久化数据存储

当前登录用户数据已经改为存储在项目目录外，避免每次部署更新代码时被覆盖。

建议在服务器设置以下环境变量：

```bash
MARKET_DASHBOARD_STORAGE_DIR=/root/market_dashboard_storage
AI_KB_STORAGE_DIR=/root/market_dashboard_storage/ai-knowledge-base
```

说明：
- 用户登录数据默认保存在 `MARKET_DASHBOARD_STORAGE_DIR/auth/users.json`。
- AI 知识库默认保存在 `MARKET_DASHBOARD_STORAGE_DIR/ai-knowledge-base`，也可以单独用 `AI_KB_STORAGE_DIR` 覆盖。
- 如果项目里原来已经有 `data/users.json`，服务第一次启动时会自动迁移到外部目录。
- 这个结构也适合后续扩展更多持久化数据，例如聊天记录、操作日志或其他业务数据。

如果后续你确定要保存更多结构化数据，数据库会比 JSON 文件更合适。当前这次改动先解决“部署覆盖登录数据”的问题，不要求你现在就安装数据库。

## Choice EmQuant API setup (Linux server)

Automate server setup for Choice EmQuant API and PM2 using the provided script. This avoids manual steps and ensures updates don’t break the API.

1) On the server, ensure pnpm and PM2 are installed, then run:

```bash
cd /root/new_market_project
git pull
bash scripts/deploy/setup-choice-emquant.sh \
	--project-root /root/new_market_project \
	--emq-username "<EMQ_USERNAME>" \
	--emq-password "<EMQ_PASSWORD>" \
	--pm2-app-name new_market_project
```

What it does:
- Creates a Python venv under the project
- Downloads and installs EmQuant Python bindings
- Writes `.choice_env.sh` with required environment vars
- Builds the Next.js app with low memory options
- Restarts via PM2 reading env from `ecosystem.config.js`

Notes:
- Do not commit credentials; pass them to the script or set them in the server shell before PM2 start.
- `ecosystem.config.js` reads `EMQ_USERNAME`, `EMQ_PASSWORD`, `EMQ_OPTIONS_EXTRA`, `PYTHON_EXE`, and `LD_LIBRARY_PATH` from the environment.
- If EmQuant native library deps are missing, the script will warn/fail; install required system libraries (e.g., `libstdc++`, `libgcc`, etc.).

### Tushare and MOM report

- Provide `TUSHARE_TOKEN` and `NEXT_PUBLIC_MOM_REPORT_URL` via `.env.production` or the setup script.
- Example: copy `.env.production.example` to `.env.production` on the server and fill values.

```bash
cp .env.production.example .env.production
vi .env.production # fill TUSHARE_TOKEN, EMQ_* if desired
```

You can also pass them directly to the setup script:

```bash
bash scripts/deploy/setup-choice-emquant.sh \
	--project-root /root/new_market_project \
	--emq-username "<EMQ_USERNAME>" \
	--emq-password "<EMQ_PASSWORD>" \
	--tushare-token "<TUSHARE_TOKEN>" \
	--mom-report-url /mom_report/report.html
```


## 许可证

未设置开源许可证，如需开源请添加合适的许可证文件。
