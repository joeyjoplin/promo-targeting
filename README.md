# PromOps Protocol – PromOps MVP

PromOps is an open on-chain marketing protocol designed to maximize ROI for loyalty, cashback, survey, and promotional campaigns. It combines Anchor smart contracts on Solana, an AI/automation server, and showcase frontends (dashboard + e-commerce) to enable targeted campaigns, native analytics, and new experiences like a coupon marketplace and Solana Pay flows.

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

- **New use cases:** coupon marketplace (MVP), targeted airdrops, loyalty with multiple currencies, recurring or seasonal campaigns (e.g., back-to-school), surveys/incentives via Solana Blinks.  
- **Automation/AI:** MCP server + agent to create campaigns, recommend segments, run price research, and personalize offers.  
- **E-commerce:** Shopify and other platform integrations for automatic cart ingestion and campaign triggers.  
- **On-chain analytics:** datasets feed recommendation systems, upsell, and advertising with zero PII leakage.  
- **Governance:** DAO structure, incentives, zero-knowledge privacy, and multi-chain expansion (Base, Stellar, etc.).  
- **Operations:** enhanced economic logic, multi-currency support, automated workflows, and real-time ROI monitoring.

## Usage Guidelines

1. Always initialize `GlobalConfig` with the correct admin before creating campaigns.  
2. Honor `requires_wallet`: open campaigns (`false`) suit airdrops/marketplaces; targeted campaigns (`true`) require a valid `target_wallet`.  
3. Ensure `deposit_amount` covers `total_coupons * mint_cost` plus the maximum service fee derived from `GlobalConfig.service_fee_bps`; vaults reject minting if balances are insufficient.  
4. Use `PRODUCT_CODE` / `category_code` for segmentation and analytics; the frontend maps demo products (`1=coffee`, `2=chocolate`, `3=t-shirt`).  
5. Keep consuming on-chain events and metrics to feed BI tools and the AI assistant.

## Suggested Next Steps

1. Publish the MCP server and AI agent to automate campaign creation/optimization.  
2. Evolve the program for multi-currency logic and broader marketing scenarios.  
3. Integrate Shopify/other e-commerce platforms for real cart ingestion.  
4. Automate operations: recommendations (upsell), surveys, ads, personalization.  
5. Explore Solana Blinks for interactive ads and surveys.  
6. Extend to other chains (Base, Stellar) and add zero-knowledge privacy.  
7. Formalize DAO governance and compensation.  
8. Research 0x402-style scenarios (recurring/seasonal purchases, e.g., back-to-school bundles).  

PromOps is open source—contributions and feedback are welcome to expand the protocol, improve UX, and increase the economic impact of on-chain promotions.
