const fs = require('fs');
const path = require('path');
const { withStringsXml, AndroidConfig } = require('@expo/config-plugins');

/**
 * Keys in `assets/locales/*.json` (configured via expo's `locales` field) are
 * written by Expo into Android's `values-b+<locale>/strings.xml`, but never
 * into the default `values/strings.xml`. Android's `ExtraTranslation` lint then
 * fails the release build:
 *
 *   Error: "NSCameraUsageDescription" is translated here but not found in
 *   default locale [ExtraTranslation]
 *
 * These keys are iOS Info.plist descriptions and are unused on Android, but a
 * default entry must exist so every translation has a fallback. This plugin
 * injects an English default for every key found across the locale files.
 *
 * Provide English defaults here; any locale key without an explicit default
 * falls back to a build-time error so we never silently ship the wrong language
 * in the default locale.
 */
const ENGLISH_DEFAULTS = {
  NSCameraUsageDescription:
    'ID Tjek uses the camera to scan the customer’s age-verification QR code.',
};

const LOCALES_DIR = path.resolve(__dirname, '..', 'assets', 'locales');

function collectLocaleKeys() {
  const keys = new Set();
  if (!fs.existsSync(LOCALES_DIR)) return keys;
  for (const file of fs.readdirSync(LOCALES_DIR)) {
    if (!file.endsWith('.json')) continue;
    const json = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8')
    );
    for (const key of Object.keys(json)) keys.add(key);
  }
  return keys;
}

module.exports = function withAndroidDefaultLocaleStrings(config) {
  return withStringsXml(config, (config) => {
    for (const key of collectLocaleKeys()) {
      const value = ENGLISH_DEFAULTS[key];
      if (value == null) {
        throw new Error(
          `[withAndroidDefaultLocaleStrings] No English default for locale key "${key}". ` +
            `Add it to ENGLISH_DEFAULTS in plugins/withAndroidDefaultLocaleStrings.js.`
        );
      }
      config.modResults = AndroidConfig.Strings.setStringItem(
        [{ $: { name: key }, _: value }],
        config.modResults
      );
    }
    return config;
  });
};
