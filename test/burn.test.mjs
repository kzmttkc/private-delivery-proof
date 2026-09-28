import test from 'node:test';
import assert from 'node:assert/strict';
import { burnAddressOrNull, recipientHash } from '../lib/burn.mjs';

test('matches zERC20 fixed vector (burn_address.rs: recipient 123456789, secret 1000+138276)', () => {
  assert.equal(burnAddressOrNull(123456789n, 1000n + 138276n).toLowerCase(), '0x3034a16d0e8b774fc609a8adcbe89ed3c5bad8c3');
});

test('rejects a secret that misses the PoW', () => {
  assert.equal(burnAddressOrNull(123456789n, 1000n), null);
});

test('recipientHash carries version byte 1 and fits the BN254 field', () => {
  const r = recipientHash({ chainId: 8453, recipient: '0x' + '11'.repeat(32), tweak: '0x' + '22'.repeat(32) });
  assert.equal(r >> 248n, 1n);
});
