import assert from 'node:assert/strict';
import test from 'node:test';
import { configureDisplayPreferences, formatCurrency, formatDate, getGymTodayISO, isValidTimezone, safeDateKeyInTimezone } from '../types';

test('formats configured currencies without conversion', () => {
  const cases = [
    { country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata', expected: /₹/ },
    { country: 'AE', currency: 'AED', timezone: 'Asia/Dubai', expected: /AED/ },
    { country: 'GB', currency: 'GBP', timezone: 'Europe/London', expected: /£/ },
    { country: 'AU', currency: 'AUD', timezone: 'Australia/Sydney', expected: /\$/ },
    { country: 'US', currency: 'USD', timezone: 'America/New_York', expected: /\$/ },
  ];
  for (const locale of cases) {
    configureDisplayPreferences(locale);
    assert.match(formatCurrency('1499.00'), locale.expected);
  }
});

test('uses the gym timezone for date presentation and new records', () => {
  configureDisplayPreferences({ country: 'AE', currency: 'AED', timezone: 'Asia/Dubai' });
  assert.notEqual(formatDate('not-a-date'), 'not-a-date');
  assert.match(getGymTodayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

// V5-L32: an invalid gym timezone must never crash a money screen.
test('validates gym timezones', () => {
  assert.equal(isValidTimezone('Asia/Kolkata'), true);
  assert.equal(isValidTimezone('Not/AZone'), false);
  assert.equal(isValidTimezone(''), false);
});

test('safeDateKeyInTimezone uses the gym timezone and never throws on a bad one', () => {
  // 2026-11-06 20:00 UTC is 2026-11-07 01:30 in Kolkata.
  assert.equal(
    safeDateKeyInTimezone(new Date('2026-11-06T20:00:00.000Z'), 'Asia/Kolkata'),
    '2026-11-07',
  );
  assert.equal(
    safeDateKeyInTimezone(new Date('2026-11-06T20:00:00.000Z'), 'America/New_York'),
    '2026-11-06',
  );
  // Invalid timezone: falls back to a well-formed device-local key
  // instead of throwing RangeError (the old Renew/Record Payment crash).
  assert.match(safeDateKeyInTimezone(new Date('2026-11-06T20:00:00.000Z'), 'Not/AZone'), /^\d{4}-\d{2}-\d{2}$/);
});

test('configureDisplayPreferences warns but does not throw on an invalid timezone', () => {
  assert.doesNotThrow(() =>
    configureDisplayPreferences({ country: 'IN', currency: 'INR', timezone: 'Not/AZone' }),
  );
  // Formatters still produce output (device-local fallback), never throw.
  assert.doesNotThrow(() => formatDate('2026-11-06'));
  configureDisplayPreferences({ country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' });
});
