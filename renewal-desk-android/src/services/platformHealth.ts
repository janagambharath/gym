export type PlatformHealth = {
  database: 'ok' | 'unavailable' | 'unknown';
  revision?: string;
  schema: 'ok' | 'unavailable' | 'unknown';
  status: 'ok' | 'unavailable' | 'unknown';
};

export class PlatformRequestError extends Error {
  readonly causeMessage?: string;

  constructor(message: string, causeMessage?: string) {
    super(message);
    this.name = 'PlatformRequestError';
    this.causeMessage = causeMessage;
  }
}

function valueAt(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function serviceState(value: string | undefined): 'ok' | 'unavailable' | 'unknown' {
  if (value === 'ok') {
    return 'ok';
  }
  if (value) {
    return 'unavailable';
  }
  return 'unknown';
}

export function parsePlatformHealth(payload: unknown): PlatformHealth {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PlatformRequestError('The backend health response was not valid JSON.');
  }

  const record = payload as Record<string, unknown>;
  const revision = valueAt(record, 'revision');
  return {
    database: serviceState(valueAt(record, 'db')),
    ...(revision ? { revision } : {}),
    schema: serviceState(valueAt(record, 'schema')),
    status: serviceState(valueAt(record, 'status')),
  };
}

export async function fetchPlatformHealth(baseUrl: string, timeoutMs = 10_000): Promise<PlatformHealth> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Accept: 'application/json' },
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new PlatformRequestError(`The backend returned ${response.status}.`);
    }

    return parsePlatformHealth(await response.json());
  } catch (error) {
    if (error instanceof PlatformRequestError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : undefined;
    throw new PlatformRequestError('Could not reach the Renewal Desk backend.', detail);
  } finally {
    clearTimeout(timeout);
  }
}
