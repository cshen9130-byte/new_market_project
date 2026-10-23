const fs = require("fs")
const path = require("path")
const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins")

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`

function withAndroidCleartext(config) {
  config = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0]
    if (!application) return config
    application.$ = application.$ || {}
    application.$["android:usesCleartextTraffic"] = "true"
    application.$["android:networkSecurityConfig"] = "@xml/network_security_config"
    const replace = new Set(
      (application.$["tools:replace"] || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    )
    replace.add("android:usesCleartextTraffic")
    replace.add("android:networkSecurityConfig")
    application.$["tools:replace"] = [...replace].join(",")
    return config
  })

  return withDangerousMod(config, [
    "android",
    (config) => {
      const dir = path.join(config.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml")
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, "network_security_config.xml"), NETWORK_SECURITY_CONFIG)
      return config
    },
  ])
}

module.exports = withAndroidCleartext
