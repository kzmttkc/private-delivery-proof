// Dry run on Base mainnet state via eth_simulateV1. Signs locally, sends NOTHING.
// Simulates: USDC approve -> wrap 1 USDC to zUSDC -> zUSDC approve Permit2 -> x402 exact/permit2 settle to a fresh burn address.
import { createPublicClient, http, encodeFunctionData, erc20Abi, parseAbi, decodeEventLog, maxUint256, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { x402ExactPermit2ProxyABI, x402ExactPermit2ProxyAddress, PERMIT2_ADDRESS } from '@x402/evm';
import { env, BASE } from './lib/env.mjs';
import { newOneTimeAddress } from './lib/burn.mjs';

const client = createPublicClient({ chain: base, transport: http(BASE.rpc) });
const buyer = privateKeyToAccount(env.BUYER_KEY);
const facilitator = env.SELLER_GAS_ADDRESS;
const W = privateKeyToAccount(`0x${'ab'.repeat(32)}`).address; // placeholder hidden withdrawal address (dry run only)
const lmAbi = parseAbi(['function wrap(uint256 amount, address receiver) payable returns (uint256)']);

const t0 = Date.now();
const ota = newOneTimeAddress({ chainId: BASE.chainId, W });
console.log(`one-time address B=${ota.B} (PoW ${Date.now() - t0} ms)`);

const requirements = {
  scheme: 'exact', network: BASE.network, asset: BASE.ZUSDC, payTo: ota.B, amount: '10000',
  maxTimeoutSeconds: 300, extra: { assetTransferMethod: 'permit2' },
};
const scheme = new ExactEvmScheme(buyer);
const { payload } = await scheme.createPaymentPayload(2, requirements);
const a = payload.permit2Authorization;
const settleData = encodeFunctionData({
  abi: x402ExactPermit2ProxyABI, functionName: 'settle',
  args: [{ permitted: { token: a.permitted.token, amount: BigInt(a.permitted.amount) }, nonce: BigInt(a.nonce), deadline: BigInt(a.deadline) },
    a.from, { to: a.witness.to, validAfter: BigInt(a.witness.validAfter) }, payload.signature],
});

const calls = [
  { from: buyer.address, to: BASE.USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [BASE.ZUSDC_LIQUIDITY_MANAGER, 1_000_000n] }) },
  { from: buyer.address, to: BASE.ZUSDC_LIQUIDITY_MANAGER, data: encodeFunctionData({ abi: lmAbi, functionName: 'wrap', args: [1_000_000n, buyer.address] }) },
  { from: buyer.address, to: BASE.ZUSDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [PERMIT2_ADDRESS, maxUint256] }) },
  { from: facilitator, to: x402ExactPermit2ProxyAddress, data: settleData },
  { from: buyer.address, to: BASE.ZUSDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [ota.B] }) },
];
const [block] = await client.request({ method: 'eth_simulateV1', params: [{ blockStateCalls: [{ calls }] }, 'latest'] });
const names = ['USDC.approve(LM)', 'LM.wrap(1 USDC)', 'zUSDC.approve(Permit2)', 'proxy.settle -> B', 'zUSDC.balanceOf(B)'];
block.calls.forEach((c, i) => console.log(`${c.status === '0x1' ? 'OK  ' : 'FAIL'} ${names[i]}  gas=${parseInt(c.gasUsed, 16)}${c.error ? '  ' + JSON.stringify(c.error) : ''}`));
const transferAbi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);
for (const log of block.calls[3].logs ?? []) {
  if (log.address.toLowerCase() !== BASE.ZUSDC.toLowerCase()) continue;
  try { const e = decodeEventLog({ abi: transferAbi, ...log }); console.log(`  zUSDC Transfer ${e.args.from} -> ${e.args.to} ${formatUnits(e.args.value, 6)}`); }
  catch { console.log(`  zUSDC log topic0=${log.topics[0]}`); }
}
console.log(`B balance after settle: ${formatUnits(BigInt(block.calls[4].returnData), 6)} zUSDC`);
