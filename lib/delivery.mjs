// Delivery attestation: the seller signs, with the same key as its x402 offer/receipt,
// the hashes of the request it answered and the bytes it returned.
// v0 companion to the x402 offer-receipt Receipt (which has no response hash field yet).
import { sha256, toBytes, verifyTypedData } from 'viem';

export const DELIVERY_DOMAIN = { name: 'x402 delivery', version: '0', chainId: 1 };
export const DELIVERY_TYPES = {
  Delivery: [
    { name: 'version', type: 'uint256' },
    { name: 'network', type: 'string' },
    { name: 'resourceUrl', type: 'string' },
    { name: 'payer', type: 'string' },
    { name: 'transaction', type: 'string' },
    { name: 'requestHash', type: 'bytes32' },
    { name: 'responseHash', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
  ],
};

export const requestHash = (method, url) => sha256(toBytes(`${method.toUpperCase()} ${url}`));
export const bodyHash = (bytes) => sha256(bytes);

const toMessage = (p) => ({ ...p, version: BigInt(p.version), issuedAt: BigInt(p.issuedAt) });

export async function signDelivery(payload, account) {
  const signature = await account.signTypedData({ domain: DELIVERY_DOMAIN, types: DELIVERY_TYPES, primaryType: 'Delivery', message: toMessage(payload) });
  return { format: 'eip712', payload, signature };
}

export function verifyDelivery(signed, address) {
  return verifyTypedData({ address, domain: DELIVERY_DOMAIN, types: DELIVERY_TYPES, primaryType: 'Delivery', message: toMessage(signed.payload), signature: signed.signature });
}
