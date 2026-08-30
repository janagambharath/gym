import assert from 'node:assert/strict';
import test from 'node:test';
import { configureDisplayPreferences, formatCurrency, formatDate, getGymTodayISO } from '../types';

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
