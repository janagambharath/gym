import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAvatarContent } from '../components/avatarContent';

// Member photo (§5.3): Avatar renders <Image> with photoUrl, initials
// without. The component itself cannot be imported under node
// (react-native's Flow-typed entry), so these tests cover the
// photo-vs-initials decision Avatar.tsx renders from.

test('photoUrl present → photo kind with the URL', () => {
  assert.deepEqual(
    resolveAvatarContent({ name: 'Abhi Goud', photoUrl: 'https://example.test/p.jpg' }),
    { kind: 'photo', uri: 'https://example.test/p.jpg' },
  );
});

test('no photoUrl → initials kind with first+last initials', () => {
  const content = resolveAvatarContent({ name: 'Abhi Goud' });
  assert.equal(content.kind, 'initials');
  if (content.kind === 'initials') {
    assert.equal(content.initials, 'AG');
  }
});

test('null photoUrl → initials (same as missing)', () => {
  const content = resolveAvatarContent({ name: 'Abhi Goud', photoUrl: null });
  assert.equal(content.kind, 'initials');
});

test('empty / whitespace photoUrl → initials, never a broken image', () => {
  assert.equal(resolveAvatarContent({ name: 'Abhi Goud', photoUrl: '' }).kind, 'initials');
  assert.equal(resolveAvatarContent({ name: 'Abhi Goud', photoUrl: '   ' }).kind, 'initials');
});

test('single-word name → first letter as initials', () => {
  const content = resolveAvatarContent({ name: 'abhi' });
  assert.equal(content.kind, 'initials');
  if (content.kind === 'initials') {
    assert.equal(content.initials, 'A');
  }
});

test('initials colour is deterministic per name', () => {
  const first = resolveAvatarContent({ name: 'Abhi Goud' });
  const second = resolveAvatarContent({ name: 'Abhi Goud' });
  assert.deepEqual(first, second);
});

test('explicit colour overrides the name-derived colour', () => {
  const content = resolveAvatarContent({ name: 'Abhi Goud', color: '#123456' });
  assert.equal(content.kind, 'initials');
  if (content.kind === 'initials') {
    assert.equal(content.color, '#123456');
  }
});
