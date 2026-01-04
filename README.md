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

## 许可证

未设置开源许可证，如需开源请添加合适的许可证文件。
