# PromOps Server – API Reference

This document describes every HTTP endpoint exposed by `ai-server/server.js`. All routes are JSON-based and share the same base URL:

```
http://localhost:8787/api
```

> **Authentication:** None in the MVP. Protect these endpoints behind your own gateway before exposing them publicly.

> **Dependencies:** The server expects `PROGRAM_ID`, `PROMO_IDL_PATH`, `SOLANA_RPC_URL`, `OPENAI_API_KEY`, `merchant-keypair.json`, and (optionally) `PLATFORM_TREASURY_ADDRESS` to be configured in `ai-server/.env`.

---

## AI & Automation

### POST `/api/ai-campaign-advisor`
Turns marketing context into a structured campaign proposal using OpenAI.

**Request body**
```json
{
  "message": "Goal or question from the merchant",
  "metrics": { "avg_redeem_rate": 0.18, "...": "..." },
  "profile": { "industry": "coffee", "risk_tolerance": "medium" },
  "campaigns": [ { "address": "...", "discount_bps": 2000, "...": "..." } ],
  "shopper_context": { "productId": "2", "walletAddress": "..." }
}
```

**Response**
```json
{
  "reply": "Natural language summary from the assistant",
  "proposal": {
    "name": "Flash Coffee Lovers 20%",
    "discount_bps": 2500,
    "resale_bps": 5000,
    "expiration_timestamp": 1734043200,
    "total_coupons": 150,
    "mint_cost_lamports": 1000000,
    "max_discount_lamports": 15000000,
    "deposit_amount_lamports": 2500000000,
    "category_code": 1,
    "product_code": 2,
    "requires_wallet": false,
    "target_wallet": null
  }
}
```

> `service_fee_bps` is always read from the on-chain `GlobalConfig`. Proposals can include the field for documentation purposes, but the server will ignore it when creating campaigns.

### POST `/api/ai-suggestions`
Alias for `/api/ai-campaign-advisor` kept for backwards compatibility. Accepts and returns the exact same payload.

---

## On-chain Data (Read)

### GET `/api/campaign/:address`
Fetches a single campaign PDA.

- **Params:** `address` – base58 campaign public key.
- **Response:** `{ pubkey, lamports, data: { ...decoded fields } }`
- **Errors:** `400` invalid address, `404` not found, `500` IDL or RPC issues.

### GET `/api/campaigns`
Lists every campaign account owned by `PROGRAM_ID`.

- **Response:** `{ campaigns: [ { address, campaign_id, discount_bps, ... } ] }`

### GET `/api/coupons/:walletAddress`
Returns all coupons owned by `walletAddress`. Each entry is a sanitized view combining coupon + campaign metadata.

- **Response:**
```json
{
  "coupons": [
    {
      "address": "...",
      "campaign": "...",
      "recipient": "...",
      "discount_bps": 2000,
      "max_discount_lamports": 20000000,
      "expiration_timestamp": 1733707600,
      "category_code": 10,
      "product_code": 101,
      "is_used": false
    }
  ]
}
```

### POST `/api/mark-coupon-used`
Marks a coupon as used **only in server memory** (no on-chain mutation). Useful to immediately hide redeemed coupons in the UI.

**Request body**
```json
{ "couponAddress": "Coupon PDA" }
```

---

## On-chain Mutations

### POST `/api/create-campaign`
Creates a campaign on Solana devnet. Accepts either:
- `proposal`: object returned from `/api/ai-campaign-advisor`.
- `shopper_context`: fallback data collected in the e-commerce page.

The endpoint automatically:
- Calls `initialize_config`/`upgrade_config` when necessary.
- Reads `max_resale_bps` and `service_fee_bps` from the on-chain `GlobalConfig`. Merchants cannot override the service fee through the API.

**Request body**
```json
{
  "walletAddress": "Customer wallet (optional telemetry)",
  "proposal": { "...": "AI proposal fields" },
  "shopper_context": {
    "productId": "2",
    "productPriceSol": 0.5,
    "walletAddress": "..."
  }
}
```

**Response**
```json
{
  "success": true,
  "message": "Your campaign has been created on Solana devnet.",
  "signature": "...",
  "merchantAddress": "...",
  "campaignPda": "...",
  "vaultPda": "...",
  "configPda": "...",
  "rpcUrl": "https://api.devnet.solana.com"
}
```

### POST `/api/mint-coupon`
Creates a coupon account for a specific campaign + recipient.

**Request body**
```json
{
  "campaignAddress": "Campaign PDA",
  "customerWallet": "Recipient wallet"
}
```

**Response:** `{ success, couponAddress, signature, ... }`

### POST `/api/abandoned-cart-coupon`
Bootstrap flow that:
1. Creates a 1-coupon targeted campaign expiring at end-of-day.
2. Mints that coupon to `walletAddress`.

**Request body**
```json
{
  "walletAddress": "Shopper wallet",
  "productId": "3",
  "productCode": 3,
  "discountBps": 1500
}
```

**Response:** Campaign summary, coupon payload, and mint signature.

### POST `/api/redeem-coupon`
Builds an unsigned `redeem_coupon` transaction that the shopper signs client-side.

