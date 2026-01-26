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
