# Private Delivery Proof

When an x402 purchase is paid on a private rail, the seller's wallet stays hidden, and so does the
evidence that the buyer paid the seller it meant to and got what it paid for. This repository is a
small reference for publishing that evidence without revealing the seller's wallet, its other buyers
or its revenue.

- Spec: [SPEC.md](SPEC.md) (v0, draft), including what it does **not** prove yet.
- Records: [records/](records/) holds 20 purchases made on Base mainnet on 2026-09-28, paid in zUSDC
  (zERC20) to one-time burn addresses.
- The test seller in this demo is run by the same party as the buyer. It exists to exercise the flow.
  The payments are real.

## Check the records yourself

```sh
npm ci
node verify.mjs records https://kzmttkc.github.io/private-delivery-proof/did.json
```

The verifier needs only the records, the seller's `did.json` and a Base RPC (`RPC_URL`, default
`https://mainnet.base.org`). It does not trust the buyer's word for anything it can read on-chain.

## Status

v0. The seller's ability to redeem a one-time address is not proven yet (see SPEC.md, "What this
proves, and what it does not"). Questions and corrections are welcome as issues.

Part of [vet402](https://vet402.com), independent verification of x402 payments.
