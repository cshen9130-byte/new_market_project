# iOS / EAS Build (FOF Research)

This app is Expo managed (~SDK 58). There is **no local `ios/` folder** on Windows; EAS cloud Mac builders run `prebuild` and compile. Android APK publishing stays separate and is unchanged.

## Prerequisites

1. **Expo account** — https://expo.dev (same account used for Android EAS builds if you already have one).
2. Install CLI (once):
   ```bash
   npm i -g eas-cli
   ```
3. Log in:
   ```bash
   eas login
   ```
4. From this folder (`mobile/`):
   ```bash
   cd D:\coding\market_website\mobile
   ```
5. **Apple Developer Program** ($99/year) is required for:
   - Internal / ad-hoc device builds (`preview`)
   - App Store / TestFlight (`production`)
   - Not required for **simulator** builds (`ios-simulator`)

Do **not** invent or commit Apple Team ID / credentials. On first real device or store build, EAS will prompt to create or select credentials interactively.

## Build profiles (`eas.json`)

| Profile | Platform use | Notes |
|---------|----------------|-------|
| `ios-simulator` | iOS Simulator `.app` / tar | No Apple Developer account needed |
| `preview` | Internal distribution (ad-hoc / device) | Needs Apple credentials; `distribution: internal` |
| `production` | App Store / TestFlight | Device build (not simulator); then `eas submit` |
| (same names) Android | Existing APK flow | Unchanged: `android.buildType: apk` |

`cli.appVersionSource` remains **`local`** (version / buildNumber from `app.json`).

## Commands

All of these run **EAS cloud Mac builders**. Windows cannot run `expo run:ios` / Xcode locally.

### Simulator (no Apple account)

```bash
cd mobile
eas build --platform ios --profile ios-simulator
```

Or npm script:

```bash
npm run build:ios:simulator
```

Install the artifact on a Mac Simulator (or download and open on a Mac).

### Internal device (ad-hoc / internal)

```bash
eas build --platform ios --profile preview
# or
npm run build:ios:preview
```

First run will walk through Apple credentials / provisioning. Register test devices in the Apple Developer portal or via EAS device registration as prompted.

### Production / TestFlight

```bash
eas build --platform ios --profile production
# or
npm run build:ios:production
```

After a successful production build:

```bash
eas submit --platform ios --latest
```

(or select the build in the Expo dashboard). TestFlight / App Store Connect must already have the app record for bundle id `com.marketwebsite.fofresearch`.

## Version parity

- `expo.version` — user-facing version (e.g. `1.6.63`)
- Android `versionCode` — integer (e.g. `70`)
- iOS `buildNumber` — string matching Android for parity (e.g. `"70"`)
- `ITSAppUsesNonExemptEncryption: false` is set unless you later add non-exempt crypto

Bump `version` + Android `versionCode` + iOS `buildNumber` together before release builds.

## Relation to Android APK publish

- Android continues to use EAS **APK** profiles (`preview` / `production` android sections) and your existing sideload / in-app update flow.
- iOS uses separate EAS artifacts (ipa / simulator). **Do not** change the production server for iOS; App Store / TestFlight distribution is independent of the Android APK host.
- In-app APK install (`expo-intent-launcher`, `REQUEST_INSTALL_PACKAGES`) is **Android-only** and is gated so iOS does not crash.

## Windows note

- `npm install` / `postinstall` runs the PowerShell speech patch **only on Windows**; on EAS Linux→Mac iOS builders it no-ops so installs succeed.
- Local `npm run ios` / `expo run:ios` will not work without a Mac + Xcode. Prefer EAS profiles above.

## First-time human checklist

1. `eas login`
2. Confirm Expo project is linked to slug `fof-research`
3. For device/store: enroll Apple Developer Program; let EAS create credentials on first build
4. Run `ios-simulator` once to validate the cloud build path without Apple billing
5. Then `preview` / `production` when ready for devices / TestFlight
6. Do not push git / do not run a full paid build unless you intend to (credentials + network billing)
