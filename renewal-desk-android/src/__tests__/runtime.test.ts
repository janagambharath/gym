import assert from 'node:assert/strict';
import test from 'node:test';
import { getRuntimeConfiguration } from '../config/runtime';

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
