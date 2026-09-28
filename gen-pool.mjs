// Pre-computes one-time (burn) addresses for the test seller. The file stays on the seller's machine only.
import fs from 'node:fs';
import { env, BASE } from './lib/env.mjs';
import { newOneTimeAddress } from './lib/burn.mjs';

const n = Number(process.argv[2] ?? 25);
const file = new URL('./seller-pool.json', import.meta.url);
const pool = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
for (let i = 0; i < n; i++) {
  const t = Date.now();
  const { gr, r, s, B } = newOneTimeAddress({ chainId: BASE.chainId, W: env.SELLER_WITHDRAW_ADDRESS });
  pool.push({ B, gr, r: r.toString(), s: s.toString() });
  fs.writeFileSync(file, JSON.stringify(pool, null, 1), { mode: 0o600 });
  console.log(`${pool.length} ${B} ${Date.now() - t} ms`);
}
