import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OTP_RESEND_COOLDOWN_MS,
  isResendCoolingDown,
  resendCooldownRemainingSeconds,
} from '../services/otpResendCooldown';

// V9-L18: the OTP Resend button had no cooldown — every tap minted a
// new challenge + WhatsApp message. After a successful send the button
// stays disabled for the cooldown with a countdown label.

test('cooldown is 30 seconds', () => {
  assert.equal(OTP_RESEND_COOLDOWN_MS, 30_000);
});

test('never started → 0 seconds, not cooling down', () => {
  assert.equal(resendCooldownRemainingSeconds(null, 1_000), 0);
  assert.equal(isResendCoolingDown(null, 1_000), false);
});

test('just started → full 30 seconds remaining', () => {
  const until = 100_000;
  assert.equal(resendCooldownRemainingSeconds(until, 70_000), 30);
  assert.equal(isResendCoolingDown(until, 70_000), true);
});

test('halfway through → 15 seconds remaining', () => {
  assert.equal(resendCooldownRemainingSeconds(100_000, 85_000), 15);
});

test('partial second rounds up (never shows 0 while still cooling down)', () => {
  assert.equal(resendCooldownRemainingSeconds(100_000, 99_500), 1);
  assert.equal(isResendCoolingDown(100_000, 99_500), true);
});

test('expired → 0 seconds, not cooling down', () => {
  assert.equal(resendCooldownRemainingSeconds(100_000, 100_000), 0);
  assert.equal(resendCooldownRemainingSeconds(100_000, 130_000), 0);
  assert.equal(isResendCoolingDown(100_000, 130_000), false);
});
