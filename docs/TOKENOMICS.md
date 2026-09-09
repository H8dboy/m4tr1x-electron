# H8 Token — Tokenomics

This document explains the H8 token honestly. There is no whitepaper magic, no decentralized governance theatre, no "community-owned protocol" hand-waving. H8 is a utility credit, the founder controls the mint key, and that is the correct architecture for a project at this stage. Read on for why.

## What H8 is

- **A utility closed-credit token.** Equivalent in legal classification to Twitch Bits, Roblox Robux, or a prepaid arcade token.
- **Non-transferable outside M4TR1X.** You cannot withdraw H8 to an exchange. There is no on-chain bridge. There is no stablecoin pair.
- **Denominated in cents internally.** 1 H8 = 100 ledger units. The smallest tip is 1 unit (0.01 H8).
- **Recorded on a hash-chained ledger.** Every transaction is signed with ML-DSA65 (post-quantum) and chained with SHA3-256. Anyone can verify the entire chain integrity by calling `/api/v1/h8/chain/verify`.

H8 address format: `H8` + first 38 hex chars of `SHA3-256(publicKey)` — 40 characters total.

## What H8 is NOT

- Not a cryptocurrency
- Not an investment
- Not subject to MiCA (because it's closed-loop, not transferable)
- Not pegged to anything
- Not on any blockchain

## Mint authority

The mint key is held by the founder (H8db0y). Only the admin endpoint (`POST /api/v1/admin/h8/mint`) with a valid `ADMIN_KEY` can issue new H8 into circulation. This endpoint is restricted to localhost only. This is the same architecture as:

- **Signal** — open protocol, founder controls the registration server
- **Bitcoin** — open protocol, Satoshi pre-mined approximately 1M BTC
- **Ethereum** — open protocol, Foundation pre-allocated 70M ETH
- **Mastodon** — open code, Eugen Rochko controls mastodon.social
- **Roblox** — closed credit, Roblox Corp controls Robux issuance

Decentralization without sovereignty in the bootstrap phase produces dead networks. See Diaspora, Urbit, SSB. Decentralization with sovereign founders during bootstrap, transitioning out as the network matures, produces working networks. This project chose the second path deliberately.

## Where H8 comes from (issuance)

In v2.3.0:

1. **Manual mint by founder.** The founder issues H8 in exchange for fiat (SEPA, wire transfer, manual P2P). The audit trail is the ledger itself — every mint is a signed `mint` transaction visible to anyone with chain access.
2. **Server operator share.** Every tip processed through a node automatically credits 30% to the node's `H8_SERVER_ADDRESS`.

In v2.4 (planned):

3. **Documented manual fiat gateway.** Public process for purchasing H8: send EUR via SEPA to a published IBAN, receive H8 within 24h. Conversion rate fixed by founder, posted publicly, updated quarterly.

## Price and backing

The euro is the reference currency. Every other price derives from the euro price at the exchange rate of the day — it is not an independent price list.

The selling price is two things kept apart:

```
reserve_eur      = 1.00                                 # backing, held in reserve
platform_fee_pct = 0.25                                 # infrastructure share, on top
price_eur        = reserve_eur * (1 + platform_fee_pct) = 1.25
```

| | |
|---|---|
| **1 H8** | **€ 1.25** (€ 1.00 reserve + 25%) |
| 1 H8 in USD | $ 1.375 — the same reserve converted at the EUR/USD rate |
| Smallest unit | 0.01 H8 (1 ledger unit) = € 0.0125 |
| Minimum order | € 1.00 threshold = 0.8 H8 |
| Maximum order | 8,000 H8 = € 10,000 |

**Backing policy.** Every H8 issued through the shop is covered by **€ 1.00 (or its USD equivalent) held in reserve**, kept separate from the platform fee. The fee is what pays for development and infrastructure; the reserve is not income and is not spent as such — it exists so that the credit in circulation has something behind it. The reserve is denominated in euro even when the buyer pays in another currency: other currencies are converted, the reserve is not re-denominated.

This is a backing commitment, not a peg and not a redemption right: H8 remains non-transferable outside M4TR1X and cannot be withdrawn to an exchange (see *What H8 is NOT*).

Orders are placed in whole H8 — `createOrder` floors the amount — so the first order actually accepted is 1 H8; the 0.8 H8 minimum is the € 1.00 threshold expressed in tokens.

These are the defaults in `server/h8shop.js`. A node operator can override them in `h8shop_config.json` — the price a buyer sees always comes from `/api/v1/shop/info` on the node they are buying from, never from this document.

## Where H8 goes (flow)

Every tip splits automatically into three:

```
Tip 1000 H8 →
  ├── 50% → creator             (500 H8)
  ├── 20% → platform (founder)  (200 H8)
  └── 30% → server operator     (300 H8)
```

These splits are hard-coded in `server/h8token.js` and verifiable in source. Each leg is a separate signed ledger block.

Boost (visibility purchase):

```
Boost 500 H8 →
  └── 100% → platform            (boost score is the only proof of impact)
```

## Founder allocation rationale

The founder's 20% tip cut pays for:

- Software development (full-time work on M4TR1X)
- Legal and tax compliance in the EU
- Domain, code-signing certificates, infrastructure for the build pipeline
- Eventually: dedicated security audit, contractor payments

This is transparent and explicit. There is no "community treasury" hiding a wage. There is the founder, doing the work, getting paid for it.

## Lock-in vs. exit

You can leave M4TR1X at any time. Your H8 balance does not transfer out. This is a feature, not a bug — it's what keeps the project outside MiCA, what keeps the economy stable (no speculation), and what keeps incentives aligned with using the platform rather than extracting from it.

If the founder ever attempts to inflate H8 or otherwise abuse the mint key, the ledger is verifiable. Bad behavior is provable. The exit is forking the protocol — the code is MIT, the protocol is open. The brand and mint authority are not.

## Genesis allocation

The genesis block is:

```
block_index: 1
from: 0x0
to: H8_MINT_ADDRESS (founder)
amount: 0
tx_type: mint
note: "genesis"
```

Zero pre-allocation. All H8 in circulation is minted in response to user purchases and operator earnings. Verify the chain at any time:

```bash
curl http://localhost:8080/api/v1/h8/chain/verify
# {"valid": true, "blocks": N}
```

Returns `firstInvalidBlock` if any signature, hash link, or balance check fails.

## Questions

Open an issue with the `tokenomics` label.
