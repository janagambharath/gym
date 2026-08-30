import assert from 'node:assert/strict';
import test from 'node:test';
import { getRuntimeConfiguration, getRuntimeConfigurationSafely, getRuntimeEnvironment } from '../config/runtime';

test('uses a safe development default when no environment is supplied', () => {
  assert.deepEqual(getRuntimeConfiguration({}), {
    apiBaseUrl: undefined,
    environment: 'development',
  });
});

test('normalizes a configured HTTPS base URL', () => {
  assert.deepEqual(
    getRuntimeConfiguration({
      EXPO_PUBLIC_API_BASE_URL: 'https://renewal.example/',
      EXPO_PUBLIC_APP_ENV: 'production',
    }),
    {
      apiBaseUrl: 'https://renewal.example',
      environment: 'production',
    },
  );
});

test('does not invent a production API URL when none was supplied', () => {
  assert.deepEqual(
    getRuntimeConfiguration({ EXPO_PUBLIC_APP_ENV: 'production' }),
    {
      apiBaseUrl: undefined,
      environment: 'production',
    },
  );
});

test('rejects an insecure non-local API URL', () => {
  assert.throws(
    () => getRuntimeConfiguration({ EXPO_PUBLIC_API_BASE_URL: 'http://renewal.example' }),
    /HTTPS/,
  );
});

test('permits a loopback HTTP API only in development', () => {
  assert.equal(
    getRuntimeConfiguration({
      EXPO_PUBLIC_API_BASE_URL: 'http://localhost:5080',
      EXPO_PUBLIC_APP_ENV: 'development',
    }).apiBaseUrl,
    'http://localhost:5080',
  );
});

test('rejects loopback HTTP outside development', () => {
  assert.throws(
    () =>
      getRuntimeConfiguration({
        EXPO_PUBLIC_API_BASE_URL: 'http://localhost:5080',
        EXPO_PUBLIC_APP_ENV: 'production',
      }),
    /HTTPS/,
  );
});

test('rejects credentials embedded in the API URL', () => {
  assert.throws(
    () => getRuntimeConfiguration({ EXPO_PUBLIC_API_BASE_URL: 'https://user:password@renewal.example' }),
    /credentials/,
  );
});

test('returns a controlled result when runtime API configuration is invalid', () => {
  assert.deepEqual(
    getRuntimeConfigurationSafely({
      EXPO_PUBLIC_API_BASE_URL: 'not a URL',
      EXPO_PUBLIC_APP_ENV: 'production',
    }),
    {
      ok: false,
      error: { message: 'API configuration is invalid.' },
    },
  );
});

test('reads the configured runtime environment without parsing the API URL', () => {
  assert.equal(
    getRuntimeEnvironment({
      EXPO_PUBLIC_API_BASE_URL: 'not a URL',
      EXPO_PUBLIC_APP_ENV: 'staging',
    }),
    'staging',
  );
});
