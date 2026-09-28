// Buyer run: sets up zUSDC, then buys N times from the test seller and writes one public record per purchase.
// Shows exactly what will be sent and waits for "yes" before sending anything.
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { createWalletClient, http, publicActions, erc20Abi, parseAbi, parseEther, formatEther, formatUnits, decodeEventLog, decodeFunctionData, sha256 } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount, nonceManager } from 'viem/accounts';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { PERMIT2_ADDRESS, x402ExactPermit2ProxyABI } from '@x402/evm';
import { encodePaymentSignatureHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { verifyOfferSignatureEIP712 } from '@x402/extensions/offer-receipt';
import { env, BASE } from './lib/env.mjs';
import { startSeller, PRICE } from './seller.mjs';

const N = Number(process.env.PURCHASES ?? 20);
const WRAP = 1_000_000n; // 1 USDC
const GAS_TOPUP = parseEther('0.001');
const buyer = privateKeyToAccount(env.BUYER_KEY, { nonceManager });
const w = createWalletClient({ account: buyer, chain: base, transport: http(BASE.rpc) }).extend(publicActions);
const lmAbi = parseAbi(['function wrap(uint256 amount, address receiver) payable returns (uint256)']);
const indexedAbi = parseAbi(['event IndexedTransfer(uint256 indexed index, address from, address to, uint256 value)']);
const bal = (token, a) => w.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [a] });

const need = BigInt(PRICE) * BigInt(N);
const [zBal, allowance, sellerEth, usdc, eth] = await Promise.all([
  bal(BASE.ZUSDC, buyer.address),
  w.readContract({ address: BASE.ZUSDC, abi: erc20Abi, functionName: 'allowance', args: [buyer.address, PERMIT2_ADDRESS] }),
  w.getBalance({ address: env.SELLER_GAS_ADDRESS }), bal(BASE.USDC, buyer.address), w.getBalance({ address: buyer.address }),
]);
const steps = [];
if (zBal < need) steps.push(`USDC ${formatUnits(WRAP, 6)} を zUSDC に換える（zERC20 公式の LiquidityManager ${BASE.ZUSDC_LIQUIDITY_MANAGER}）`);
if (allowance < need) steps.push(`Permit2 に zUSDC ${formatUnits(WRAP, 6)} までの引き落としを許可する`);
if (sellerEth < GAS_TOPUP / 2n) steps.push(`売り手のガス用 ${env.SELLER_GAS_ADDRESS} へ ETH ${formatEther(GAS_TOPUP)} を送る`);
steps.push(`テスト用の売り手から ${N} 回買う: 1回 ${formatUnits(BigInt(PRICE), 6)} zUSDC、宛先は毎回ちがう使い捨てアドレス（合計 ${formatUnits(need, 6)} zUSDC）`);

console.log(`\nネットワーク: Base メインネット（${BASE.rpc}）`);
console.log(`買い手: ${buyer.address}  残高 USDC ${formatUnits(usdc, 6)} / zUSDC ${formatUnits(zBal, 6)} / ETH ${formatEther(eth)}`);
console.log('\nこれから送るもの:');
steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
console.log('見込みのガス代: 合計 $0.2 未満\n');
if (process.env.AUTO_YES !== '1') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question('実行してよければ yes と入力: ')).trim();
  rl.close();
  if (ans !== 'yes') { console.log('中止しました。何も送っていません。'); process.exit(0); }
}

const send = async (label, p, visible) => {
  const hash = await p; const r = await w.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} failed ${hash}`);
  console.log(`  ok ${label} https://basescan.org/tx/${hash}`);
  // The public RPC is load-balanced; wait until the new state is visible before the next step.
  for (let i = 0; visible && i < 30 && !(await visible()); i++) await new Promise((ok) => setTimeout(ok, 2000));
};
const lmAllowance = () => w.readContract({ address: BASE.USDC, abi: erc20Abi, functionName: 'allowance', args: [buyer.address, BASE.ZUSDC_LIQUIDITY_MANAGER] });
if (zBal < need) {
  if ((await lmAllowance()) < WRAP) await send('USDC approve', w.writeContract({ address: BASE.USDC, abi: erc20Abi, functionName: 'approve', args: [BASE.ZUSDC_LIQUIDITY_MANAGER, WRAP] }), async () => (await lmAllowance()) >= WRAP);
  await send('wrap', w.writeContract({ address: BASE.ZUSDC_LIQUIDITY_MANAGER, abi: lmAbi, functionName: 'wrap', args: [WRAP, buyer.address] }), async () => (await bal(BASE.ZUSDC, buyer.address)) >= need);
}
if (allowance < need) await send('zUSDC approve Permit2', w.writeContract({ address: BASE.ZUSDC, abi: erc20Abi, functionName: 'approve', args: [PERMIT2_ADDRESS, WRAP] }),
  async () => (await w.readContract({ address: BASE.ZUSDC, abi: erc20Abi, functionName: 'allowance', args: [buyer.address, PERMIT2_ADDRESS] })) >= need);
