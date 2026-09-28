import { http, fallback } from 'viem';
import fs from 'node:fs';
export const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
export const BASE = {
  chainId: 8453,
  network: 'eip155:8453',
  rpc: process.env.RPC_URL || 'https://mainnet.base.org',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  ZUSDC: '0xEB81ab55Bc7aa89d1e0E3F60597D86e37702Af53',
  ZUSDC_LIQUIDITY_MANAGER: '0x04be137Df79bE7B5F3314C4a84D1C5E0d99BD477',
};

// One provider at a time (fallback only on failure), so reads stay consistent. RPC_URL overrides (e.g. a local fork).
export const transport = () => process.env.RPC_URL ? http(process.env.RPC_URL)
  : fallback([http('https://base.drpc.org'), http('https://mainnet.base.org')], { retryCount: 5 });
