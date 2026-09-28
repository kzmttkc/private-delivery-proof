# Private Delivery Proof v0

Status: draft, v0. Reference implementation in this repository (MIT).

## Problem

An x402 purchase paid in a public stablecoin can be checked by anyone: the transfer to the seller's
`payTo` address is on-chain. On private rails that is no longer true. With zERC20, for example, the
seller is paid at a one-time "burn" address that nobody can link to the seller's real wallet.
Privacy works as designed, and as a side effect an outside party can no longer tell whether a
payment reached the seller that was asked to deliver, or whether anything was delivered for it.

This spec lets a buyer publish proof that **it paid the seller it meant to pay, and received the bytes
the seller says it sent**, while the seller's real wallet, its other buyers and its revenue stay private.

## Parties and keys

- **Seller** `S`: holds a signing key `k_S` published in a DID document (did:web), a hidden withdrawal
  address `W`, and for each sale a fresh one-time address `B`.
- **Buyer** `P`: pays with the x402 `exact` scheme over Permit2.
- **Verifier**: anyone. Needs only the published record, the seller's `did.json` and a Base RPC.

## Flow (one purchase)

1. `P` requests the resource. `S` answers `402` with one payment option whose `payTo` is a fresh
   one-time address `B`, and an x402 **offer-receipt** offer (EIP-712, domain `x402 offer`) signed by
   `k_S` over `{resourceUrl, scheme, network, asset, payTo = B, amount, validUntil}`.
2. `P` checks the offer signature and pays `amount` of the asset to `B` via `x402ExactPermit2Proxy`
   (`0x402085c248EeA27D92E8b30b2C58ed07f9E20001`).
3. `S` settles, returns the resource, and signs with `k_S`:
   - an x402 offer-receipt **receipt** (EIP-712, domain `x402 receipt`) over
     `{network, resourceUrl, payer = P, issuedAt, transaction}`;
   - a **delivery attestation** (EIP-712, domain `{name: "x402 delivery", version: "0", chainId: 1}`):

     ```
     Delivery(uint256 version, string network, string resourceUrl, string payer, string transaction,
              bytes32 requestHash, bytes32 responseHash, uint256 issuedAt)
     ```
     `requestHash = sha256("GET " || resourceUrl)`, `responseHash = sha256(response body bytes)`.
     The receipt has no response hash field today; this companion message carries it until one exists.
4. `P` publishes a record (below).

## Record

```json
{
  "v": 0, "purchase": 1, "network": "eip155:8453", "asset": "<token>", "resourceUrl": "...",
  "seller": { "did": "did:web:...", "signer": "0x...", "didJsonSha256": "0x..." },
  "oneTimeAddress": "B", "amount": "10000", "payer": "P",
  "offer": { "...signed offer..." }, "receipt": { "...signed receipt..." }, "delivery": { "...signed delivery..." },
  "tx": "0x...", "block": 0, "indexedTransfer": "0", "permit2Nonce": "...",
  "responseBodyBase64": "..."
}
```

Not published: `W`, the recipient hash, the tweak and secret behind `B`, which withdrawal redeemed `B`,
the seller's other one-time addresses and other buyers.

## Verification (no trust in the buyer)

A record passes when all of these hold:

1. The offer signature recovers to a key listed in the seller's `did.json`, and that file hashes to
   `didJsonSha256`. The offer's `payTo`, `amount`, `asset` and `resourceUrl` equal the record's.
2. On Base, `tx` succeeded and emitted `Transfer(P, B, amount)` from the asset contract.
3. `tx` is a call to `x402ExactPermit2Proxy.settle*` whose permit nonce equals `permit2Nonce`,
   whose owner is `P` and whose witness `to` is `B`.
4. The receipt recovers to the same key, names `P` and `tx`, and `issuedAt` is within 600 s of the block time.
5. The delivery attestation recovers to the same key, names `P` and `tx`, and `responseHash` equals
   `sha256(responseBodyBase64 decoded)`.

`node verify.mjs records public/did.json` runs these checks.

## What this proves, and what it does not (v0)

Proves: the seller identified by `did` asked to be paid at `B` for this resource; `P` paid exactly that
at `B`; the same seller acknowledged the payment and committed to the exact bytes it returned.

Does not prove yet: that the seller can actually redeem `B` (a seller could sign someone else's
address). Stage 2 closes this with a zero-knowledge proof of knowledge of `(r, s)` such that
`B = low160(Poseidon3("burn", r, s))`, bound to the offer digest. It also does not prove that the bytes
were correct or useful, only which bytes were committed to.

## zERC20 specifics (Base mainnet)

- zUSDC `0xEB81ab55Bc7aa89d1e0E3F60597D86e37702Af53` (6 decimals), wrapped 1:1 from USDC via the
  LiquidityManager `0x04be137Df79bE7B5F3314C4a84D1C5E0d99BD477`.
- One-time address: `B = low160(Poseidon3(D_burn, r, s))` where `D_burn` is `"burn"` as 32 little-endian
  bytes, bits 160..175 of the hash are zero (16-bit PoW), and
  `r = (sha256(chainId:u64 || recipient:bytes32 || tweak:bytes32) & (2^248 - 1)) | (1 << 248)`.
  `lib/burn.mjs` reimplements this with MIT code and matches zERC20's published test vector.
- zUSDC has no EIP-3009, so payment uses the x402 Permit2 path.

## Other private rails

The seller-side binding (a signed offer naming a one-time destination) does not depend on zERC20.
On a rail where the payment itself is not public, step 2 is replaced by a sender-side disclosure that
a third party can check against L1. Whether a rail supports that is the open question for each rail.

## Reference demo

- The test seller runs locally and is operated by the same party as the buyer. It exists to exercise the
  flow; the records are real Base mainnet payments.
- Price 0.01 zUSDC per purchase.
