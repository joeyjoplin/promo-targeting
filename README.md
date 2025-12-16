# PromOps Protocol 

PromOps is an open on-chain marketing protocol designed to maximize ROI for loyalty, cashback, survey, and promotional campaigns. It combines Anchor smart contracts on Solana, an AI/automation server, and showcase frontends (dashboard + e-commerce) to enable targeted campaigns, native analytics, and new experiences like a coupon marketplace and Solana Pay flows.

## Links

Frontend: https://promo-targeting.vercel.app/ </br>
Server: https://promo-targeting.onrender.com </br>

### Getting Started (Demo Flow) 
1. Open the E-Commerce menu and connect your crypto wallet.

2. If the Merchant account runs out of funds, top it up using a faucet with the following Public Key:
```HrxMNSsZusJTkmXBpferHbps6BqL1eVBVYnKfqiGzWR9```

When running the server locally, a Merchant account is automatically generated.
You can find the corresponding Public Key printed in the server console logs.

3. Cart Abandonment Feature: When a customer adds a product to the cart but leaves without completing the purchase, an automatic cart abandonment campaign is triggered after <b>60s</b>.

4. The secondary marketplace is still under development.
The NFT coupon purchase button and its economic logic will be improved in upcoming releases.

## ProgramID
41eti7CsZBWD1QYdor2RnxmqzsaNGpRQCkJQZqX2JEKr

## Business Logic

- **Efficiency & ROI:** campaigns only pay fees proportional to redeemed discounts, keeping operational costs low and focusing on real sales.  
- **On-chain + AI tooling:** the protocol enables automated creation of campaigns, surveys, loyalty, and ads while preserving privacy (behavior is associated with public keys, not individuals).  
- **New economic flows:** coupons become tradable assets; marketplace and P2P transfers create liquidity similar to mileage programs.  
- **Data-rich:** every action is on-chain, powering analytics, AI models, and upsell recommendations.  
- **MVP scenario:**  
  1. A shopper buys a product and receives a cashback/discount with constraints (deadline, minimum spend).  
  2. If they don't buy again in time, both sides lose value. PromOps turns this zero-sum scenario into incentives: coupons can be resold, redeemed, or used in targeted campaigns.  
- **Extra benefits:** reduced merchant workload, campaign spend control, higher network transaction volume, transparent KPIs, and fees only on successful sales.

## Architecture

| Component | Path | Description |
| --- | --- | --- |
| Anchor program | `programs/promo-targeting` | Smart contract governing campaigns, vaults, coupons, redemption, P2P transfers, marketplace rules, and closure. |
| Tests & tooling | `tests`, `migrations`, `Anchor.toml` | TS/Mocha suite validating all instructions (`initialize_config`, `create_campaign`, `mint`, `redeem`, marketplace, etc.). |
| AI / automation server | `ai-server` | Express + Anchor client exposing REST APIs to create campaigns, mint coupons, read accounts, generate AI proposals, and manage Solana Pay sessions. |
| Dashboard (showroom) | `frontend` | Vite + React + Tailwind app offering three experiences: operations dashboard, demo store, and secondary marketplace. |
| Supporting assets | `merchant-keypair.json`, `treasury.json`, `migrations`, `app/` | Merchant keys and placeholders for upcoming integrations. |

### Protocol Flow

1. **`initialize_config`** – admin defines global policy (treasury, `max_resale_bps`, and the protocol-wide `service_fee_bps`).  
2. **`create_campaign`** – merchant funds a vault PDA and configures parameters (discount, resale caps, categories, wallet targeting). The service fee is automatically inherited from `GlobalConfig`.  
3. **`mint_coupon`** – coupons are minted respecting targeting (`requires_wallet`) and paying mint costs to the treasury.  
4. **`redeem_coupon`** – after off-chain payment (Solana Pay), the contract validates the product, caps the discount (`max_discount_lamports`), transfers service fees, and records analytics.  
5. **Secondary market** – owners can `list_coupon_for_sale`, `buy_listed_coupon`, or `transfer_coupon` P2P while respecting resale bounds (`resale_bps`).  
6. **Closing** – `close_campaign_vault` returns remaining budget after expiration; `expire_coupon` cleans unused coupons.  
7. **Observability** – events like `CouponRedeemed` and `TreasuryBalance` feed dashboards and AI agents.

## Repository Layout

