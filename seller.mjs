// Test seller: an x402 resource server that asks to be paid in zUSDC to a fresh one-time (burn) address,
// signs that address in an x402 offer, settles the permit2 payment itself, and signs a receipt plus
// a delivery attestation (hash of the exact bytes returned).
import http from 'node:http';
import fs from 'node:fs';
import { createWalletClient, http as viemHttp, publicActions } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount, nonceManager } from 'viem/accounts';
import { ExactEvmScheme } from '@x402/evm/exact/facilitator';
import { toFacilitatorEvmSigner } from '@x402/evm';
import { encodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { createOfferEIP712, createReceiptEIP712 } from '@x402/extensions/offer-receipt';
import { env, BASE } from './lib/env.mjs';
import { signDelivery, requestHash, bodyHash } from './lib/delivery.mjs';

export const PRICE = '10000'; // 0.01 zUSDC (6 decimals)
const PORT = Number(process.env.SELLER_PORT ?? 4402);
const ORIGIN = process.env.SELLER_ORIGIN ?? `http://127.0.0.1:${PORT}`;
const PATH = '/v1/quote';
const signKey = privateKeyToAccount(env.SELLER_SIGN_KEY);
const signTypedData = (args) => signKey.signTypedData(args);
const gas = privateKeyToAccount(env.SELLER_GAS_KEY, { nonceManager });
const wallet = createWalletClient({ account: gas, chain: base, transport: viemHttp(BASE.rpc) }).extend(publicActions);
const facilitator = new ExactEvmScheme(toFacilitatorEvmSigner({ ...wallet, address: gas.address }));

const poolFile = new URL('./seller-pool.json', import.meta.url);
const usedFile = new URL('./seller-used.json', import.meta.url);
const pool = JSON.parse(fs.readFileSync(poolFile, 'utf8'));
const used = fs.existsSync(usedFile) ? JSON.parse(fs.readFileSync(usedFile, 'utf8')) : {};
const pending = new Map(); // B -> requirements

const QUOTES = [
  'Make it work, make it right, make it fast.',
  'Simplicity is prerequisite for reliability.',
  'The cheapest, fastest and most reliable components are those that are not there.',
];

function nextAddress() {
  const entry = pool.find((p) => !used[p.B] && !pending.has(p.B));
  if (!entry) throw new Error('one-time address pool exhausted: run node gen-pool.mjs');
  return entry.B;
}

async function paymentRequired(res, resourceUrl) {
  const B = nextAddress();
  const requirements = { scheme: 'exact', network: BASE.network, asset: BASE.ZUSDC, payTo: B, amount: PRICE, maxTimeoutSeconds: 300, extra: { assetTransferMethod: 'permit2' } };
  pending.set(B, requirements);
  const offer = await createOfferEIP712(resourceUrl, { acceptIndex: 0, scheme: 'exact', network: BASE.network, asset: BASE.ZUSDC, payTo: B, amount: PRICE, offerValiditySeconds: 300 }, signTypedData);
  const body = { x402Version: 2, resource: { url: resourceUrl, mimeType: 'application/json' }, accepts: [requirements],
    extensions: { 'offer-receipt': { info: { offers: [offer] } } }, issuer: { did: env.SELLER_DID, address: signKey.address } };
  res.writeHead(402, { 'content-type': 'application/json', 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(body) });
  res.end(JSON.stringify(body));
}

async function paid(req, res, resourceUrl) {
  const payload = decodePaymentSignatureHeader(req.headers['payment-signature']);
  const B = payload.payload?.permit2Authorization?.witness?.to;
  const requirements = B && pending.get(B);
  if (!requirements) { res.writeHead(400).end('unknown or expired one-time address'); return; }
  const v = await facilitator.verify(payload, requirements);
  if (!v.isValid) { res.writeHead(402).end(`verify failed: ${v.invalidReason}`); return; }
  const s = await facilitator.settle(payload, requirements);
  if (!s.success) { res.writeHead(402).end(`settle failed: ${s.errorReason}`); return; }
  pending.delete(B);
  used[B] = s.transaction;
  fs.writeFileSync(usedFile, JSON.stringify(used, null, 1), { mode: 0o600 });

  const bytes = Buffer.from(JSON.stringify({ quote: QUOTES[Object.keys(used).length % QUOTES.length], servedAt: new Date().toISOString(), oneTimeAddress: B }));
  const receipt = await createReceiptEIP712({ resourceUrl, payer: v.payer, network: BASE.network, transaction: s.transaction }, signTypedData);
  const delivery = await signDelivery({ version: 0, network: BASE.network, resourceUrl, payer: v.payer, transaction: s.transaction,
    requestHash: requestHash(req.method, resourceUrl), responseHash: bodyHash(bytes), issuedAt: Math.floor(Date.now() / 1000) }, signKey);
  const settlement = { success: true, transaction: s.transaction, network: BASE.network, payer: v.payer,
    extensions: { 'offer-receipt': { info: { receipt } }, 'x402-delivery': { info: { delivery } } } };
  res.writeHead(200, { 'content-type': 'application/json', 'PAYMENT-RESPONSE': encodePaymentResponseHeader(settlement) });
  res.end(bytes);
}

export function startSeller() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, ORIGIN);
      if (url.pathname !== PATH) { res.writeHead(404).end(); return; }
      const resourceUrl = `${ORIGIN}${PATH}`;
      if (req.headers['payment-signature']) await paid(req, res, resourceUrl);
      else await paymentRequired(res, resourceUrl);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500).end(String(e.message ?? e));
    }
  });
  return new Promise((ok) => server.listen(PORT, '127.0.0.1', () => ok({ server, url: `${ORIGIN}${PATH}`, signer: signKey.address })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url, signer } = await startSeller();
  console.log(`test seller at ${url} (offer/receipt signer ${signer})`);
}
