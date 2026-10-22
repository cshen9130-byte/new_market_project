const { withAppBuildGradle } = require("@expo/config-plugins")

const LOADER = `def fofKeystorePropertiesFile = rootProject.file("../credentials/keystore.properties")
def fofKeystoreProperties = new Properties()
if (fofKeystorePropertiesFile.exists()) {
    fofKeystoreProperties.load(new FileInputStream(fofKeystorePropertiesFile))
}
`

const RELEASE_SIGNING = `        release {
            if (fofKeystorePropertiesFile.exists()) {
                storeFile file(fofKeystoreProperties["storeFile"])
                storePassword fofKeystoreProperties["storePassword"]
                keyAlias fofKeystoreProperties["keyAlias"]
                keyPassword fofKeystoreProperties["keyPassword"]
            }
        }`

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") return config
    let src = config.modResults.contents
    if (src.includes("fofKeystorePropertiesFile")) return config
    src = src.replace(/android\s*\{/, `${LOADER}\nandroid {`)
    src = src.replace(
      /signingConfigs\s*\{\s*debug\s*\{/,
      `signingConfigs {\n${RELEASE_SIGNING}\n        debug {`,
    )
    src = src.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig fofKeystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug",
    )
    config.modResults.contents = src
    return config
  })
}

module.exports = withAndroidReleaseSigning
