// App version / build labels (V11-L34).
//
// Pure resolver, free of expo imports on purpose: expo-constants
// cannot be imported under node, so the "what do we show when the
// config is missing a field?" decision lives here where the `tsx
// --test` harness can exercise it directly. The Constants reader is
// in ./appVersion.
//
// The bug it fixes: Settings showed hardcoded "1.0.0" /
// "Production Release (Build 5)" while app.json said versionCode 45 —
// every build reported the same two strings, so a stale-build
// diagnosis (the Yodha Nov 7 incident needed bundle-hash forensics)
// had no stamp an owner or support could read.

export type AppVersionLabels = {
  /** Display version, e.g. "1.0.0". */
  versionLabel: string;
  /** Display build, e.g. "Build 45". */
  buildLabel: string;
};

/**
 * Resolve display labels from the embedded app config. Missing values
 * degrade to an honest "Unknown" instead of a stale literal — a build
 * that cannot report its own version must not claim to be 1.0.0.
 */
export function resolveAppVersion(input: {
  version?: string | number | null;
  versionCode?: string | number | null;
}): AppVersionLabels {
  const version = input.version === undefined || input.version === null
    ? ''
    : String(input.version).trim();
  const code = input.versionCode === undefined || input.versionCode === null
    ? ''
    : String(input.versionCode).trim();
  return {
    versionLabel: version || 'Unknown',
    buildLabel: code ? `Build ${code}` : 'Build unknown',
  };
}
