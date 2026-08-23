export type AppEnvironment = 'development' | 'staging' | 'production';

export type RuntimeConfiguration = {
  apiBaseUrl?: string;
  environment: AppEnvironment;
};

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

export function getRuntimeConfiguration(
  environment: EnvironmentInput = process.env,
): RuntimeConfiguration {
  const appEnvironment = resolveEnvironment(environment.EXPO_PUBLIC_APP_ENV);

  return {
    apiBaseUrl: normalizeBaseUrl(environment.EXPO_PUBLIC_API_BASE_URL, appEnvironment),
    environment: appEnvironment,
  };
}
