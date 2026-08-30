import assert from 'node:assert/strict';
import test from 'node:test';
import { getUserFacingApiError } from '../services/apiErrors';

test('maps infrastructure errors to a safe user-facing message', () => {
  assert.equal(
    getUserFacingApiError({ code: 'DB_ERROR', message: 'sqlalchemy.exc.OperationalError: credentials' }),
    'Something went wrong. Please try again.',
  );
});

test('keeps short validation messages that help an operator correct input', () => {
  assert.equal(
    getUserFacingApiError({ code: 'VALIDATION_ERROR', message: 'Renewal days must be between 1 and 730.' }),
    'Renewal days must be between 1 and 730.',
  );
});

test('maps authorization and rate limiting to clear recovery guidance', () => {
  assert.equal(
    getUserFacingApiError({ status: 403 }),
    'You do not have permission to perform this action.',
  );
  assert.equal(
    getUserFacingApiError({ code: 'RATE_LIMITED' }),
    'Too many requests. Please wait a moment and try again.',
  );
});
