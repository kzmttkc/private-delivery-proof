// Read-only: prints Base balances of the demo wallets. Sends nothing.
import 'node:process';
import fs from 'node:fs';
import { createPublicClient, http, formatEther, formatUnits, erc20Abi } from 'viem';
import { base } from 'viem/chains';

const env = Object.fromEntries(fs.readFileSync(new URL('.env', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => l.split('=')));
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ZUSDC = '0xEB81ab55Bc7aa89d1e0E3F60597D86e37702Af53';
const c = createPublicClient({ chain: base, transport: http(process.env.RPC_URL || 'https://mainnet.base.org') });

for (const name of ['BUYER_ADDRESS', 'SELLER_GAS_ADDRESS']) {
  const a = env[name];
  const [eth, usdc, zusdc] = await Promise.all([
    c.getBalance({ address: a }),
    c.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] }),
    c.readContract({ address: ZUSDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] }),
  ]);
  console.log(`${name.replace('_ADDRESS', '')} ${a}  ETH ${formatEther(eth)}  USDC ${formatUnits(usdc, 6)}  zUSDC ${formatUnits(zusdc, 6)}`);
}