**Request body**
```json
{
  "couponAddress": "Coupon PDA",
  "userWallet": "Owner wallet",
  "purchaseAmountLamports": 50000000
}
```

**Response**
```json
{
  "success": true,
  "transactionBase64": "base64-encoded unsigned tx",
  "couponAddress": "...",
  "campaignAddress": "...",
  "vaultAddress": "...",
  "purchaseAmountLamports": 50000000,
  "latestBlockhash": { "blockhash": "...", "lastValidBlockHeight": 123 }
}
```

The frontend should deserialize, have the owning wallet sign, and broadcast via `sendRawTransaction`.

---

## Solana Pay

### POST `/api/solana-pay/create-session`
Creates a payment session for Solana Pay (either transfer or transaction request modes) and optionally validates a coupon for the order.

> **Base URL:** set `SOLANA_PAY_BASE_URL`/`PUBLIC_SOLANA_PAY_BASE_URL` in `ai-server/.env` to the HTTPS origin exposed to wallets (e.g., your ngrok domain). If unset, the server falls back to the incoming request headers or `http://localhost:<PORT>`.

**Request body**
```json
{
  "amountSol": 0.75,
  "payerWallet": "Customer wallet (optional)",
  "orderItems": [ { "productId": "1", "quantity": 2 } ],
  "couponAddress": "Coupon PDA",
  "mode": "transaction-request" 
}
```

**Response**
```json
{
  "url": "solana:...encoded...",
  "reference": "RefPubkey",
  "recipient": "MerchantPubkey",
  "amountSol": 0.75,
  "mode": "transaction-request"
}
```

### GET `/api/solana-pay/tx-request`
Provides wallet metadata for transaction-request sessions (`{ label, icon }`).

### POST `/api/solana-pay/tx-request`
Wallets call this with `{ account }` + `?reference=...` to receive an unsigned transaction that includes:
1. Optional `redeem_coupon` instruction (when the session carries a coupon).
2. `SystemProgram.transfer` from payer → merchant with the reference key added.

**Response**
```json
{
  "transaction": "base64 unsigned tx",
  "message": "Order payment via Solana Pay"
}
```

### GET `/api/solana-pay/status/:reference`
Polling endpoint that checks whether the reference has a confirmed transfer. Returns:
- `{ status: "pending" }`
- `{ status: "confirmed", signature: "..." }`
- `{ status: "not_found" }`
- `{ status: "error", error: "..." }`

---

## Secondary Marketplace (In-memory MVP)

### GET `/api/secondary/listings`
Returns the in-memory array of listings:
```json
{ "listings": [ { "id": "...", "couponAddress": "...", "price": 0.1, ... } ] }
```

### POST `/api/secondary/list`
Registers a listing in memory. Validates that price does not exceed the underlying campaign discount cap.

**Request body**
```json
{
  "campaignAddress": "Campaign PDA",
  "couponAddress": "Coupon PDA",
  "sellerWallet": "Wallet base58",
  "price": 0.05,
  "currency": "SOL"
}
```

### POST `/api/secondary/buy`
Marks a listing as sold (no on-chain transfer yet).

**Request body**
```json
{
  "listingId": "lst_abc123",
  "buyerWallet": "Wallet base58"
}
```

---

## Global Config & Platform Fees

- The Anchor program stores `admin`, `treasury`, `max_resale_bps`, and `service_fee_bps` in the `GlobalConfig` PDA.  
- `DEFAULT_MAX_RESALE_BPS` / `DEFAULT_SERVICE_FEE_BPS` environment variables are only used if the server needs to bootstrap a missing config account. Once the account exists, every endpoint pulls the authoritative values from chain.  
- Changing the platform fee requires calling the `upgrade_config` instruction (not yet exposed as an HTTP endpoint). Update `service_fee_bps` there; merchants and proposals cannot override it via `/api/create-campaign`.  
- Because the service fee is global, deposits that back each campaign must cover mint costs plus the maximum fee computed from `service_fee_bps`.

---

## Error Handling Conventions

- Every endpoint returns `error` and `details` (when available) in JSON form on failures.
- Common HTTP statuses:
  - `400` – missing/invalid parameters.
  - `404` – PDA/session not found.
  - `500` – IDL, RPC, OpenAI, or unexpected runtime errors.
- RPC errors often include Anchor logs in the server console; inspect those for on-chain issues.

---

## Development Notes

1. **IDL availability:** Most endpoints require `anchor build` to generate `target/idl/promo_targeting.json`. If the IDL cannot be loaded, read/write endpoints will return `500`.
2. **Funding:** The local `merchant-keypair.json` must hold enough SOL on devnet to pay rent, fees, and Solana Pay transfers.
3. **Platform treasury:** If `PLATFORM_TREASURY_ADDRESS` is absent, the merchant public key becomes the default treasury.
4. **Local cache:** Coupon usage (`/mark-coupon-used`) and marketplace listings are purely in-memory; restart the server to reset them.
5. **Security:** Never expose these endpoints without auth/rate-limiting in production. The MVP trusts the caller and uses devnet accounts.

Use this reference as the baseline when integrating external dashboards, agents, or commerce platforms with the PromOps protocol.
