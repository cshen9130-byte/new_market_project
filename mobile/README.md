# 母基金投研手机版

iPhone、Android 和华为手机共用这一份应用。它登录现有网站，提供跟踪产品、基金搜索和净值走势。MOM 风控、估值表、导入和行情终端仍在电脑上使用。

服务器地址填网站根地址。电脑上的手机预览填 `http://127.0.0.1:3000`。真机填这台电脑的局域网 IP 加端口，例如 `http://192.168.110.54:3000`，不要填 `localhost`，也不要照抄示例网段。

## 开发时在手机上打开

```bash
cd mobile
npm install
npx expo start
```

用手机安装与 Expo SDK 58 匹配的 Expo Go，扫终端里的二维码。电脑和手机要在同一网络。如果 Expo Go 提示 SDK 不兼容，改用下面的安装包，不依赖 Expo Go。

## 安装到 Android 和华为手机

生成可直接安装的 APK（不依赖 Google Play）：

```bash
cd mobile
npx eas-cli@latest build -p android --profile preview
```

第一次会要求登录 Expo 账号。构建完成后下载 APK，传到手机安装。

华为手机使用这份 Android 安装包。若系统提示风险，在设置里允许安装未知来源应用，并关闭「纯净模式」后再安装。仍带安卓兼容层的 HarmonyOS 可以安装。纯血 HarmonyOS NEXT 不能安装 APK，需要单独的鸿蒙工程，这一版不包含。

## 安装到 iPhone

需要 Apple 开发者账号，在 macOS 或 Expo 云端构建：

```bash
cd mobile
npx eas-cli@latest build -p ios --profile preview
```

没有 Mac 时，用上面的云端命令即可，不要在 Windows 上运行 `npm run ios`。