```
promo-targeting/
├── programs/promo-targeting/   # Anchor contract
├── tests/                      # ts-mocha tests
├── ai-server/                  # Express + Solana Pay + AI
├── frontend/                   # Vite + React dashboard / e-commerce
├── migrations/                 # Anchor scripts (deploy)
├── merchant-keypair.json       # Default merchant (dev)
├── treasury.json               # Default treasury
└── Anchor.toml, Cargo.*, package.json, yarn.lock, etc.
```

## Requirements

- Node.js 18+ with npm/yarn
- Anchor CLI 0.30+ (compatible with `@coral-xyz/anchor@0.31.1`)
- Solana CLI 1.18+ with key at `~/.config/solana/id.json`
- Rust + cargo to build the program
- (Optional) Private Devnet RPC endpoint to avoid rate limits

## Setup & Execution

### 1. Program dependencies & build

```bash
yarn install        # root dependencies (Anchor tooling)
anchor build        # compile promo_targeting program
anchor test         # run end-to-end tests on localnet/devnet
```

Use `solana config set --url https://api.devnet.solana.com` (or your private RPC) and make sure `Anchor.toml` references the right cluster. After deployment, update `declare_id!` and `PROGRAM_ID` in the API/frontend if needed.

### 2. AI & automation server (`ai-server/`)

1. Create an `.env`:
   ```env
   PORT=8787
   SOLANA_RPC_URL=https://api.devnet.solana.com
   PROGRAM_ID=41eti7CsZBWD1QYdor2RnxmqzsaNGpRQCkJQZqX2JEKr
   PROMO_IDL_PATH=../target/idl/promoTargeting.json
   PLATFORM_TREASURY_ADDRESS=<platform public key>
   OPENAI_API_KEY=<your key>
   MIN_VAULT_RESERVE_LAMPORTS=5000000
   DEFAULT_MAX_RESALE_BPS=1000
   DEFAULT_SERVICE_FEE_BPS=1000
   RPC_MAX_RETRIES=5
   RPC_RETRY_DELAY_MS=1000
   ```
2. Install and run:
   ```bash
   cd ai-server
   npm install
   npm start
   ```
The server reads `merchant-keypair.json`, initializes an Anchor `BorshCoder` from the IDL, and exposes:

- `POST /api/create-campaign` – creates an on-chain campaign + vault.  
- `POST /api/mint-coupon` – mints a coupon for a recipient.  
- `POST /api/abandoned-cart-coupon` – automated 10% abandoned-cart flow.  
- `GET /api/campaign/:address`, `GET /api/campaigns` – account reads via the IDL.  
- `GET /api/coupons/:wallet` – wallet → coupon inventory.  
- `POST /api/ai-campaign-advisor` – turns natural language into structured proposals (OpenAI).  
- `POST /api/solana-pay/create-session` & `GET /api/solana-pay/status/:reference` – manage Solana Pay sessions.  
- `POST /api/mint-and-listing` (see code) – supports the secondary marketplace.

### Platform Fees & Global Config

- `GlobalConfig` stores the admin authority, treasury, `max_resale_bps`, and the protocol-wide `service_fee_bps`. Run `initialize_config` once (with the admin signer) before any campaign creation.  
- Use the `upgrade_config` instruction to change `max_resale_bps` or `service_fee_bps` later; merchants cannot override these numbers in `create_campaign`.  
- `DEFAULT_MAX_RESALE_BPS` and `DEFAULT_SERVICE_FEE_BPS` are only fallback values the server passes when it needs to bootstrap a missing `GlobalConfig`. After the account exists, every endpoint reads the real values from chain.  
- Because `service_fee_bps` is global, campaign deposits should cover coupon mint costs + the maximum possible service fee derived from `GlobalConfig`.

### 3. Frontend showroom (`frontend/`)

1. Configure `.env` / `.env.local`:
   ```env
   VITE_API_BASE_URL=http://localhost:8787
   VITE_CLUSTER=devnet
   ```
2. Run:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

**Main pages:**
- `/` PromOps dashboard: metrics, on-chain table, AI assistant (`AICampaignAssistant`) reading campaigns + shopper context.  
- `/ecommerce` Demo store: cart simulation, Solana Pay integration, `GET /api/coupons/:wallet`, abandoned-cart offers. Shopper context is persisted to `localStorage` and powers the dashboard.  
- `/marketplace` Coupon marketplace: browse/list/redeem secondary coupons.

### 4. Helpful scripts

```bash
yarn lint             # prettier (root)
cd frontend && npm run lint
cd ai-server && npm start
anchor test           # validates program instructions
```

