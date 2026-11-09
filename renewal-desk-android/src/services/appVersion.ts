// App version / build reader (V11-L34).
//
// Thin reader over expo-constants (Expo SDK v57 — see
// https://docs.expo.dev/versions/v57.0.0/sdk/constants/):
// `Constants.expoConfig` is the resolved app config embedded at build
// time, so `expoConfig.version` is app.json `version` and
// `expoConfig.android.versionCode` is app.json `android.versionCode`.
// The deprecated `Constants.platform.android.versionCode` is kept as a
// fallback for binaries whose public config filters the android block.
// Label formatting lives in ./appVersionInfo (node-testable).

import Constants from 'expo-constants';
import { resolveAppVersion, type AppVersionLabels } from './appVersionInfo';

export function getAppVersion(): AppVersionLabels {
  const config = Constants.expoConfig as
    | { version?: string; android?: { versionCode?: number | string } }
    | null
    | undefined;
  const platformCode = (
    Constants.platform as { android?: { versionCode?: number | string } } | undefined
  )?.android?.versionCode;
  return resolveAppVersion({
    version: config?.version,
    versionCode: config?.android?.versionCode ?? platformCode,
  });
}
