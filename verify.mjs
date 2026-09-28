// Independent verifier for Private Delivery Proof v0 records. Trusts nothing but the records, the seller's
// did.json and a Base RPC. Usage: node verify.mjs <records dir> [did.json path or URL]
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, http, parseAbi, decodeEventLog, decodeFunctionData, sha256, getAddress } from 'viem';
import { base } from 'viem/chains';
import { verifyOfferSignatureEIP712, verifyReceiptSignatureEIP712 } from '@x402/extensions/offer-receipt';
import { x402ExactPermit2ProxyABI, x402ExactPermit2ProxyAddress } from '@x402/evm';
import { verifyDelivery } from './lib/delivery.mjs';

const ZUSDC = '0xEB81ab55Bc7aa89d1e0E3F60597D86e37702Af53';
const dir = process.argv[2] ?? 'records';
const didSrc = process.argv[3] ?? 'public/did.json';
const client = createPublicClient({ chain: base, transport: http(process.env.RPC_URL || 'https://mainnet.base.org') });
const transferAbi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);

const didBytes = didSrc.startsWith('http') ? Buffer.from(await (await fetch(didSrc)).arrayBuffer()) : fs.readFileSync(didSrc);
const did = JSON.parse(didBytes);
const didSigners = did.verificationMethod.map((m) => getAddress(m.blockchainAccountId.split(':').pop()));
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

async function check(rec) {
  const out = [];
  const ok = (name, cond, why = '') => out.push([name, !!cond, cond ? '' : why]);

  // 1. The seller signed this one-time address as its own payment address, and the key belongs to the seller's DID.
  const offer = await verifyOfferSignatureEIP712(rec.offer);
  ok('offer signed by seller DID key', didSigners.some((s) => same(s, offer.signer)), `signer ${offer.signer} not in did.json`);
  ok('did.json matches snapshot', !rec.seller.didJsonSha256 || same(sha256(didBytes), rec.seller.didJsonSha256), 'did.json changed since purchase');
  ok('offer names this address, amount, asset', same(offer.payload.payTo, rec.oneTimeAddress) && offer.payload.amount === rec.amount && same(offer.payload.asset, ZUSDC) && offer.payload.resourceUrl === rec.resourceUrl, 'offer fields differ from record');

  // 2. The money moved on Base: payer -> one-time address, through the x402 permit2 proxy, with the recorded nonce.
  const [tx, rcpt] = await Promise.all([client.getTransaction({ hash: rec.tx }), client.getTransactionReceipt({ hash: rec.tx })]);
  const blk = await client.getBlock({ blockNumber: rcpt.blockNumber });
  const moved = rcpt.status === 'success' && rcpt.logs.some((l) => {
    if (!same(l.address, ZUSDC)) return false;
    try { const e = decodeEventLog({ abi: transferAbi, ...l }); return same(e.args.from, rec.payer) && same(e.args.to, rec.oneTimeAddress) && e.args.value === BigInt(rec.amount); } catch { return false; }
  });
  ok('zUSDC transfer payer -> one-time address on Base', moved, 'no matching Transfer log');
  let settleOk = false;
  try {
    const { functionName, args } = decodeFunctionData({ abi: x402ExactPermit2ProxyABI, data: tx.input });
    settleOk = same(tx.to, x402ExactPermit2ProxyAddress) && functionName.startsWith('settle') && args[0].nonce.toString() === rec.permit2Nonce && same(args[1], rec.payer) && same(args[2].to, rec.oneTimeAddress);
  } catch {}
  ok('x402 permit2 settle with recorded nonce', settleOk, 'tx is not the recorded permit2 settlement');

  // 3. The same seller key acknowledged the payment and signed the hash of the exact bytes it returned.
  const receipt = await verifyReceiptSignatureEIP712(rec.receipt);
  const t = Number(blk.timestamp);
  ok('receipt signed by same key for this tx', same(receipt.signer, offer.signer) && same(receipt.payload.payer, rec.payer) && same(receipt.payload.transaction, rec.tx) && Math.abs(receipt.payload.issuedAt - t) <= 600, 'receipt does not match tx');
  const body = Buffer.from(rec.responseBodyBase64, 'base64');
  const d = rec.delivery.payload;
  ok('delivery hash matches the response bytes', await verifyDelivery(rec.delivery, offer.signer) && same(d.responseHash, sha256(body)) && same(d.transaction, rec.tx) && same(d.payer, rec.payer), 'delivery attestation does not match');
  return out;
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
let fail = 0;
for (const f of files) {
  const res = await check(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const bad = res.filter(([, pass]) => !pass);
  fail += bad.length ? 1 : 0;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${f}${bad.map(([n, , why]) => `\n     - ${n}: ${why}`).join('')}`);
}
console.log(`\n${files.length - fail}/${files.length} records pass all checks`);
process.exit(fail ? 1 : 0);
