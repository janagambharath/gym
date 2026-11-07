import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMarkAllRead,
  applyMarkRead,
  revertMarkRead,
} from '../services/notificationRead';

// V8-L33: tapping an unread notification fired POST
// /notifications/:id/read fire-and-forget while marking the item read
// locally. On POST failure the UI said "read" while the server stayed
// unread until the next load. The screen now awaits the POST and reverts
// the optimistic update — these are the exact transitions it applies.

const sample = [
  { id: 1, is_read: false },
  { id: 2, is_read: false },
  { id: 3, is_read: true },
];

test('applyMarkRead marks only the tapped item read and decrements once', () => {
  const { items, decremented } = applyMarkRead(sample, 2);
  assert.equal(decremented, true);
  assert.deepEqual(items.map((n) => n.is_read), [false, true, true]);
  // No mutation of the input list.
  assert.equal(sample[1].is_read, false);
});

test('applyMarkRead on an already-read item changes nothing and does not decrement', () => {
  const { items, decremented } = applyMarkRead(sample, 3);
  assert.equal(decremented, false);
  assert.deepEqual(items.map((n) => n.is_read), [false, false, true]);
});

test('applyMarkRead on an unknown id changes nothing and does not decrement', () => {
  const { items, decremented } = applyMarkRead(sample, 99);
  assert.equal(decremented, false);
  assert.deepEqual(items.map((n) => n.is_read), [false, false, true]);
});

test('revertMarkRead is the exact inverse of applyMarkRead', () => {
  const { items: optimistic } = applyMarkRead(sample, 1);
  assert.deepEqual(revertMarkRead(optimistic, 1), sample);
});

test('revertMarkRead touches only the failed item', () => {
  const { items: optimistic } = applyMarkRead(sample, 1);
  assert.deepEqual(
    revertMarkRead(optimistic, 2).map((n) => n.is_read),
    [true, false, true],
  );
});

test('applyMarkAllRead marks every unread item read and leaves read items alone', () => {
  assert.deepEqual(
    applyMarkAllRead(sample).map((n) => n.is_read),
    [true, true, true],
  );
  assert.deepEqual(
    applyMarkAllRead([{ id: 1, is_read: true }]).map((n) => n.is_read),
    [true],
  );
});
