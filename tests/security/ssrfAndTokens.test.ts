import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDeviceToken,
  generatePairingCode,
  hashToken,
  isPrivateIp,
  validateSafeExternalUrl,
} from '../../src/lib/security.ts';

test('isPrivateIp blocks loopback, RFC1918, link-local metadata, and IPv6 ULA', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.0.0.5'), true);
  assert.equal(isPrivateIp('172.16.4.2'), true);
  assert.equal(isPrivateIp('192.168.1.10'), true);
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('fe80::1'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
});

test('validateSafeExternalUrl rejects localhost, metadata endpoints, and non-HTTP schemes', async () => {
  await assert.rejects(() => validateSafeExternalUrl('http://localhost:3000/test.m3u'));
  await assert.rejects(() => validateSafeExternalUrl('http://169.254.169.254/latest/meta-data/'));
  await assert.rejects(() => validateSafeExternalUrl('file:///etc/passwd'));
  await assert.rejects(() => validateSafeExternalUrl('http://metadata.google.internal/'));
});

test('device token generation hashes deterministically and formats pairing codes', () => {
  const { rawToken, tokenHash, tokenPrefix } = generateDeviceToken();
  assert.ok(rawToken.startsWith('viptv_'));
  assert.equal(tokenHash, hashToken(rawToken));
  assert.equal(tokenPrefix, rawToken.slice(0, 14));

  const code = generatePairingCode();
  assert.match(code, /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
});
