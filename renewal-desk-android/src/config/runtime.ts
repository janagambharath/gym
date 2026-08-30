export type AppEnvironment = 'development' | 'staging' | 'production';

export type RuntimeConfiguration = {
  apiBaseUrl?: string;
  environment: AppEnvironment;
};

export type RuntimeConfigurationResult =
  | { ok: true; config: RuntimeConfiguration }
  | { ok: false; error: { message: string } };

type EnvironmentInput = Record<string, string | undefined>;

const VALID_ENVIRONMENTS: ReadonlySet<string> = new Set([
  'development',
  'staging',
  'production',
]);

function normalizeBaseUrl(
  value: string | undefined,
  appEnvironment: AppEnvironment,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = new URL(trimmed);
  if (parsed.username || parsed.password) {
    throw new Error('API_BASE_URL must not contain credentials.');
  }

  const isLocalDevelopmentUrl =
    appEnvironment === 'development' &&
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]');

  if (parsed.protocol !== 'https:' && !isLocalDevelopmentUrl) {
    throw new Error('API_BASE_URL must use HTTPS outside local development.');
  }

  return parsed.toString().replace(/\/$/, '');
}

function resolveEnvironment(value: string | undefined): AppEnvironment {
  const candidate = value?.trim().toLowerCase() ?? 'development';
  return VALID_ENVIRONMENTS.has(candidate)
    ? (candidate as AppEnvironment)
    : 'development';
}

export function getRuntimeEnvironment(environment?: EnvironmentInput): AppEnvironment {
  const appEnvRaw = environment
    ? environment.EXPO_PUBLIC_APP_ENV
    : process.env.EXPO_PUBLIC_APP_ENV;

  return resolveEnvironment(appEnvRaw);
}

export function getRuntimeConfiguration(
  environment?: EnvironmentInput,
): RuntimeConfiguration {
  const apiBaseUrlRaw = environment
    ? environment.EXPO_PUBLIC_API_BASE_URL
    : process.env.EXPO_PUBLIC_API_BASE_URL;

  const appEnvironment = getRuntimeEnvironment(environment);

  return {
    apiBaseUrl: normalizeBaseUrl(apiBaseUrlRaw, appEnvironment),
    environment: appEnvironment,
  };
}

/**
 * Converts an invalid deployment-time URL into a stable application error.
 * The raw value is intentionally not surfaced because public configuration can
 * still contain sensitive routing details.
 */
export function getRuntimeConfigurationSafely(
  environment?: EnvironmentInput,
): RuntimeConfigurationResult {
  try {
    return { ok: true, config: getRuntimeConfiguration(environment) };
  } catch {
    return { ok: false, error: { message: 'API configuration is invalid.' } };
  }
}