## Integrations & Future Work

**Hybrid payments (Solana Pay + x402):** Solana Pay remains the human-facing checkout layer (QR codes, links, transaction requests) for purchases, cashback, and loyalty flows.
x402 (HTTP 402 – Payment Required) is introduced as a protocol-level payment standard for monetizing PromOps APIs, AI services, and agent-to-agent interactions (pay-per-call, pay-per-decision).</br>
**Rules Engine for targeting & risk control:** Coupon and cashback logic evolves into a full rules engine: expiration windows, cooldowns, minimum spend, product/category constraints, per-wallet limits, and budget pacing.
Built-in anti-abuse and anti-farming logic ensures campaigns optimize ROI instead of leaking value.</br>
**Attribution & performance proofs:** On-chain attribution links coupons, payments, redemptions, and campaign outcomes.
This enables verifiable KPIs such as uplift, redeem rate, cost per conversion, and campaign ROI—unlocking performance-based pricing models.</br>
**Dynamic discounts & cashback:** Discount values can adapt in real time based on wallet segment, estimated LTV, purchase context, inventory, or campaign phase.
Supports algorithmic marketing operations instead of static promotions.</br>
**Secondary coupon market (economically sound):** Coupons remain tradable assets, but resale prices are capped by the maximum economic benefit they can generate (e.g., a 10% discount on a 100-unit product cannot be resold above 10).
Prevents speculative distortion while preserving liquidity and price discovery.</br>
**Paid APIs & Targeting-as-a-Service:** PromOps exposes paid endpoints such as wallet scoring, offer recommendation, fraud checks, and campaign optimization.
These APIs are monetized via x402, enabling automated payments from bots, AI agents, and backend services without human interaction.</br>
**Composable Solana Pay transaction requests:** Advanced transaction requests allow composing payments with multiple instructions (pay + mint coupon + register attribution) in a single user approval.
Enables richer checkout experiences without increasing UX friction.</br>
**Privacy-first analytics:** All analytics remain public-key–based, avoiding PII while still enabling segmentation, insights, and AI-driven recommendations.</br>

## Usage Guidelines

1. Always initialize `GlobalConfig` with the correct admin before creating campaigns.  
2. Honor `requires_wallet`: open campaigns (`false`) suit airdrops/marketplaces; targeted campaigns (`true`) require a valid `target_wallet`.  
3. Ensure `deposit_amount` covers `total_coupons * mint_cost` plus the maximum service fee derived from `GlobalConfig.service_fee_bps`; vaults reject minting if balances are insufficient.  
4. Use `PRODUCT_CODE` / `category_code` for segmentation and analytics; the frontend maps demo products (`1=coffee`, `2=chocolate`, `3=t-shirt`).  
5. Keep consuming on-chain events and metrics to feed BI tools and the AI assistant.

## Next Steps

1. Stabilize the on-chain core
2. Finalize campaign, coupon, redemption, and marketplace instructions.
3. Add comprehensive happy/unhappy path tests and emit structured events for analytics and attribution.
4. Implement the Rules Engine layer
5. Encode constraints (time, spend, usage, categories, pacing) and anti-abuse logic directly into the protocol flow.
6. Ensure vault balances, service fees, and redemption caps are always enforced on-chain.
7. Complete the Solana Pay purchase loop
8. Use transfer requests and transaction requests with unique references to fully link purchases to coupon redemption and attribution.
9. Harden payment listeners and reconciliation logic.
10. Introduce x402-powered APIs
11. Add x402 endpoints for campaign intelligence (recommend-offer, wallet scoring, fraud checks).
12. Enable pay-per-call monetization for AI agents, backends, and partners.
13. Build attribution & ROI dashboards
14. Index on-chain events to power dashboards that prove campaign performance.
15. Use these metrics to experiment with performance-based pricing for merchants.
16. Expand integrations: Shopify, Wordpress and other e-commerce platforms for real cart ingestion and automated triggers.
17. Solana Blinks for interactive ads, surveys, and incentive flows.
18. Protocol hardening & expansion
19. Multi-currency campaigns and settlement logic.
20. Cross-chain extensions (e.g., Base, Stellar) while keeping PromOps as the neutral coordination layer.
22. Explore privacy-preserving techniques (e.g., ZK-based segmentation) without breaking composability.

**PromOps is open source—contributions and feedback are welcome to expand the protocol, improve UX, and increase the economic impact of on-chain promotions.**

## License

This project is released under the MIT License. See `LICENSE` for details.