if (sellerEth < GAS_TOPUP / 2n) await send('seller gas top-up', w.sendTransaction({ to: env.SELLER_GAS_ADDRESS, value: GAS_TOPUP }), async () => (await w.getBalance({ address: env.SELLER_GAS_ADDRESS })) >= GAS_TOPUP / 2n);

const seller = await startSeller();
const scheme = new ExactEvmScheme(buyer);
fs.mkdirSync(new URL('./records/', import.meta.url), { recursive: true });
const didFile = new URL('./public/did.json', import.meta.url);
const didSha = fs.existsSync(didFile) ? sha256(fs.readFileSync(didFile)) : null;

for (let i = 1; i <= N; i++) {
  const r402 = await fetch(seller.url);
  if (r402.status !== 402) throw new Error(`expected 402, got ${r402.status}`);
  const pr = await r402.json();
  const accepted = pr.accepts[0];
  const offer = pr.extensions['offer-receipt'].info.offers[0];
  const ov = await verifyOfferSignatureEIP712(offer);
  if (ov.signer.toLowerCase() !== seller.signer.toLowerCase() || ov.payload.payTo !== accepted.payTo || ov.payload.amount !== accepted.amount || ov.payload.asset !== accepted.asset)
    throw new Error('offer does not match the payment request');
  const { x402Version, payload } = await scheme.createPaymentPayload(2, accepted);
  const res = await fetch(seller.url, { headers: { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader({ x402Version, resource: pr.resource, accepted, payload }) } });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (res.status !== 200) throw new Error(`purchase ${i}: ${res.status} ${bytes}`);
  const settlement = decodePaymentResponseHeader(res.headers.get('PAYMENT-RESPONSE'));
  const tx = await w.getTransaction({ hash: settlement.transaction });
  const rcpt = await w.getTransactionReceipt({ hash: settlement.transaction });
  const idxLog = rcpt.logs.find((l) => l.address.toLowerCase() === BASE.ZUSDC.toLowerCase() && (() => { try { decodeEventLog({ abi: indexedAbi, ...l }); return true; } catch { return false; } })());
  const settleArgs = decodeFunctionData({ abi: x402ExactPermit2ProxyABI, data: tx.input }).args;
  const record = {
    v: 0, purchase: i, network: BASE.network, asset: BASE.ZUSDC, resourceUrl: pr.resource.url,
    seller: { did: pr.issuer.did, signer: seller.signer, didJsonSha256: didSha },
    oneTimeAddress: accepted.payTo, amount: accepted.amount, payer: buyer.address,
    offer, receipt: settlement.extensions['offer-receipt'].info.receipt, delivery: settlement.extensions['x402-delivery'].info.delivery,
    tx: settlement.transaction, block: Number(rcpt.blockNumber),
    indexedTransfer: idxLog ? decodeEventLog({ abi: indexedAbi, ...idxLog }).args.index.toString() : null,
    permit2Nonce: settleArgs[0].nonce.toString(),
    responseBodyBase64: bytes.toString('base64'),
  };
  fs.writeFileSync(new URL(`./records/${String(i).padStart(3, '0')}.json`, import.meta.url), JSON.stringify(record, null, 1));
  console.log(`  ${i}/${N} ${accepted.payTo} https://basescan.org/tx/${settlement.transaction}`);
}
seller.server.close();
console.log(`\n完了: ${N} 件。記録は records/ にあります。検算: node verify.mjs records`);
