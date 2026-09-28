// zERC20 burn-address derivation, reimplemented from the public spec with MIT code (poseidon-lite).
// B = low160(Poseidon3(D_burn, r, s)), with bits 160..175 of the hash all zero (PoW difficulty 16).
// r = recipientHash = (sha256(chainId:u64 || recipient:bytes32 || tweak:bytes32) & (2^248-1)) | (1 << 248)
import { poseidon3 } from 'poseidon-lite';
import { encodePacked, sha256, getAddress, toHex } from 'viem';
import { randomBytes } from 'node:crypto';

export const BN254_P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const D_BURN = BigInt('0x' + Buffer.from('burn').reverse().toString('hex')); // "burn" as 32 little-endian bytes
const ADDRESS_BITS = 160n;
const POW_BITS = 16n;

export function recipientHash({ chainId, recipient, tweak }) {
  const digest = BigInt(sha256(encodePacked(['uint64', 'bytes32', 'bytes32'], [BigInt(chainId), recipient, tweak])));
  return (digest & ((1n << 248n) - 1n)) | (1n << 248n);
}

export function burnHash(r, s) {
  return poseidon3([D_BURN, r, s]);
}

export function burnAddressOrNull(r, s) {
  const h = burnHash(r, s);
  if (((h >> ADDRESS_BITS) & ((1n << POW_BITS) - 1n)) !== 0n) return null;
  return getAddress(toHex(h & ((1n << ADDRESS_BITS) - 1n), { size: 20 }));
}

// Finds s = seed + nonce satisfying the PoW, as zERC20's find_pow_nonce does.
export function findBurnAddress(r, seed) {
  for (let n = 0n; ; n++) {
    const s = (seed + n) % BN254_P;
    const B = burnAddressOrNull(r, s);
    if (B) return { s, B, nonce: n };
  }
}

export function recipientToBytes32(address) {
  return toHex(BigInt(address), { size: 32 });
}

// One fresh one-time address for a seller whose hidden withdrawal address is W.
export function newOneTimeAddress({ chainId, W }) {
  const tweak = toHex(randomBytes(32));
  const gr = { chainId, recipient: recipientToBytes32(W), tweak };
  const r = recipientHash(gr);
  const seed = BigInt(toHex(randomBytes(31)));
  const { s, B } = findBurnAddress(r, seed);
  return { gr, r, s, B };
}
