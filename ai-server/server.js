// ai-server/server.js
// Express server that:
// 1) Proxies AI requests to the OpenAI API
// 2) Exposes:
//    - POST /api/create-campaign       -> creates a real on-chain campaign on Solana devnet
//    - POST /api/mint-coupon          -> mints a coupon for a given campaign + recipient
//    - POST /api/abandoned-cart-coupon -> creates a 10% abandoned-cart campaign + mints coupon
//    - GET  /api/campaign/:address    -> reads a single Campaign account using the Anchor IDL
//    - GET  /api/campaigns            -> lists all Campaign accounts on-chain (for the dashboard)
//    - GET  /api/coupons/:wallet      -> lists all Coupon accounts owned by a given wallet
//    - POST /api/ai-campaign-advisor  -> turns natural language into a structured campaign proposal
//    - POST /api/solana-pay/create-session -> creates a Solana Pay payment request
//    - GET  /api/solana-pay/status/:reference -> checks payment status by reference

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const {
  Keypair,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
} = require("@solana/web3.js");
const anchor = require("@coral-xyz/anchor");

// ----------------------------
// Solana Pay core (spec-level)
// ----------------------------
const {
  encodeURL,
  findReference,
  FindReferenceError,
} = require("@solana/pay");

// BigNumber is required for the `amount` field used by encodeURL
const BigNumber = require("bignumber.js");

const app = express();
const PORT = process.env.PORT || 8787;
const LAMPORTS_PER_SOL = 1_000_000_000;

// -----------------------------------------------------------------------------
// ENV + constants
// -----------------------------------------------------------------------------

/**
 * Path where we persist the merchant keypair (JSON with secretKey array).
 * This keypair acts as:
 *  - Protocol admin (for initialize_config)
 *  - Merchant that creates campaigns and pays rent for PDAs
 */
const MERCHANT_KEYPAIR_PATH = path.join(
  __dirname,
  "..",
  "merchant-keypair.json"
);

/**
 * Optional environment variable for the platform treasury.
 * If not provided or invalid, we will default to the merchant public key.
 *
 * Example:
 *   PLATFORM_TREASURY_ADDRESS=YourPlatformPubkeyHere
 */
const PLATFORM_TREASURY_ADDRESS = process.env.PLATFORM_TREASURY_ADDRESS || null;

/**
 * Solana RPC URL. For devnet use:
 *   SOLANA_RPC_URL=https://api.devnet.solana.com
 *
 * You can (and should) replace this with a private devnet RPC if possible,
 * e.g. from QuickNode, Helius, Triton, etc., to avoid 429 rate limits and
 * intermittent timeouts.
 */
const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
console.log("[RPC] Using SOLANA_RPC_URL:", SOLANA_RPC_URL);

const SOLANA_CLUSTER =
  process.env.SOLANA_CLUSTER ||
  (SOLANA_RPC_URL.includes("devnet") ? "devnet" : "mainnet-beta");
console.log("[RPC] Using SOLANA_CLUSTER:", SOLANA_CLUSTER);

const MIN_VAULT_RESERVE_LAMPORTS = Number(
  process.env.MIN_VAULT_RESERVE_LAMPORTS ?? 5_000_000
);

const clampBpsInput = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(10_000, parsed));
};

const DEFAULT_MAX_RESALE_BPS = clampBpsInput(
  process.env.DEFAULT_MAX_RESALE_BPS ?? 5_000,
  5_000
);
const DEFAULT_SERVICE_FEE_BPS = clampBpsInput(
  process.env.DEFAULT_SERVICE_FEE_BPS ?? 1_000,
  1_000
);

console.log(
  "[CONFIG] Default max_resale_bps:",
  DEFAULT_MAX_RESALE_BPS,
  "default service_fee_bps:",
  DEFAULT_SERVICE_FEE_BPS
);

const GLOBAL_CONFIG_ACCOUNT_DATA_LEN = 8 + 32 + 2 + 2;

/**
 * Retry / backoff parameters for RPC calls.
 * These can be tuned via environment variables if needed.
 */
const RPC_MAX_RETRIES = Number(process.env.RPC_MAX_RETRIES || 5);
const RPC_RETRY_DELAY_MS = Number(process.env.RPC_RETRY_DELAY_MS || 1000);

/**
 * Program ID must match the one defined in your Anchor program:
 *
 *   declare_id!("275CL3mEoiKubGcPic1C488aHVqPGcM6gesJADidsoNB");
 */
const PROGRAM_ID_STRING =
  process.env.PROGRAM_ID || "41eti7CsZBWD1QYdor2RnxmqzsaNGpRQCkJQZqX2JEKr";
const PROGRAM_ID = new PublicKey(PROGRAM_ID_STRING);

// Default IDL location is inside ai-server/idl/promo_targeting.json
const DEFAULT_IDL_PATH = path.join(__dirname, "idl", "promo_targeting.json");

/**
 * IDL path resolution:
 * - If PROMO_IDL_PATH is set in .env, we resolve it relative to this file.
 * - Otherwise, we fall back to DEFAULT_IDL_PATH.
 *
 * Example .env override for local dev:
 *   PROMO_IDL_PATH=../target/idl/promo_targeting.json
 */
const IDL_PATH = process.env.PROMO_IDL_PATH
  ? path.resolve(__dirname, process.env.PROMO_IDL_PATH)
  : DEFAULT_IDL_PATH;


let PROGRAM_IDL = null;
let CODER = null;

try {
  console.log("[IDL] Loading IDL from:", IDL_PATH);
  PROGRAM_IDL = require(IDL_PATH);
  CODER = new anchor.BorshCoder(PROGRAM_IDL);
  console.log("[IDL] Successfully loaded IDL and initialized BorshCoder.");
  if (Array.isArray(PROGRAM_IDL.instructions)) {
    console.log(
      "[IDL] Instructions available:",
      PROGRAM_IDL.instructions.map((ix) => ix.name)
    );
  } else {
    console.log("[IDL] No instructions array found in IDL.");
  }
} catch (e) {
  console.warn(
    "[WARN] Could not load IDL at",
    IDL_PATH,
    "- on-chain endpoints will fail until this is fixed."
  );
  console.warn("[WARN] Error details:", e.message || String(e));
}

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "[WARN] OPENAI_API_KEY is not set. Please add it to your .env file in ai-server/"
  );
}

// In-memory secondary market listings (MVP only, not persisted)
let secondaryListings = [];

/**
 * Helper to generate a simple unique ID for listings.
 * Avoids adding extra dependencies like uuid.
 */
function generateListingId() {
  return (
    "lst_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

app.use(cors());
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(
  express.raw({
    type: ["application/octet-stream", "text/plain"],
    limit: "1mb",
  })
);

// Simple mapping between on-chain product_code and frontend product ids.
const PRODUCT_CODE_TO_PRODUCT_ID = {
  1: "1", // Premium Coffee
  2: "2", // Artisan Chocolate Bar
  3: "3", // Minimalist T-Shirt
};

// If you also need the reverse:
const PRODUCT_ID_TO_PRODUCT_CODE = {
  "1": 1,
  "2": 2,
  "3": 3,
};

// Keep these prices in sync with frontend/src/data/products.ts
const PRODUCT_CODE_PRICE_SOL = {
  1: 0.24,
  2: 0.12,
  3: 0.34,
};

/**
 * Small error type to signal coupon validation issues (4xx for the client).
 */
class CouponValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "CouponValidationError";
    this.statusCode = statusCode;
  }
}

/**
 * Validate that:
 *  - coupon exists on-chain
 *  - belongs to payerWallet
 *  - is not used / not listed / not expired
 *  - (if orderItems provided) product_code matches at least one item in the cart
 *
 * Returns a small normalized object with key fields if valid.
 */
async function validateCouponForOrder({
  couponAddress,
  payerWallet,
  orderItems,
}) {
  if (!PROGRAM_IDL || !CODER) {
    throw new CouponValidationError(
      "Protocol IDL is not loaded on the server.",
      500
    );
  }

  let couponPk;
  try {
    couponPk = new PublicKey(couponAddress);
  } catch (e) {
    throw new CouponValidationError("Invalid couponAddress.");
  }

  const couponDef = findAccount(["coupon"]);
  const campaignDef = findAccount(["campaign"]);
  if (!couponDef || !campaignDef) {
    throw new CouponValidationError(
      "Program accounts (coupon / campaign) not found in IDL.",
      500
    );
  }

  const connection = sharedConnection;

  const couponInfo = await rpcWithBackoff(
    `getAccountInfo(coupon:${couponPk.toBase58()})`,
    () => connection.getAccountInfo(couponPk)
  );

  if (!couponInfo) {
    throw new CouponValidationError("Coupon account not found on-chain.");
  }

  const decodedCoupon = CODER.accounts.decode(
    couponDef.name,
    couponInfo.data
  );

  // Helper: pick a boolean field from decoded account
  const pickBool = (obj, keys, fallback = false) => {
    if (!obj) return fallback;
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "boolean") return v;
    }
    return fallback;
  };

  // Read owner and campaign from coupon
  let ownerPk = null;
  let campaignPk = null;

  if (decodedCoupon.owner && typeof decodedCoupon.owner.toBase58 === "function") {
    ownerPk = decodedCoupon.owner.toBase58();
  }

  if (
    decodedCoupon.campaign &&
    typeof decodedCoupon.campaign.toBase58 === "function"
  ) {
    campaignPk = decodedCoupon.campaign.toBase58();
  } else {
    // Fallback: any pubkey field that looks like "campaign"
    const pkFields = Object.entries(decodedCoupon)
      .filter(([, value]) => value && typeof value.toBase58 === "function")
      .map(([key, value]) => ({ key, value, base58: value.toBase58() }));

    const campaignField = pkFields.find((f) => /campaign/i.test(f.key));
    if (campaignField) {
      campaignPk = campaignField.base58;
    }
  }

  if (!ownerPk) {
    throw new CouponValidationError(
      "Failed to read coupon owner from on-chain account.",
      500
    );
  }

  if (!campaignPk) {
    throw new CouponValidationError(
      "Failed to read coupon campaign from on-chain account.",
      500
    );
  }

  // Check wallet that is trying to use the coupon
  if (payerWallet) {
    let payerPk;
    try {
      payerPk = new PublicKey(payerWallet);
    } catch {
      throw new CouponValidationError("Invalid payer wallet.");
    }

    if (ownerPk !== payerPk.toBase58()) {
      throw new CouponValidationError(
        "Coupon does not belong to this wallet."
      );
    }
  }

  const isUsed = pickBool(decodedCoupon, ["used", "is_used", "redeemed"], false);
  const isListed = pickBool(decodedCoupon, ["listed", "is_listed"], false);

  if (isUsed) {
    throw new CouponValidationError("Coupon is already used (unusable).");
  }

  if (isListed) {
    throw new CouponValidationError(
      "Coupon is listed for sale and cannot be used at checkout."
    );
  }

  // Load campaign to read product_code + expiration
  const campaignPubkey = new PublicKey(campaignPk);
  const campaignInfo = await rpcWithBackoff(
    `getAccountInfo(campaign:${campaignPk})`,
    () => connection.getAccountInfo(campaignPubkey)
  );

  if (!campaignInfo) {
    throw new CouponValidationError(
      "Campaign account not found for this coupon.",
      500
    );
  }

  const decodedCampaign = CODER.accounts.decode(
    campaignDef.name,
    campaignInfo.data
  );

  const productCode = getFirstNumeric(
    decodedCampaign,
    ["product_code", "productCode"],
    0
  );
  const expirationTimestamp = getFirstNumeric(
    decodedCampaign,
    ["expiration_timestamp", "expirationTimestamp"],
    0
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !!expirationTimestamp &&
    expirationTimestamp > 0 &&
    expirationTimestamp < nowSeconds
  ) {
    throw new CouponValidationError("Coupon is expired.");
  }

  // Product-level validation: coupon must match at least one product in cart
  if (
    Array.isArray(orderItems) &&
    orderItems.length > 0 &&
    productCode > 0
  ) {
    const expectedProductId = PRODUCT_CODE_TO_PRODUCT_ID[productCode];

    if (expectedProductId) {
      const cartIds = orderItems.map((item) => String(item.id));
      const hasMatch = cartIds.includes(String(expectedProductId));

      if (!hasMatch) {
        throw new CouponValidationError(
          "Coupon does not apply to any product in this order."
        );
      }
    }
  }

  return {
    couponAddress: couponPk.toBase58(),
    owner: ownerPk,
    campaignAddress: campaignPk,
    productCode,
    expirationTimestamp,
  };
}

// -----------------------------------------------------------------------------
// Helpers: generic retry wrapper for RPC calls
// -----------------------------------------------------------------------------

/**
 * Generic wrapper that retries a function returning a Promise
 * when a network/429 error is detected (rate-limit or timeout).
 *
 * @param {string} label - log label for this operation
 * @param {() => Promise<any>} fn - async function to execute
 * @returns {Promise<any>}
 */
async function rpcWithBackoff(label, fn) {
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      const msg = err?.message || String(err || "");
      const causeMsg = err?.cause?.message || "";
      const combined = `${msg} ${causeMsg}`;

      const is429 =
        combined.includes("Too many requests") ||
        combined.includes('"code": 429');
      const isTimeout =
        combined.includes("UND_ERR_CONNECT_TIMEOUT") ||
        combined.includes("Connect Timeout Error");

      const retriable = is429 || isTimeout;

      if (retriable && attempt < RPC_MAX_RETRIES) {
        const delayMs =
          RPC_RETRY_DELAY_MS * (attempt === 1 ? 1 : Math.min(attempt, 5));
        console.warn(
          `[rpcWithBackoff][${label}] Retriable RPC error (attempt ${attempt}/${RPC_MAX_RETRIES}). Waiting ${delayMs}ms...`
        );
        console.warn(`[rpcWithBackoff][${label}] Error: ${combined}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      console.error(
        `[rpcWithBackoff][${label}] Failed after ${attempt} attempt(s):`,
        combined
      );
      throw err;
    }
  }
}

/**
 * Helper: create a shared Connection instance.
 */
const sharedConnection = new Connection(SOLANA_RPC_URL, "confirmed");

// -----------------------------------------------------------------------------
// Helpers: merchant keypair
// -----------------------------------------------------------------------------

/**
 * Load or generate the merchant keypair.
 *
 * The file contains a JSON array of the secret key bytes.
 * This address is used as:
 *  - protocol admin (initialize_config)
 *  - merchant that funds campaigns and pays rent for PDAs
 */
function loadMerchantKeypair() {
  if (fs.existsSync(MERCHANT_KEYPAIR_PATH)) {
    const raw = JSON.parse(fs.readFileSync(MERCHANT_KEYPAIR_PATH, "utf8"));
    const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
    console.log(
      "[merchant] Loaded existing merchant keypair from",
      MERCHANT_KEYPAIR_PATH,
      "address:",
      kp.publicKey.toBase58()
    );
    return kp;
  } else {
    const kp = Keypair.generate();
    fs.writeFileSync(
      MERCHANT_KEYPAIR_PATH,
      JSON.stringify(Array.from(kp.secretKey), null, 2),
      "utf8"
    );
    console.log(
      "[merchant] Generated new merchant keypair at",
      MERCHANT_KEYPAIR_PATH,
      "address:",
      kp.publicKey.toBase58()
    );
    return kp;
  }
}

// -----------------------------------------------------------------------------
// Helpers: small numeric conversion
// -----------------------------------------------------------------------------

/**
 * Safely convert Anchor numeric types (BN, bigint, etc.) to a JS number.
 * For devnet/demo usage this is enough – if values get very large in the future
 * you might want to keep them as strings instead.
 */
function toNumberSafe(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value.toNumber === "function") {
    try {
      return value.toNumber();
    } catch {
      return Number(value);
    }
  }
  return Number(value);
}

/**
 * Convenience helper: read the first numeric key that exists in an object.
 */
function getFirstNumeric(obj, keys, defaultValue) {
  if (!obj) return defaultValue;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = toNumberSafe(obj[k]);
      if (!Number.isNaN(v)) return v;
    }
  }
  return defaultValue;
}

// -----------------------------------------------------------------------------
// Helpers: IDL-based instruction / account lookup + arg mapping
// -----------------------------------------------------------------------------

/**
 * Find an instruction in the IDL whose name matches all substrings in `patterns`
 * (case-insensitive).
 */
function findInstruction(patterns) {
  if (!PROGRAM_IDL || !Array.isArray(PROGRAM_IDL.instructions)) {
    return null;
  }
  const lowerPatterns = patterns.map((p) => p.toLowerCase());
  return (
    PROGRAM_IDL.instructions.find((ix) => {
      const n = (ix.name || "").toLowerCase();
      return lowerPatterns.every((p) => n.includes(p));
    }) || null
  );
}

/**
 * Find an account type in the IDL whose name matches all substrings in `patterns`
 * (case-insensitive).
 */
function findAccount(patterns) {
  if (!PROGRAM_IDL || !Array.isArray(PROGRAM_IDL.accounts)) {
    return null;
  }
  const lowerPatterns = patterns.map((p) => p.toLowerCase());
  return (
    PROGRAM_IDL.accounts.find((acct) => {
      const n = (acct.name || "").toLowerCase();
      return lowerPatterns.every((p) => n.includes(p));
    }) || null
  );
}

/**
 * Build an args object for BorshCoder based on the IDL's arg list.
 */
function buildArgsFromIdl(idlArgs, valuesMap) {
  const argsObj = {};
  for (const arg of idlArgs) {
    const name = arg.name;
    if (!(name in valuesMap)) {
      throw new Error(
        `No value mapped for IDL argument '${name}'. Available keys: ${Object.keys(
          valuesMap
        ).join(", ")}`
      );
    }
    argsObj[name] = valuesMap[name];
  }
  return argsObj;
}

/**
 * Resolve the platform treasury account to a valid, system-owned wallet.
 * If the configured PLATFORM_TREASURY_ADDRESS is missing, invalid, or not a
 * system account, we fall back to the merchant public key so transactions do
 * not fail with rent errors.
 *
 * @param {Connection} connection
 * @param {PublicKey} merchantPubkey
 * @param {string} label
 * @returns {Promise<PublicKey>}
 */
async function resolvePlatformTreasuryPubkey(
  connection,
  merchantPubkey,
  label
) {
  if (!PLATFORM_TREASURY_ADDRESS) {
    return merchantPubkey;
  }

  let candidate;
  try {
    candidate = new PublicKey(PLATFORM_TREASURY_ADDRESS);
  } catch (e) {
    console.warn(
      `${label} Invalid PLATFORM_TREASURY_ADDRESS provided (${PLATFORM_TREASURY_ADDRESS}), falling back to merchant public key.`,
      e?.message || String(e)
    );
    return merchantPubkey;
  }

  try {
    const accountInfo = await rpcWithBackoff(
      `getAccountInfo(platform_treasury:${candidate.toBase58()})`,
      () => connection.getAccountInfo(candidate)
    );

    if (!accountInfo) {
      console.warn(
        `${label} PLATFORM_TREASURY_ADDRESS (${candidate.toBase58()}) not found on-chain. Falling back to merchant public key.`
      );
      return merchantPubkey;
    }

    if (!accountInfo.owner.equals(SystemProgram.programId)) {
      console.warn(
        `${label} PLATFORM_TREASURY_ADDRESS (${candidate.toBase58()}) is not system-owned (owner: ${accountInfo.owner.toBase58()}). Falling back to merchant public key.`
      );
      return merchantPubkey;
    }

    return candidate;
  } catch (err) {
    console.warn(
      `${label} Failed to validate PLATFORM_TREASURY_ADDRESS (${PLATFORM_TREASURY_ADDRESS}). Falling back to merchant public key.`,
      err?.message || String(err)
    );
    return merchantPubkey;
  }
}

// -----------------------------------------------------------------------------
// Helpers: funding / low-level instruction senders (no anchor.Program)
// -----------------------------------------------------------------------------

/**
 * Ensure the given account has at least `minLamports`.
 * If not, request an airdrop (devnet) and wait for confirmation.
 */
async function ensureAccountFunded(connection, pubkey, minLamports) {
  const label = `getBalance(${pubkey.toBase58()})`;
  const currentBalance = await rpcWithBackoff(label, () =>
    connection.getBalance(pubkey)
  );

  console.log(
    `[funding] Current balance for ${pubkey.toBase58()}: ${currentBalance} lamports`
  );

  if (currentBalance >= minLamports) {
    console.log("[funding] Account already funded enough, skipping airdrop.");
    return;
  }

  const requested = Math.min(minLamports - currentBalance, 200_000_000); // up to 0.2 SOL
  console.log(
    `[funding] Requesting airdrop of ${requested} lamports (~${
      requested / 1_000_000_000
    } SOL) for ${pubkey.toBase58()}`
  );

  const sig = await rpcWithBackoff("requestAirdrop", () =>
    connection.requestAirdrop(pubkey, requested)
  );

  await rpcWithBackoff("confirmTransaction(airdrop)", () =>
    connection.confirmTransaction(sig, "confirmed")
  );

  const newBalance = await rpcWithBackoff(label, () =>
    connection.getBalance(pubkey)
  );
  console.log(
    `[funding] New balance for ${pubkey.toBase58()}: ${newBalance} lamports`
  );
}

/**
 * Ensure the GlobalConfig PDA exists (config account).
 */
async function ensureGlobalConfig(connection, adminKeypair) {
  if (!CODER || !PROGRAM_IDL) {
    throw new Error(
      "IDL coder not initialized. Check PROMO_IDL_PATH and run `anchor build`."
    );
  }

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );

  const info = await rpcWithBackoff(
    `getAccountInfo(config:${configPda.toBase58()})`,
    () => connection.getAccountInfo(configPda)
  );

  if (info) {
    console.log(
      "[initialize_config] GlobalConfig already exists at",
      configPda.toBase58()
    );
    if (info.data.length !== GLOBAL_CONFIG_ACCOUNT_DATA_LEN) {
      console.log(
        "[initialize_config] GlobalConfig has legacy size",
        info.data.length,
        "expected",
        GLOBAL_CONFIG_ACCOUNT_DATA_LEN,
        "- running upgrade_config to add service_fee_bps."
      );
      const legacy = decodeLegacyGlobalConfig(info.data);
      await upgradeGlobalConfigAccount(
        connection,
        adminKeypair,
        legacy.maxResaleBps ?? DEFAULT_MAX_RESALE_BPS,
        DEFAULT_SERVICE_FEE_BPS
      );
    }
    return configPda;
  }

  console.log(
    "[initialize_config] GlobalConfig not found. Initializing with demo parameters..."
  );

  const maxResaleBps = DEFAULT_MAX_RESALE_BPS;
  const serviceFeeBps = DEFAULT_SERVICE_FEE_BPS;

  const initIx = findInstruction(["initialize", "config"]);
  if (!initIx) {
    throw new Error(
      `Could not find initialize_config-like instruction in IDL. Available instructions: ${
        PROGRAM_IDL.instructions
          ? PROGRAM_IDL.instructions.map((ix) => ix.name).join(", ")
          : "none"
      }`
    );
  }

  console.log(
    `[initialize_config] Using IDL instruction name: ${initIx.name}, args:`,
    initIx.args.map((a) => a.name)
  );

  const valuesMap = {
    max_resale_bps: maxResaleBps,
    maxResaleBps: maxResaleBps,
    service_fee_bps: serviceFeeBps,
    serviceFeeBps: serviceFeeBps,
  };

  const encodedArgs = buildArgsFromIdl(initIx.args, valuesMap);
  const data = CODER.instruction.encode(initIx.name, encodedArgs);

  const keys = [
    {
      pubkey: configPda,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: adminKeypair.publicKey,
      isSigner: true,
      isWritable: true,
    },
    {
      pubkey: SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: SYSVAR_RENT_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
  ];

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(ix);
  const signature = await sendAndConfirmTransaction(connection, tx, [
    adminKeypair,
  ]);

  console.log(
    "[initialize_config] GlobalConfig created at",
    configPda.toBase58(),
    "tx:",
    signature
  );

  return configPda;
}

async function upgradeGlobalConfigAccount(
  connection,
  adminKeypair,
  maxResaleBps,
  serviceFeeBps
) {
  if (!CODER || !PROGRAM_IDL) {
    throw new Error(
      "IDL coder not initialized. Check PROMO_IDL_PATH and run `anchor build`."
    );
  }

  const upgradeIx = findInstruction(["upgrade", "config"]);
  if (!upgradeIx) {
    throw new Error(
      `Could not find upgrade_config-like instruction in IDL. Available instructions: ${
        PROGRAM_IDL.instructions
          ? PROGRAM_IDL.instructions.map((ix) => ix.name).join(", ")
          : "none"
      }`
    );
  }

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );

  console.log(
    "[upgrade_config] Upgrading GlobalConfig PDA:",
    configPda.toBase58()
  );

  const valuesMap = {
    max_resale_bps: maxResaleBps,
    maxResaleBps: maxResaleBps,
    service_fee_bps: serviceFeeBps,
    serviceFeeBps: serviceFeeBps,
  };

  const encodedArgs = buildArgsFromIdl(upgradeIx.args, valuesMap);
  const data = CODER.instruction.encode(upgradeIx.name, encodedArgs);

  const keys = [
    {
      pubkey: configPda,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: adminKeypair.publicKey,
      isSigner: true,
      isWritable: true,
    },
    {
      pubkey: SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
  ];

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(ix);
  const signature = await sendAndConfirmTransaction(connection, tx, [
    adminKeypair,
  ]);

  console.log("[upgrade_config] GlobalConfig upgraded. tx:", signature);
  return signature;
}

async function fetchGlobalConfigAccount(connection) {
  if (!CODER || !PROGRAM_IDL) {
    throw new Error(
      "IDL coder not initialized. Check PROMO_IDL_PATH and run `anchor build`."
    );
  }

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );

  const info = await rpcWithBackoff(
    `getAccountInfo(config:${configPda.toBase58()})`,
    () => connection.getAccountInfo(configPda)
  );

  if (!info) {
    return null;
  }

  const configDef =
    findAccount(["global", "config"]) || findAccount(["config"]);
  if (!configDef) {
    throw new Error(
      `Could not find GlobalConfig account in IDL. Available accounts: ${
        PROGRAM_IDL.accounts
          ? PROGRAM_IDL.accounts.map((a) => a.name).join(", ")
          : "none"
      }`
    );
  }

  let decoded = null;
  try {
    decoded = CODER.accounts.decode(configDef.name, info.data);
  } catch (err) {
    console.warn(
      "[fetchGlobalConfigAccount] Failed to decode config with latest IDL. Trying legacy layout fallback.",
      err?.message || String(err)
    );
    decoded = decodeLegacyGlobalConfig(info.data);
  }

  const maxResaleBps = getFirstNumeric(
    decoded,
    ["max_resale_bps", "maxResaleBps"],
    DEFAULT_MAX_RESALE_BPS
  );

  const serviceFeeBps = getFirstNumeric(
    decoded,
    ["service_fee_bps", "serviceFeeBps"],
    DEFAULT_SERVICE_FEE_BPS
  );

  return {
    pubkey: configPda,
    decoded,
    maxResaleBps,
    serviceFeeBps,
  };
}

function decodeLegacyGlobalConfig(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const discriminatorLen = 8;
  const adminOffset = discriminatorLen;
  const maxResaleOffset = adminOffset + 32;

  if (buffer.length < maxResaleOffset + 2) {
    throw new Error(
      `Legacy GlobalConfig buffer too small (len=${buffer.length}). Cannot decode.`
    );
  }

  const adminBytes = buffer.slice(adminOffset, adminOffset + 32);
  const admin = new PublicKey(adminBytes);
  const maxResaleBps = buffer.readUInt16LE(maxResaleOffset);

  return {
    admin,
    maxResaleBps,
    serviceFeeBps: DEFAULT_SERVICE_FEE_BPS,
  };
}

/**
 * Send the create_campaign instruction using only BorshCoder + web3.js.
 */
async function sendCreateCampaignTx(connection, merchantKeypair, params) {
  if (!CODER || !PROGRAM_IDL) {
    throw new Error(
      "IDL coder not initialized. Check PROMO_IDL_PATH and run `anchor build`."
    );
  }

  const {
    configPda,
    campaignPda,
    vaultPda,
    campaignId,
    discountBps,
    resaleBps,
    expirationTimestamp,
    totalCoupons,
    mintCostLamports,
    maxDiscountLamports,
    categoryCode,
    productCode,
    campaignName,
    depositAmount,
    requiresWallet,
    targetWalletPubkey,
  } = params;

  const createIx = findInstruction(["create", "campaign"]);
  if (!createIx) {
    throw new Error(
      `Could not find create_campaign-like instruction in IDL. Available instructions: ${
        PROGRAM_IDL.instructions
          ? PROGRAM_IDL.instructions.map((ix) => ix.name).join(", ")
          : "none"
      }`
    );
  }

  console.log(
    `[create_campaign] Using IDL instruction name: ${createIx.name}, args:`,
    createIx.args.map((a) => a.name)
  );

  const valuesMap = {
    campaign_id: campaignId,
    campaignId: campaignId,

    discount_bps: discountBps,
    discountBps: discountBps,

    resale_bps: resaleBps,
    resaleBps: resaleBps,

    expiration_timestamp: expirationTimestamp,
    expirationTimestamp: expirationTimestamp,

    total_coupons: totalCoupons,
    totalCoupons: totalCoupons,

    mint_cost_lamports: mintCostLamports,
    mintCostLamports: mintCostLamports,

    max_discount_lamports: maxDiscountLamports,
    maxDiscountLamports: maxDiscountLamports,

    category_code: categoryCode,
    categoryCode: categoryCode,
    product_code: productCode,
    productCode: productCode,

    campaign_name: campaignName,
    campaignName: campaignName,

    deposit_amount: depositAmount,
    depositAmount: depositAmount,

    requires_wallet: requiresWallet,
    requiresWallet: requiresWallet,

    target_wallet: targetWalletPubkey,
    targetWallet: targetWalletPubkey,
  };

  const encodedArgs = buildArgsFromIdl(createIx.args, valuesMap);
  const data = CODER.instruction.encode(createIx.name, encodedArgs);

  const keys = [
    {
      pubkey: configPda,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: campaignPda,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: vaultPda,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: merchantKeypair.publicKey,
      isSigner: true,
      isWritable: true,
    },
    {
      pubkey: SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: SYSVAR_RENT_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
  ];

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(ix);

  const signature = await sendAndConfirmTransaction(connection, tx, [
    merchantKeypair,
  ]);

  return signature;
}

/**
 * Send the mint_coupon instruction using only BorshCoder + web3.js.
 */
async function sendMintCouponTx(connection, merchantKeypair, params) {
  if (!CODER || !PROGRAM_IDL) {
    throw new Error(
      "IDL coder not initialized. Check PROMO_IDL_PATH and run `anchor build`."
    );
  }

  const {
    campaignPda,
    vaultPda,
    couponPda,
    recipientPubkey,
    platformTreasuryPubkey,
    campaignIdBn,
    couponIndexBn,
  } = params;

  const mintIx = findInstruction(["mint", "coupon"]);
  if (!mintIx) {
    throw new Error(
      `Could not find mint_coupon-like instruction in IDL. Available instructions: ${
        PROGRAM_IDL.instructions
          ? PROGRAM_IDL.instructions.map((ix) => ix.name).join(", ")
          : "none"
      }`
    );
  }

  console.log(
    `[mint_coupon] Using IDL instruction name: ${mintIx.name}, args:`,
    Array.isArray(mintIx.args) ? mintIx.args.map((a) => a.name) : []
  );

  const valuesMap = {
    campaign_id: campaignIdBn,
    campaignId: campaignIdBn,
    coupon_index: couponIndexBn,
    couponIndex: couponIndexBn,
  };

  const encodedArgs = buildArgsFromIdl(mintIx.args || [], valuesMap);
  const data = CODER.instruction.encode(mintIx.name, encodedArgs);

  const keys = [
    {
      pubkey: campaignPda,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: vaultPda,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: couponPda,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: merchantKeypair.publicKey,
      isSigner: true,
      isWritable: true,
    },
    {
      pubkey: recipientPubkey,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: platformTreasuryPubkey,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: SYSVAR_RENT_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
  ];

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(ix);

  const signature = await sendAndConfirmTransaction(connection, tx, [
    merchantKeypair,
  ]);

  return signature;
}

// -----------------------------------------------------------------------------
// AI endpoint: used by the dashboard AI Campaign Copilot
// -----------------------------------------------------------------------------

app.post("/api/ai-campaign-advisor", async (req, res) => {
  const { message, metrics, profile, campaigns, shopper_context } =
    req.body || {};

  console.log("[ai-campaign-advisor] Incoming payload:", {
    hasMessage: !!message,
    hasMetrics: !!metrics,
    hasProfile: !!profile,
    campaignsCount: Array.isArray(campaigns) ? campaigns.length : 0,
    hasShopperContext: !!shopper_context,
  });

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an AI campaign strategist for a Web3 discount-coupon protocol on Solana. " +
              "You help merchants design on-chain discount campaigns using coupons that can be minted, traded and redeemed. " +
              "Every campaign MUST include a 10% protocol fee, so set service_fee_bps to exactly 1000 in the proposal. " +
              "You ALWAYS answer in English and you must return ONLY a valid JSON object with the following structure:\n\n" +
              "{\n" +
              '  "assistant_text": string,\n' +
              '  "proposal": {\n' +
              '    "name": string,\n' +
              '    "audience": string | null,\n' +
              '    "period_label": string | null,\n' +
              '    "discount_bps": number,\n' +
              '    "service_fee_bps": number,\n' +
              '    "resale_bps": number,\n' +
              '    "expiration_timestamp": number,\n' +
              '    "total_coupons": number,\n' +
              '    "mint_cost_lamports": number,\n' +
              '    "max_discount_lamports": number,\n' +
              '    "deposit_amount_lamports": number,\n' +
              '    "category_code": number,\n' +
              '    "product_code": number,\n' +
              '    "requires_wallet": boolean,\n' +
              '    "target_wallet": string | null,\n' +
              '    "minted_coupons": number,\n' +
              '    "used_coupons": number\n' +
              "  }\n" +
              "}\n\n" +
              "The JSON must not contain any comments or trailing commas. " +
              "Infer missing technical parameters from the merchant goal, risk tolerance and metrics. " +
              "If the user mentions Black Friday or a specific date, set a matching expiration_timestamp and period_label.",
          },
          {
            role: "user",
            content: JSON.stringify({
              user_message: message,
              metrics,
              merchant_profile: profile,
              existing_campaigns: campaigns,
              shopper_context,
            }),
          },
        ],
        temperature: 0.4,
      }),
    });

    if (!openaiRes.ok) {
      const errorText = await openaiRes.text();
      console.error("[OpenAI error]", errorText);
      return res.status(500).json({
        error: "OpenAI API error",
        details: errorText,
      });
    }

    const data = await openaiRes.json();
    const rawContent =
      data.choices?.[0]?.message?.content ||
      '{"assistant_text":"Could not generate a suggestion right now. Please try again in a few seconds.","proposal":null}';

    let assistantText = "";
    let proposal = null;

    try {
      const parsed = JSON.parse(rawContent);
      assistantText =
        parsed.assistant_text ||
        "Could not generate a suggestion right now. Please try again in a few seconds.";
      proposal = parsed.proposal || null;
    } catch (parseErr) {
      console.warn(
        "[ai-campaign-advisor] Failed to parse JSON from OpenAI, returning raw text.",
        parseErr
      );
      assistantText =
        rawContent ||
        "Could not generate a suggestion right now. Please try again in a few seconds.";
      proposal = null;
    }

    res.json({ reply: assistantText, proposal });
  } catch (err) {
    console.error("[Server error]", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message || String(err),
    });
  }
});

app.post("/api/ai-suggestions", async (req, res) => {
  req.url = "/api/ai-campaign-advisor";
  app._router.handle(req, res, () => {});
});

// -----------------------------------------------------------------------------
// Read-only endpoint: fetch a single Campaign account by public key
// -----------------------------------------------------------------------------

app.get("/api/campaign/:address", async (req, res) => {
  const { address } = req.params;

  try {
    if (!PROGRAM_IDL || !CODER) {
      throw new Error(
        "IDL not loaded or coder not initialized. Run `anchor build` and check PROMO_IDL_PATH."
      );
    }

    let pubkey;
    try {
      pubkey = new PublicKey(address);
    } catch (e) {
      return res.status(400).json({
        error: "Invalid campaign address",
        details: e.message || String(e),
      });
    }

    const info = await rpcWithBackoff(
      `getAccountInfo(campaign:${pubkey.toBase58()})`,
      () => sharedConnection.getAccountInfo(pubkey)
    );

    if (!info) {
      return res.status(404).json({
        error: "Campaign account not found",
      });
    }

    const campaignDef = findAccount(["campaign"]);
    if (!campaignDef) {
      throw new Error(
        `Could not find 'campaign' account in IDL. Available accounts: ${
          PROGRAM_IDL.accounts
            ? PROGRAM_IDL.accounts.map((a) => a.name).join(", ")
            : "none"
        }`
      );
    }

    const decoded = CODER.accounts.decode(campaignDef.name, info.data);

    const sanitizedData = {};
    for (const [key, value] of Object.entries(decoded)) {
      if (
        value &&
        typeof value === "object" &&
        value.toString &&
        value._bn
      ) {
        sanitizedData[key] = value.toString();
      } else if (value && typeof value.toBase58 === "function") {
        sanitizedData[key] = value.toBase58();
      } else {
        sanitizedData[key] = value;
      }
    }

    res.json({
      pubkey: pubkey.toBase58(),
      lamports: info.lamports,
      data: sanitizedData,
    });
  } catch (err) {
    console.error("[get-campaign error]", err);
    res.status(500).json({
      error: "Failed to fetch campaign account",
      details: err.message || String(err),
    });
  }
});

// -----------------------------------------------------------------------------
// Read-only endpoint: list all Campaign accounts for this program
// -----------------------------------------------------------------------------

app.get("/api/campaigns", async (_req, res) => {
  try {
    if (!PROGRAM_IDL || !CODER) {
      throw new Error(
        "IDL not loaded or coder not initialized. Run `anchor build` and check PROMO_IDL_PATH."
      );
    }

    const rawAccounts = await rpcWithBackoff("getProgramAccounts(campaigns)", () =>
      sharedConnection.getProgramAccounts(PROGRAM_ID)
    );

    const campaignDef = findAccount(["campaign"]);
    if (!campaignDef) {
      throw new Error(
        `Could not find 'campaign' account in IDL. Available accounts: ${
          PROGRAM_IDL.accounts
            ? PROGRAM_IDL.accounts.map((a) => a.name).join(", ")
            : "none"
        }`
      );
    }

    const campaigns = [];

    const pickString = (obj, keys, fallback = "") => {
      if (!obj) return fallback;
      for (const k of keys) {
        const v = obj[k];
        if (typeof v === "string" && v.length > 0) {
          return v;
        }
      }
      return fallback;
    };

    const pickBool = (obj, keys, fallback = false) => {
      if (!obj) return fallback;
      for (const k of keys) {
        const v = obj[k];
        if (typeof v === "boolean") {
          return v;
        }
      }
      return fallback;
    };

    for (const acc of rawAccounts) {
      const { pubkey, account } = acc;
      try {
        const decoded = CODER.accounts.decode(campaignDef.name, account.data);

        const merchantPk =
          decoded.merchant && typeof decoded.merchant.toBase58 === "function"
            ? decoded.merchant.toBase58()
            : null;

        let targetWalletPk = null;
        if (
          decoded.target_wallet &&
          typeof decoded.target_wallet.toBase58 === "function"
        ) {
          targetWalletPk = decoded.target_wallet.toBase58();
        } else if (
          decoded.targetWallet &&
          typeof decoded.targetWallet.toBase58 === "function"
        ) {
          targetWalletPk = decoded.targetWallet.toBase58();
        }

        campaigns.push({
          address: pubkey.toBase58(),
          merchant: merchantPk,
          campaign_id: getFirstNumeric(
            decoded,
            ["campaign_id", "campaignId"],
            0
          ),
          discount_bps: getFirstNumeric(
            decoded,
            ["discount_bps", "discountBps"],
            0
          ),
          service_fee_bps: getFirstNumeric(
            decoded,
            ["service_fee_bps", "serviceFeeBps"],
            0
          ),
          resale_bps: getFirstNumeric(
            decoded,
            ["resale_bps", "resaleBps"],
            0
          ),
          expiration_timestamp: getFirstNumeric(
            decoded,
            ["expiration_timestamp", "expirationTimestamp"],
            0
          ),
          total_coupons: getFirstNumeric(
            decoded,
            ["total_coupons", "totalCoupons"],
            0
          ),
          used_coupons: getFirstNumeric(
            decoded,
            ["used_coupons", "usedCoupons"],
            0
          ),
          minted_coupons: getFirstNumeric(
            decoded,
            ["minted_coupons", "mintedCoupons"],
            0
          ),
          mint_cost_lamports: getFirstNumeric(
            decoded,
            ["mint_cost_lamports", "mintCostLamports"],
            0
          ),
          max_discount_lamports: getFirstNumeric(
            decoded,
            ["max_discount_lamports", "maxDiscountLamports"],
            0
          ),
          category_code: getFirstNumeric(
            decoded,
            ["category_code", "categoryCode"],
            0
          ),
          product_code: getFirstNumeric(
            decoded,
            ["product_code", "productCode"],
            0
          ),
          campaign_name: pickString(
            decoded,
            ["campaign_name", "campaignName"],
            ""
          ),
          requires_wallet: pickBool(
            decoded,
            ["requires_wallet", "requiresWallet"],
            false
          ),
          target_wallet: targetWalletPk,
        });
      } catch (_e) {
        continue;
      }
    }

    console.log(
      `[api/campaigns] Returning ${campaigns.length} on-chain campaign(s).`
    );

    res.json({ campaigns });
  } catch (err) {
    console.error("[api/campaigns error]", err);
    res.status(500).json({
      error: "Failed to list on-chain campaigns",
      details: err?.message || String(err),
    });
  }
});

// In-memory set of locally "used" coupons (until we implement full on-chain redemption from the shopper wallet)
const locallyUsedCoupons = new Set();
const locallyListedCoupons = new Set();

// -----------------------------------------------------------------------------
// Read-only endpoint: list Coupon accounts for a given recipient wallet
// -----------------------------------------------------------------------------

app.get("/api/coupons/:walletAddress", async (req, res) => {
  const { walletAddress } = req.params;

  console.log("[api/coupons] Incoming request for wallet:", walletAddress);

  try {
    if (!PROGRAM_IDL || !CODER) {
      throw new Error(
        "IDL not loaded or coder not initialized. Run `anchor build` and check PROMO_IDL_PATH."
      );
    }

    let recipientFilterPk;
    try {
      recipientFilterPk = new PublicKey(walletAddress);
    } catch (e) {
      return res.status(400).json({
        error: "Invalid wallet address",
        details: e.message || String(e),
      });
    }

    const rawAccounts = await rpcWithBackoff("getProgramAccounts(coupons)", () =>
      sharedConnection.getProgramAccounts(PROGRAM_ID)
    );

    const couponDef = findAccount(["coupon"]);
    const campaignDef = findAccount(["campaign"]);
    if (!couponDef) {
      throw new Error(
        `Could not find 'coupon' account in IDL. Available accounts: ${
          PROGRAM_IDL.accounts
            ? PROGRAM_IDL.accounts.map((a) => a.name).join(", ")
            : "none"
        }`
      );
    }
    if (!campaignDef) {
      throw new Error(
        `Could not find 'campaign' account in IDL. Available accounts: ${
          PROGRAM_IDL.accounts
            ? PROGRAM_IDL.accounts.map((a) => a.name).join(", ")
            : "none"
        }`
      );
    }

    const pickBool = (obj, keys, fallback = false) => {
      if (!obj) return fallback;
      for (const k of keys) {
        const v = obj[k];
        if (typeof v === "boolean") {
          return v;
        }
      }
      return fallback;
    };

    const coupons = [];
    const targetBase58 = recipientFilterPk.toBase58();
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const acc of rawAccounts) {
      const { pubkey, account } = acc;
      const couponAddress = pubkey.toBase58();

      try {
        const decodedCoupon = CODER.accounts.decode(
          couponDef.name,
          account.data
        );

        const pkFields = Object.entries(decodedCoupon)
          .filter(([, value]) => value && typeof value.toBase58 === "function")
          .map(([key, value]) => ({
            key,
            value,
            base58: value.toBase58(),
          }));

        if (pkFields.length === 0) {
          continue;
        }

        const ownedByWallet = pkFields.some(
          (f) => f.base58 === targetBase58
        );

        if (!ownedByWallet) {
          continue;
        }

        let recipientField =
          pkFields.find((f) =>
            /recipient|owner|customer|wallet/i.test(f.key)
          ) || pkFields[0];

        const recipientPk = recipientField.base58;

        let campaignPk = null;
        const campaignField = pkFields.find((f) =>
          /campaign/i.test(f.key)
        );
        if (campaignField) {
          campaignPk = campaignField.base58;
        }

        let discountBps = 0;
        let maxDiscountLamports = 0;
        let expirationTimestamp = 0;
        let categoryCode = 0;
        let productCode = 0;

        if (campaignPk) {
          try {
            const campaignPubkey = new PublicKey(campaignPk);
            const campaignInfo = await rpcWithBackoff(
              `getAccountInfo(campaign:${campaignPk})`,
              () => sharedConnection.getAccountInfo(campaignPubkey)
            );

            if (campaignInfo) {
              const decodedCampaign = CODER.accounts.decode(
                campaignDef.name,
                campaignInfo.data
              );

              discountBps = getFirstNumeric(
                decodedCampaign,
                ["discount_bps", "discountBps"],
                0
              );
              maxDiscountLamports = getFirstNumeric(
                decodedCampaign,
                ["max_discount_lamports", "maxDiscountLamports"],
                0
              );
              expirationTimestamp = getFirstNumeric(
                decodedCampaign,
                ["expiration_timestamp", "expirationTimestamp"],
                0
              );
              categoryCode = getFirstNumeric(
                decodedCampaign,
                ["category_code", "categoryCode"],
                0
              );
              productCode = getFirstNumeric(
                decodedCampaign,
                ["product_code", "productCode"],
                0
              );
            } else {
              console.warn(
                "[api/coupons] Campaign account not found on-chain for coupon:",
                couponAddress,
                "campaign:",
                campaignPk
              );
            }
          } catch (campaignErr) {
            console.warn(
              "[api/coupons] Failed to load/parse campaign for coupon:",
              couponAddress,
              "campaignPk:",
              campaignPk,
              "reason:",
              campaignErr.message || String(campaignErr)
            );
          }
        }

        const isUsedOnChain = pickBool(
          decodedCoupon,
          ["is_used", "used", "redeemed"],
          false
        );
        const isListed = pickBool(
          decodedCoupon,
          ["listed", "is_listed"],
          false
        );

        const isLocallyUsed = locallyUsedCoupons.has(couponAddress);
        const isLocallyListed = locallyListedCoupons.has(couponAddress);
        const effectiveIsListed = isListed || isLocallyListed;
        const effectiveIsUsed = isUsedOnChain || isLocallyUsed || effectiveIsListed;

        const isExpired =
          !!expirationTimestamp &&
          expirationTimestamp > 0 &&
          expirationTimestamp < nowSeconds;

        // Skip coupons that are listed for sale (owner loses access while listed).
        if (effectiveIsListed) {
          continue;
        }

        // If it's used (on-chain or locally) or expired, we still return it,
        // but the frontend can decide to hide or just show as disabled.
        coupons.push({
          address: couponAddress,
          campaign: campaignPk,
          recipient: recipientPk,
          discount_bps: discountBps,
          max_discount_lamports: maxDiscountLamports,
          expiration_timestamp: expirationTimestamp,
          category_code: categoryCode,
          product_code: productCode,
          is_used: effectiveIsUsed || isExpired,
          is_listed: effectiveIsListed,
        });
      } catch (_e) {
        continue;
      }
    }

    console.log(
      `[api/coupons] Returning ${coupons.length} coupon(s) for wallet ${targetBase58}.`
    );

    res.json({ coupons });
  } catch (err) {
    console.error("[api/coupons error]", err);
    res.status(500).json({
      error: "Failed to list coupons for this wallet",
      details: err?.message || String(err),
    });
  }
});

/**
 * POST /api/mark-coupon-used
 *
 * Body:
 * {
 *   couponAddress: string
 * }
 *
 * Marks a coupon as used in local server memory.
 * This does not update on-chain state yet, but it allows the UI
 * to immediately stop offering that coupon after a successful payment.
 */
app.post("/api/mark-coupon-used", async (req, res) => {
  const { couponAddress } = req.body || {};

  if (!couponAddress) {
    return res.status(400).json({
      error: "couponAddress is required in request body.",
    });
  }

  try {
    // Validate that this is a valid Solana public key
    const pubkey = new PublicKey(couponAddress);
    const normalized = pubkey.toBase58();

    locallyUsedCoupons.add(normalized);

    console.log("[mark-coupon-used] Marked coupon as used (local only):", {
      couponAddress: normalized,
    });

    return res.json({
      success: true,
      couponAddress: normalized,
    });
  } catch (e) {
    console.error("[mark-coupon-used] Invalid couponAddress:", e);
    return res.status(400).json({
      error: "Invalid couponAddress",
      details: e.message || String(e),
    });
  }
});


// -----------------------------------------------------------------------------
// On-chain: create campaign based on AI proposal (or fallback demo values)
// -----------------------------------------------------------------------------

app.post("/api/create-campaign", async (req, res) => {
  const { walletAddress, proposal, shopper_context } = req.body || {};

  console.log("[create-campaign] Raw request body:", {
    walletAddress,
    hasProposal: !!proposal,
    hasShopperContext: !!shopper_context,
  });

  try {
    if (!PROGRAM_IDL || !CODER) {
      throw new Error(
        "IDL not loaded or coder not initialized. Run `anchor build` and check PROMO_IDL_PATH."
      );
    }

    const merchant = loadMerchantKeypair();

    console.log("[create-campaign] Requested by customer wallet:", walletAddress);
    console.log(
      "[create-campaign] Using PROGRAM_ID:",
      PROGRAM_ID.toBase58()
    );

    const connection = sharedConnection;

    try {
      await ensureAccountFunded(connection, merchant.publicKey, 100_000_000); // 0.1 SOL
    } catch (fundErr) {
      console.warn(
        "[create-campaign] Warning: ensureAccountFunded failed, continuing anyway. Reason:",
        fundErr.message || String(fundErr)
      );
      console.warn(
        "[create-campaign] Make sure merchant wallet is funded on devnet:",
        merchant.publicKey.toBase58()
      );
    }

    const configPda = await ensureGlobalConfig(connection, merchant);
    const configAccount = await fetchGlobalConfigAccount(connection);
    if (!configAccount) {
      throw new Error(
        "GlobalConfig account not found after initialization. Cannot create campaign."
      );
    }
    const nowSeconds = Math.floor(Date.now() / 1000);

    const hasProposal = proposal && typeof proposal === "object";
    if (hasProposal) {
      console.log("[create-campaign] Using AI proposal from request body.");
    } else {
      console.log(
        "[create-campaign] No proposal provided, falling back to static demo parameters."
      );
    }

    const discountBps = hasProposal
      ? getFirstNumeric(proposal, ["discount_bps", "discountBps"], 2500)
      : 2500;

    const serviceFeeBps =
      configAccount.serviceFeeBps ?? DEFAULT_SERVICE_FEE_BPS;

    let resaleBps = hasProposal
      ? getFirstNumeric(proposal, ["resale_bps", "resaleBps"], 5000)
      : 5000;
    const maxResaleCap =
      configAccount.maxResaleBps ?? DEFAULT_MAX_RESALE_BPS;
    if (resaleBps > maxResaleCap) {
      console.warn(
        "[create-campaign] Requested resale_bps exceeds global cap. Clamping.",
        { requested: resaleBps, maxAllowed: maxResaleCap }
      );
      resaleBps = maxResaleCap;
    }

    let expirationSeconds = hasProposal
      ? getFirstNumeric(
          proposal,
          ["expiration_timestamp", "expirationTimestamp"],
          nowSeconds + 7 * 24 * 60 * 60
        )
      : nowSeconds + 7 * 24 * 60 * 60;

    if (expirationSeconds <= nowSeconds) {
      console.log(
        "[create-campaign] AI proposal expiration is in the past. Overriding to now + 7 days.",
        { expirationSeconds, nowSeconds }
      );
      expirationSeconds = nowSeconds + 7 * 24 * 60 * 60;
    }
    const expirationTimestamp = new anchor.BN(expirationSeconds);

    const totalCoupons = hasProposal
      ? getFirstNumeric(proposal, ["total_coupons", "totalCoupons"], 100)
      : 100;

    let maxDiscountLamportsNum = hasProposal
      ? getFirstNumeric(
          proposal,
          ["max_discount_lamports", "maxDiscountLamports"],
          10_000_000
        )
      : 10_000_000;
    if (maxDiscountLamportsNum <= 0) {
      console.warn(
        "[create-campaign] Proposal max_discount_lamports <= 0, resetting to 10_000_000 lamports."
      );
      maxDiscountLamportsNum = 10_000_000;
    }

    let mintCostLamportsNum = hasProposal
      ? getFirstNumeric(
          proposal,
          ["mint_cost_lamports", "mintCostLamports"],
          1_000_000
        )
      : 1_000_000;

    if (mintCostLamportsNum <= 0) {
      console.warn(
        "[create-campaign] Proposal mint_cost_lamports <= 0, resetting to 1_000_000 lamports."
      );
      mintCostLamportsNum = 1_000_000;
    }

    if (mintCostLamportsNum > maxDiscountLamportsNum) {
      console.warn(
        "[create-campaign] Proposal mint_cost_lamports > max_discount_lamports, clamping to maxDiscountLamports."
      );
      mintCostLamportsNum = Math.max(1, maxDiscountLamportsNum);
    }

    const mintCostLamports = new anchor.BN(mintCostLamportsNum);
    const maxDiscountLamports = new anchor.BN(maxDiscountLamportsNum);

    let categoryCode = hasProposal
      ? getFirstNumeric(proposal, ["category_code", "categoryCode"], 1)
      : 1;

    let productCode = hasProposal
      ? getFirstNumeric(proposal, ["product_code", "productCode"], 1)
      : 1;

    if (
      shopper_context &&
      typeof shopper_context.productId === "string" &&
      shopper_context.productId.length > 0
    ) {
      const rawId = shopper_context.productId;
      const productIdNum = Number(rawId);
      if (!Number.isNaN(productIdNum) && productIdNum > 0) {
        const mappedCategoryCode = 1;
        const mappedProductCode = productIdNum;

        categoryCode = mappedCategoryCode;
        productCode = mappedProductCode;

        console.log(
          "[create-campaign] Overriding product codes from shopper_context.productId:",
          {
            productId: rawId,
            mappedCategoryCode,
            mappedProductCode,
          }
        );
      }
    }

    const campaignName =
      (hasProposal &&
        (proposal.campaignName ||
          proposal.campaign_name ||
          proposal.name)) ||
      "AI Demo Campaign";

    const requiresWallet = hasProposal
      ? !!(proposal.requires_wallet ?? proposal.requiresWallet ?? false)
      : false;

    let targetWalletPubkey = merchant.publicKey;

    const rawTargetWallet =
      (hasProposal &&
        (proposal.target_wallet ||
          proposal.targetWallet ||
          null)) ||
      (shopper_context &&
      typeof shopper_context.walletAddress === "string" &&
      shopper_context.walletAddress.length > 0
        ? shopper_context.walletAddress
        : null) ||
      (walletAddress && typeof walletAddress === "string"
        ? walletAddress
        : null);

    if (rawTargetWallet && typeof rawTargetWallet === "string") {
      try {
        targetWalletPubkey = new PublicKey(rawTargetWallet);
      } catch (e) {
        console.warn(
          "[create-campaign] Invalid target wallet provided, falling back to merchant public key:",
          rawTargetWallet,
          "- reason:",
          e.message || String(e)
        );
      }
    }

    console.log("[create-campaign] Resolved target wallet pubkey:", {
      targetWallet: targetWalletPubkey.toBase58(),
    });

    let productPriceSol = null;
    if (
      shopper_context &&
      typeof shopper_context.productPriceSol === "number" &&
      shopper_context.productPriceSol > 0
    ) {
      productPriceSol = shopper_context.productPriceSol;
    } else if (
      productCode &&
      PRODUCT_CODE_PRICE_SOL[productCode] &&
      typeof PRODUCT_CODE_PRICE_SOL[productCode] === "number"
    ) {
      productPriceSol = PRODUCT_CODE_PRICE_SOL[productCode];
    }

    if (productPriceSol && discountBps > 0) {
      const discountSol = productPriceSol * (discountBps / 10_000);
      const computedMaxDiscountLamports = Math.round(
        discountSol * LAMPORTS_PER_SOL
      );
      if (computedMaxDiscountLamports > 0) {
        maxDiscountLamportsNum = computedMaxDiscountLamports;
      }
    }

    const serviceFeeRate =
      serviceFeeBps && serviceFeeBps > 0 ? serviceFeeBps / 10_000 : 0;
    const feeLamportsPerCoupon = Math.floor(
      maxDiscountLamportsNum * serviceFeeRate
    );
    const perCouponVaultRequirement =
      mintCostLamportsNum + feeLamportsPerCoupon;
    let depositAmountLamportsNum =
      perCouponVaultRequirement * Number(totalCoupons || 0);

    if (depositAmountLamportsNum <= 0) {
      console.warn(
        "[create-campaign] Computed deposit amount is non-positive. Falling back to mint+fee coverage.",
        {
          perCouponVaultRequirement,
          totalCoupons,
        }
      );
      depositAmountLamportsNum = perCouponVaultRequirement || mintCostLamportsNum;
    }

    if (MIN_VAULT_RESERVE_LAMPORTS > 0) {
      depositAmountLamportsNum += MIN_VAULT_RESERVE_LAMPORTS;
    }

    const depositAmount = new anchor.BN(depositAmountLamportsNum);

    const campaignId = new anchor.BN(nowSeconds);

    const [campaignPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        merchant.publicKey.toBuffer(),
        campaignId.toArrayLike(Buffer, "le", 8),
      ],
      PROGRAM_ID
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), campaignPda.toBuffer()],
      PROGRAM_ID
    );

    console.log("[create-campaign] Final numeric params:", {
      discountBps,
      serviceFeeBps,
      resaleBps,
      expirationSeconds,
      totalCoupons,
      mintCostLamportsNum,
      maxDiscountLamportsNum,
      depositAmountLamportsNum,
      categoryCode,
      productCode,
      requiresWallet,
      campaignName,
    });

    console.log("[create-campaign] Using PDAs:", {
      config: configPda.toBase58(),
      campaign: campaignPda.toBase58(),
      vault: vaultPda.toBase58(),
    });

    const signature = await sendCreateCampaignTx(connection, merchant, {
      configPda,
      campaignPda,
      vaultPda,
      campaignId,
      discountBps,
      resaleBps,
      expirationTimestamp,
      totalCoupons,
      mintCostLamports,
      maxDiscountLamports,
      categoryCode,
      productCode,
      campaignName,
      depositAmount,
      requiresWallet,
      targetWalletPubkey,
    });

    console.log("[create-campaign] On-chain tx signature:", signature);

    res.json({
      success: true,
      message: "Your campaign has been created on Solana devnet.",
      merchantAddress: merchant.publicKey.toBase58(),
      campaignPda: campaignPda.toBase58(),
      vaultPda: vaultPda.toBase58(),
      signature,
      configPda: configPda.toBase58(),
    });
  } catch (err) {
    console.error("[create-campaign error]", err);
    res.status(500).json({
      error: "Failed to create on-chain campaign",
      details:
        err.message ||
        String(err) ||
        "Unknown error while creating on-chain campaign",
    });
  }
});

// -----------------------------------------------------------------------------
// On-chain: mint a coupon for a given campaign + recipient wallet
// -----------------------------------------------------------------------------

app.post("/api/mint-coupon", async (req, res) => {
  const { campaignAddress, customerWallet } = req.body || {};

  console.log("[mint-coupon] Incoming request:", {
    campaignAddress,
    customerWallet,
  });

  try {
    if (!PROGRAM_IDL || !CODER) {
      throw new Error(
        "IDL not loaded or coder not initialized. Run `anchor build` and check PROMO_IDL_PATH."
      );
    }

    if (!campaignAddress || !customerWallet) {
      return res.status(400).json({
        error: "Missing campaignAddress or customerWallet in request body.",
      });
    }

    let campaignPda;
    let recipientPubkey;
    try {
      campaignPda = new PublicKey(campaignAddress);
    } catch (e) {
      return res.status(400).json({
        error: "Invalid campaignAddress",
        details: e.message || String(e),
      });
    }

    try {
      recipientPubkey = new PublicKey(customerWallet);
    } catch (e) {
      return res.status(400).json({
        error: "Invalid customerWallet",
        details: e.message || String(e),
      });
    }

    const merchant = loadMerchantKeypair();
    const connection = sharedConnection;

    try {
      await ensureAccountFunded(connection, merchant.publicKey, 50_000_000); // ~0.05 SOL
    } catch (fundErr) {
      console.warn(
        "[mint-coupon] Warning: ensureAccountFunded failed, continuing anyway. Reason:",
        fundErr.message || String(fundErr)
      );
      console.warn(
        "[mint-coupon] Make sure merchant wallet is funded on devnet:",
        merchant.publicKey.toBase58()
      );
    }

    const campaignDef = findAccount(["campaign"]);
    if (!campaignDef) {
      throw new Error(
        `Could not find 'campaign' account in IDL. Available accounts: ${
          PROGRAM_IDL.accounts
            ? PROGRAM_IDL.accounts.map((a) => a.name).join(", ")
            : "none"
        }`
      );
    }

    const campaignInfo = await rpcWithBackoff(
      `getAccountInfo(campaign:${campaignPda.toBase58()})`,
      () => connection.getAccountInfo(campaignPda)
    );

    if (!campaignInfo) {
      return res.status(404).json({
        error: "Campaign account not found on-chain.",
      });
    }

    const decodedCampaign = CODER.accounts.decode(
      campaignDef.name,
      campaignInfo.data
    );

    const campaignIdNum = getFirstNumeric(
      decodedCampaign,
      ["campaign_id", "campaignId"],
      0
    );
    const mintedCouponsNum = getFirstNumeric(
      decodedCampaign,
      ["minted_coupons", "mintedCoupons"],
      0
    );
    const totalCouponsNum = getFirstNumeric(
      decodedCampaign,
      ["total_coupons", "totalCoupons"],
      0
    );

    if (
      Number.isNaN(campaignIdNum) ||
      Number.isNaN(mintedCouponsNum) ||
      Number.isNaN(totalCouponsNum)
    ) {
      return res.status(500).json({
        error:
          "Failed to read campaign_id / minted_coupons / total_coupons from campaign account.",
      });
    }

    console.log("[mint-coupon] Decoded campaign numeric fields:", {
      campaignIdNum,
      mintedCouponsNum,
      totalCouponsNum,
    });

    if (mintedCouponsNum >= totalCouponsNum) {
      return res.status(400).json({
        error:
          "No coupons left in this campaign (minted_coupons >= total_coupons).",
      });
    }

    // Prevent wallets from receiving more than one coupon per campaign.
    const existingCoupons = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        {
          memcmp: {
            offset: 8, // discriminator
            bytes: campaignPda.toBase58(),
          },
        },
        {
          memcmp: {
            offset: 8 + 32 + 8, // discriminator + campaign + coupon_index
            bytes: recipientPubkey.toBase58(),
          },
        },
      ],
    });

    if (existingCoupons.length > 0) {
      return res.status(400).json({
        error:
          "This wallet already has a coupon for this campaign. Secondary wallets must buy from the marketplace.",
      });
    }

    const campaignIdBn = new anchor.BN(campaignIdNum);
    const couponIndexBn = new anchor.BN(mintedCouponsNum);

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), campaignPda.toBuffer()],
      PROGRAM_ID
    );

    const [couponPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("coupon"),
        campaignPda.toBuffer(),
        couponIndexBn.toArrayLike(Buffer, "le", 8),
      ],
      PROGRAM_ID
    );

    const platformTreasuryPubkey = await resolvePlatformTreasuryPubkey(
      connection,
      merchant.publicKey,
      "[mint-coupon]"
    );

    console.log("[mint-coupon] Using PDAs and accounts:", {
      campaign: campaignPda.toBase58(),
      vault: vaultPda.toBase58(),
      coupon: couponPda.toBase58(),
      merchant: merchant.publicKey.toBase58(),
      recipient: recipientPubkey.toBase58(),
      platformTreasury: platformTreasuryPubkey.toBase58(),
      campaignId: campaignIdBn.toString(),
      couponIndex: couponIndexBn.toString(),
    });

    let signature;
    try {
      signature = await sendMintCouponTx(connection, merchant, {
        campaignPda,
        vaultPda,
        couponPda,
        recipientPubkey,
        platformTreasuryPubkey,
        campaignIdBn,
        couponIndexBn,
      });
    } catch (err) {
      console.error("[mint-coupon error]", err);
      if (err && err.transactionLogs) {
        console.error("[mint-coupon logs]", err.transactionLogs);
      }
      throw err;
    }

    console.log("[mint-coupon] On-chain tx signature:", signature);
    console.log("[mint-coupon] Coupon minted for recipient:", {
      recipient: recipientPubkey.toBase58(),
      couponPda: couponPda.toBase58(),
    });

    res.json({
      success: true,
      message: "Coupon minted successfully on devnet.",
      merchantAddress: merchant.publicKey.toBase58(),
      customerWallet: recipientPubkey.toBase58(),
      campaignAddress: campaignPda.toBase58(),
      couponAddress: couponPda.toBase58(),
      signature,
      rpcUrl: SOLANA_RPC_URL,
      campaignId: campaignIdBn.toString(),
      couponIndex: couponIndexBn.toString(),
    });
  } catch (err) {
    console.error("[mint-coupon error]", err);
    res.status(500).json({
      error: "Failed to mint coupon",
      details:
        err.message ||
        String(err) ||
        "Unknown error while minting coupon on-chain",
    });
  }
});

// -----------------------------------------------------------------------------
// On-chain: abandoned-cart campaign + single coupon (10% off, same-day expiry)
// -----------------------------------------------------------------------------

/**
 * POST /api/abandoned-cart-coupon
 *
 * Body:
 * {
 *   walletAddress: string, // shopper wallet that abandoned the cart
 *   productId: string,     // product ID from frontend (for naming only)
 *   productCode: number,   // numeric product_code (used on-chain)
 *   discountBps?: number   // optional, default 1000 (10%)
 * }
 *
 * This endpoint:
 *  - creates a tiny campaign targeted to this wallet & product
 *  - expiration = end of current UTC day
 *  - total_coupons = 1
 *  - mints a single coupon to walletAddress
 *  - returns the coupon payload used by the frontend
 */
app.post("/api/abandoned-cart-coupon", async (req, res) => {
  const { walletAddress, productId, productCode, discountBps } = req.body || {};

  console.log("[abandoned-cart-coupon] Incoming request:", {
    walletAddress,
    productId,
    productCode,
    discountBps,
  });

  try {
    if (!PROGRAM_IDL || !CODER) {
      throw new Error(
        "IDL not loaded or coder not initialized. Run `anchor build` and check PROMO_IDL_PATH."
      );
    }

    if (!walletAddress || typeof productCode !== "number" || productCode <= 0) {
      return res.status(400).json({
        error:
          "walletAddress and a positive numeric productCode are required in request body.",
      });
    }

    let targetWalletPubkey;
    try {
      targetWalletPubkey = new PublicKey(walletAddress);
    } catch (e) {
      return res.status(400).json({
        error: "Invalid walletAddress",
        details: e.message || String(e),
      });
    }

    const merchant = loadMerchantKeypair();
    const connection = sharedConnection;

    try {
      await ensureAccountFunded(connection, merchant.publicKey, 150_000_000); // ~0.15 SOL
    } catch (fundErr) {
      console.warn(
        "[abandoned-cart-coupon] Warning: ensureAccountFunded failed, continuing anyway. Reason:",
        fundErr.message || String(fundErr)
      );
      console.warn(
        "[abandoned-cart-coupon] Make sure merchant wallet is funded on devnet:",
        merchant.publicKey.toBase58()
      );
    }

    const configPda = await ensureGlobalConfig(connection, merchant);

    // --- Campaign parameters for abandoned-cart ---
    const nowSeconds = Math.floor(Date.now() / 1000);

    // Expiration: end of current UTC day (23:59:59)
    const nowDate = new Date();
    const endOfDay = new Date(
      Date.UTC(
        nowDate.getUTCFullYear(),
        nowDate.getUTCMonth(),
        nowDate.getUTCDate(),
        23,
        59,
        59
      )
    );
    const expirationSeconds = Math.floor(endOfDay.getTime() / 1000);

    const finalExpirationSeconds =
      expirationSeconds > nowSeconds
        ? expirationSeconds
        : nowSeconds + 60 * 60; // fallback: +1h if something weird happens

    const expirationTimestamp = new anchor.BN(finalExpirationSeconds);

    const finalDiscountBps =
      typeof discountBps === "number" && discountBps > 0
        ? discountBps
        : 1000; // 10%

    const serviceFeeBps =
      configAccount.serviceFeeBps ?? DEFAULT_SERVICE_FEE_BPS;
    const resaleBps = 0; // abandoned-cart coupons not meant for resale in this demo

    const totalCoupons = 1;

    // For demo: allow up to 0.1 SOL discount on this single coupon
    const maxDiscountLamportsNum = 100_000_000; // 0.1 SOL
    const mintCostLamportsNum = 1_000_000; // 0.001 SOL
    const depositAmountLamportsNum = maxDiscountLamportsNum * totalCoupons;

    const mintCostLamports = new anchor.BN(mintCostLamportsNum);
    const maxDiscountLamports = new anchor.BN(maxDiscountLamportsNum);
    const depositAmount = new anchor.BN(depositAmountLamportsNum);

    const categoryCode = 1; // simple "e-commerce" category for MVP

    const campaignName = `Abandoned Cart - Product ${
      productId || String(productCode)
    }`;

    const requiresWallet = true;

    const campaignId = new anchor.BN(nowSeconds);

    const [campaignPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        merchant.publicKey.toBuffer(),
        campaignId.toArrayLike(Buffer, "le", 8),
      ],
      PROGRAM_ID
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), campaignPda.toBuffer()],
      PROGRAM_ID
    );

    console.log("[abandoned-cart-coupon] Creating on-chain campaign with:", {
      campaignName,
      discountBps: finalDiscountBps,
      serviceFeeBps,
      resaleBps,
      finalExpirationSeconds,
      totalCoupons,
      mintCostLamportsNum,
      maxDiscountLamportsNum,
      depositAmountLamportsNum,
      categoryCode,
      productCode,
      requiresWallet,
      targetWallet: targetWalletPubkey.toBase58(),
      configPda: configPda.toBase58(),
      campaignPda: campaignPda.toBase58(),
      vaultPda: vaultPda.toBase58(),
    });

    // --- 1) Create campaign on-chain ---
    const createSig = await sendCreateCampaignTx(connection, merchant, {
      configPda,
      campaignPda,
      vaultPda,
      campaignId,
      discountBps: finalDiscountBps,
      resaleBps,
      expirationTimestamp,
      totalCoupons,
      mintCostLamports,
      maxDiscountLamports,
      categoryCode,
      productCode,
      campaignName,
      depositAmount,
      requiresWallet,
      targetWalletPubkey,
    });

    console.log(
      "[abandoned-cart-coupon] Campaign created on-chain. tx:",
      createSig
    );

    // --- 2) Mint a single coupon (index = 0) to this wallet ---
    const campaignIdBn = campaignId;
    const couponIndexBn = new anchor.BN(0);

    const [couponPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("coupon"),
        campaignPda.toBuffer(),
        couponIndexBn.toArrayLike(Buffer, "le", 8),
      ],
      PROGRAM_ID
    );

    const platformTreasuryPubkey = await resolvePlatformTreasuryPubkey(
      connection,
      merchant.publicKey,
      "[abandoned-cart-coupon]"
    );

    console.log("[abandoned-cart-coupon] Minting coupon with:", {
      campaign: campaignPda.toBase58(),
      vault: vaultPda.toBase58(),
      coupon: couponPda.toBase58(),
      recipient: targetWalletPubkey.toBase58(),
      campaignId: campaignIdBn.toString(),
      couponIndex: couponIndexBn.toString(),
      platformTreasury: platformTreasuryPubkey.toBase58(),
    });

    const mintSig = await sendMintCouponTx(connection, merchant, {
      campaignPda,
      vaultPda,
      couponPda,
      recipientPubkey: targetWalletPubkey,
      platformTreasuryPubkey,
      campaignIdBn,
      couponIndexBn,
    });

    console.log(
      "[abandoned-cart-coupon] Coupon minted on-chain. tx:",
      mintSig
    );

    // --- 3) Return a Coupon-like object for the frontend ---
    const couponPayload = {
      address: couponPda.toBase58(),
      campaign: campaignPda.toBase58(),
      recipient: targetWalletPubkey.toBase58(),
      discount_bps: finalDiscountBps,
      max_discount_lamports: maxDiscountLamportsNum,
      expiration_timestamp: finalExpirationSeconds,
      category_code: categoryCode,
      product_code: productCode,
      is_used: false,
    };

    return res.json({
      success: true,
      message:
        "Abandoned-cart campaign created and coupon minted successfully on devnet.",
      campaign: {
        address: campaignPda.toBase58(),
        configPda: configPda.toBase58(),
        vaultPda: vaultPda.toBase58(),
        txSignature: createSig,
      },
      coupon: couponPayload,
      mintSignature: mintSig,
      rpcUrl: SOLANA_RPC_URL,
    });
  } catch (err) {
    console.error("[abandoned-cart-coupon error]", err);
    return res.status(500).json({
      error: "Failed to create abandoned-cart campaign and coupon",
      details:
        err?.message ||
        String(err) ||
        "Unknown error while creating abandoned-cart coupon",
    });
  }
});

// -----------------------------------------------------------------------------
// On-chain: redeem (apply) a coupon and mark it as used (unusable afterwards)
// -----------------------------------------------------------------------------

/**
 * POST /api/redeem-coupon
 *
 * Body:
 * {
 *   couponAddress: string,          // coupon PDA address
 *   userWallet: string,             // wallet that owns the coupon and will sign the tx
 *   purchaseAmountLamports: number  // purchase amount in lamports
 * }
 *
 * The endpoint:
 *  - loads the coupon account
 *  - checks that `userWallet` is the current owner
 *  - checks that the coupon is NOT used and NOT listed
 *  - finds the associated campaign and derives the vault PDA
 *  - builds a redeem_coupon instruction using the IDL/BorshCoder
 *  - returns an unsigned transaction (base64) for the frontend to sign
 *
 * IMPORTANT:
 *  - The actual "burn" / invalidation is done by the program:
 *      * on-chain `redeem_coupon` sets `coupon.used = true`
 *      * your dapp should treat `used = true` as "burned/unusable"
 */
app.post("/api/redeem-coupon", async (req, res) => {
  const { couponAddress, userWallet, purchaseAmountLamports } = req.body || {};

  console.log("[redeem-coupon] Incoming request:", {
    couponAddress,
    userWallet,
    purchaseAmountLamports,
  });

  try {
    if (!PROGRAM_IDL || !CODER) {
      throw new Error(
        "IDL not loaded or coder not initialized. Run `anchor build` and check PROMO_IDL_PATH."
      );
    }

    if (!couponAddress || !userWallet || !purchaseAmountLamports) {
      return res.status(400).json({
        error: "Missing couponAddress, userWallet or purchaseAmountLamports in request body.",
      });
    }

    let couponPk;
    let userPubkey;
    try {
      couponPk = new PublicKey(couponAddress);
    } catch (e) {
      return res.status(400).json({
        error: "Invalid couponAddress",
        details: e.message || String(e),
      });
    }

    try {
      userPubkey = new PublicKey(userWallet);
    } catch (e) {
      return res.status(400).json({
        error: "Invalid userWallet",
        details: e.message || String(e),
      });
    }

    const connection = sharedConnection;

    // ----- Load and decode the Coupon account -----
    const couponDef = findAccount(["coupon"]);
    if (!couponDef) {
      throw new Error(
        `Could not find 'coupon' account in IDL. Available accounts: ${
          PROGRAM_IDL.accounts
            ? PROGRAM_IDL.accounts.map((a) => a.name).join(", ")
            : "none"
        }`
      );
    }

    const couponInfo = await rpcWithBackoff(
      `getAccountInfo(coupon:${couponPk.toBase58()})`,
      () => connection.getAccountInfo(couponPk)
    );

    if (!couponInfo) {
      return res.status(404).json({
        error: "Coupon account not found on-chain.",
      });
    }

    const decodedCoupon = CODER.accounts.decode(
      couponDef.name,
      couponInfo.data
    );

    // Helper to safely pick a boolean field
    const pickBool = (obj, keys, fallback = false) => {
      if (!obj) return fallback;
      for (const k of keys) {
        const v = obj[k];
        if (typeof v === "boolean") {
          return v;
        }
      }
      return fallback;
    };

    // Extract owner and campaign from the coupon account
    let ownerPk = null;
    let campaignPk = null;

    if (
      decodedCoupon.owner &&
      typeof decodedCoupon.owner.toBase58 === "function"
    ) {
      ownerPk = decodedCoupon.owner.toBase58();
    }

    if (
      decodedCoupon.campaign &&
      typeof decodedCoupon.campaign.toBase58 === "function"
    ) {
      campaignPk = decodedCoupon.campaign.toBase58();
    } else {
      // Fallback: try to find any pubkey field that looks like "campaign"
      const pkFields = Object.entries(decodedCoupon)
        .filter(([, value]) => value && typeof value.toBase58 === "function")
        .map(([key, value]) => ({ key, value, base58: value.toBase58() }));

      const campaignField = pkFields.find((f) =>
        /campaign/i.test(f.key)
      );
      if (campaignField) {
        campaignPk = campaignField.base58;
      }
    }

    if (!ownerPk) {
      return res.status(500).json({
        error: "Failed to read coupon owner from on-chain account.",
      });
    }

    if (!campaignPk) {
      return res.status(500).json({
        error: "Failed to read coupon campaign from on-chain account.",
      });
    }

    // Check that the provided wallet is indeed the current owner
    if (ownerPk !== userPubkey.toBase58()) {
      return res.status(400).json({
        error: "This wallet is not the owner of the coupon.",
        details: {
          onChainOwner: ownerPk,
          providedWallet: userPubkey.toBase58(),
        },
      });
    }

    // Check if coupon is already used or listed
    const isUsed = pickBool(decodedCoupon, ["used", "is_used", "redeemed"], false);
    const isListed = pickBool(decodedCoupon, ["listed", "is_listed"], false);

    if (isUsed) {
      return res.status(400).json({
        error: "Coupon is already used (unusable).",
      });
    }

    if (isListed) {
      return res.status(400).json({
        error: "Coupon is currently listed for sale and cannot be redeemed.",
      });
    }

    // ----- Load campaign to enforce basic sanity checks (optional) -----
    const campaignDef = findAccount(["campaign"]);
    if (!campaignDef) {
      throw new Error(
        `Could not find 'campaign' account in IDL. Available accounts: ${
          PROGRAM_IDL.accounts
            ? PROGRAM_IDL.accounts.map((a) => a.name).join(", ")
            : "none"
        }`
      );
    }

    const campaignPubkey = new PublicKey(campaignPk);
    const campaignInfo = await rpcWithBackoff(
      `getAccountInfo(campaign:${campaignPk})`,
      () => connection.getAccountInfo(campaignPubkey)
    );

    if (!campaignInfo) {
      return res.status(404).json({
        error: "Campaign account not found on-chain for this coupon.",
      });
    }

    const decodedCampaign = CODER.accounts.decode(
      campaignDef.name,
      campaignInfo.data
    );

    // Optional: you could read discount_bps, expiration_timestamp, etc.
    // and do extra validations here. The on-chain program will enforce
    // core rules anyway (expiration, vault balance, etc.).

    // ----- Derive Vault PDA for this campaign -----
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), campaignPubkey.toBuffer()],
      PROGRAM_ID
    );

    const merchant = loadMerchantKeypair();
    const platformTreasuryPubkey = await resolvePlatformTreasuryPubkey(
      connection,
      merchant.publicKey,
      "[redeem-coupon]"
    );

    // ----- Build redeem_coupon instruction from IDL -----
    const redeemIxDef = findInstruction(["redeem", "coupon"]);
    if (!redeemIxDef) {
      throw new Error(
        `Could not find redeem_coupon-like instruction in IDL. Available instructions: ${
          PROGRAM_IDL.instructions
            ? PROGRAM_IDL.instructions.map((ix) => ix.name).join(", ")
            : "none"
        }`
      );
    }

    console.log(
      "[redeem-coupon] Using IDL instruction name:",
      redeemIxDef.name,
      "args:",
      Array.isArray(redeemIxDef.args)
        ? redeemIxDef.args.map((a) => a.name)
        : []
    );

    const purchaseAmountBn = new anchor.BN(purchaseAmountLamports);

    const valuesMap = {
      purchase_amount: purchaseAmountBn,
      purchaseAmount: purchaseAmountBn,
    };

    const encodedArgs = buildArgsFromIdl(redeemIxDef.args || [], valuesMap);
    const data = CODER.instruction.encode(redeemIxDef.name, encodedArgs);

    // Accounts MUST follow the same order as in the IDL:
    //  campaign, vault, coupon, user, platform_treasury, system_program
    const keys = [
      {
        pubkey: campaignPubkey,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: vaultPda,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: couponPk,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: userPubkey,
        isSigner: true,  // user must sign this tx on the frontend
        isWritable: true,
      },
      {
        pubkey: platformTreasuryPubkey,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
    ];

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data,
    });

    const tx = new Transaction().add(ix);

    // Set fee payer and blockhash. The user will sign this transaction client-side.
    const latestBlockhash = await rpcWithBackoff(
      "getLatestBlockhash(redeem-coupon)",
      () => connection.getLatestBlockhash("finalized")
    );

    tx.feePayer = userPubkey;
    tx.recentBlockhash = latestBlockhash.blockhash;

    // Serialize without requiring all signatures (no signatures added server-side).
    const serialized = tx.serialize({
      requireAllSignatures: false,
    });

    const transactionBase64 = serialized.toString("base64");

    console.log("[redeem-coupon] Built unsigned transaction for coupon:", {
      coupon: couponPk.toBase58(),
      campaign: campaignPubkey.toBase58(),
      vault: vaultPda.toBase58(),
      user: userPubkey.toBase58(),
      platformTreasury: platformTreasuryPubkey.toBase58(),
      purchaseAmountLamports,
    });

    return res.json({
      success: true,
      message:
        "Unsigned redeem_coupon transaction created. Sign and send it with the user wallet.",
      transactionBase64,
      couponAddress: couponPk.toBase58(),
      campaignAddress: campaignPubkey.toBase58(),
      vaultAddress: vaultPda.toBase58(),
      userWallet: userPubkey.toBase58(),
      purchaseAmountLamports,
      latestBlockhash,
    });
  } catch (err) {
    console.error("[redeem-coupon error]", err);
    return res.status(500).json({
      error: "Failed to build redeem_coupon transaction",
      details:
        err?.message ||
        String(err) ||
        "Unknown error while building redeem_coupon tx",
    });
  }
});


// -----------------------------------------------------------------------------
// Solana Pay: in-memory sessions + status (Transfer + Transaction Request)
// -----------------------------------------------------------------------------

const solanaPaySessions = new Map();

/**
 * Base URL used inside Solana Pay transaction requests.
 * For local dev we default to http://localhost:<PORT>
 * In production you should set PUBLIC_SOLANA_PAY_BASE_URL to your HTTPS domain.
 */
const PUBLIC_SOLANA_PAY_BASE_URL =
  process.env.PUBLIC_SOLANA_PAY_BASE_URL || `https://localhost:${PORT}`;


async function getBalanceWithRetries(pubkey) {
  return rpcWithBackoff(`getBalance(${pubkey.toBase58()})`, () =>
    sharedConnection.getBalance(pubkey)
  );
}

/**
 * POST /api/solana-pay/create-session
 *
 * Body:
 * {
 *   amountSol: number,
 *   payerWallet?: string,
 *   orderItems?: Array<...>,
 *   couponAddress?: string | null,
 *   mode?: "transfer-request" | "transaction-request"
 * }
 *
 * - "transfer-request" (default) => classic Solana Pay transfer URI
 * - "transaction-request"        => solana:<URL-ENCODED-HTTPS-URL> (wallet calls our /tx-request)
 */
app.post("/api/solana-pay/create-session", async (req, res) => {
  const { amountSol, payerWallet, orderItems, couponAddress, mode } =
    req.body || {};

  console.log("[solana-pay/create-session] Incoming request:", {
    amountSol,
    payerWallet,
    hasOrderItems: Array.isArray(orderItems),
    couponAddress: couponAddress || null,
    mode: mode || "transfer-request",
  });

  try {
    if (!amountSol || amountSol <= 0) {
      return res.status(400).json({
        error: "Invalid or missing amountSol in request body.",
      });
    }

    // If a coupon is provided, validate:
    //  - ownership (belongs to payerWallet)
    //  - not used / not listed / not expired
    //  - matches at least one product in orderItems (product_code)
    if (couponAddress) {
      try {
        await validateCouponForOrder({
          couponAddress,
          payerWallet,
          orderItems,
        });

        console.log(
          "[solana-pay/create-session] Coupon validated successfully for this order."
        );
      } catch (e) {
        if (e instanceof CouponValidationError) {
          console.warn(
            "[solana-pay/create-session] Coupon validation failed:",
            e.message
          );
          return res.status(e.statusCode || 400).json({
            error: e.message,
          });
        }

        console.error(
          "[solana-pay/create-session] Unexpected error validating coupon:",
          e
        );
        return res.status(500).json({
          error: "Unexpected error validating coupon for this order.",
          details: e.message || String(e),
        });
      }
    }

    const merchant = loadMerchantKeypair();
    const recipient = merchant.publicKey;

    if (payerWallet) {
      try {
        const payerPk = new PublicKey(payerWallet);
        const balanceLamports = await getBalanceWithRetries(payerPk);
        console.log(
          "[solana-pay/create-session] Payer devnet balance:",
          payerPk.toBase58(),
          "=>",
          balanceLamports,
          "lamports (~",
          balanceLamports / LAMPORTS_PER_SOL,
          "SOL )"
        );
      } catch (e) {
        console.warn(
          "[solana-pay/create-session] Could not read payer balance:",
          e.message || String(e)
        );
      }
    }

    const referenceKeypair = Keypair.generate();
    const reference = referenceKeypair.publicKey;

    const sessionMode =
      mode === "transaction-request"
        ? "transaction-request"
        : "transfer-request";

    const session = {
      reference: reference.toBase58(),
      recipient: recipient.toBase58(),
      amountSol,
      payerWallet: payerWallet || null,
      couponAddress: couponAddress || null,
      createdAt: Date.now(),
      status: "pending",
      signature: null,
      lastError: null,
      paymentUrl: null,
      mode: sessionMode,
    };

    let paymentUrl;

    if (sessionMode === "transaction-request") {
      // Transaction Request flow (wallet will POST to /api/solana-pay/tx-request)
      const forwardedProto =
        typeof req.headers["x-forwarded-proto"] === "string"
          ? req.headers["x-forwarded-proto"]
          : null;
      const forwardedHost =
        typeof req.headers["x-forwarded-host"] === "string"
          ? req.headers["x-forwarded-host"]
          : null;

      let requestOrigin = null;
      if (forwardedProto && forwardedHost) {
        requestOrigin = `${forwardedProto}://${forwardedHost}`;
      } else if (typeof req.headers.origin === "string") {
        requestOrigin = req.headers.origin;
      }

      const baseUrl =
        process.env.SOLANA_PAY_BASE_URL ||
        requestOrigin ||
        `http://localhost:${PORT}`;

      const linkUrl = new URL("/api/solana-pay/tx-request", baseUrl);
      linkUrl.searchParams.set("reference", session.reference);
      if (SOLANA_CLUSTER) {
        linkUrl.searchParams.set("cluster", SOLANA_CLUSTER);
      }

      console.log("[solana-pay/create-session] Transaction Request link:", {
        link: linkUrl.toString(),
      });

      // For transaction requests, the URI must be:
      //   solana:<URL-ENCODED-HTTPS-URL>
      paymentUrl = `solana:${encodeURIComponent(linkUrl.toString())}`;
    } else {
      // Classic Solana Pay transfer-request (kept for completeness)
      const amount = new BigNumber(amountSol);

      const label = "Promo Targeting Demo Store";
      const message = "Order payment via Solana Pay";
      const memo = "promo-targeting-demo";

      const url = encodeURL({
        recipient,
        amount,
        reference,
        label,
        message,
        memo,
        cluster: SOLANA_CLUSTER,
      });

      paymentUrl = url.toString();
    }

    session.paymentUrl = paymentUrl;
    solanaPaySessions.set(session.reference, session);

    console.log("[solana-pay/create-session] New session created:", session);

    return res.json({
      url: paymentUrl,
      reference: session.reference,
      recipient: session.recipient,
      amountSol: session.amountSol,
      mode: session.mode,
    });
  } catch (err) {
    console.error("[solana-pay/create-session error]", err);
    res.status(500).json({
      error: "Failed to create Solana Pay session",
      details: err?.message || String(err),
    });
  }
});


// -----------------------------------------------------------------------------
// Solana Pay - Transaction Request endpoint (GET + POST)
// GET  -> wallet fetches provider metadata (label, icon)
// POST -> wallet sends { account } and expects { transaction, message }
// -----------------------------------------------------------------------------

/**
 * GET /api/solana-pay/tx-request
 *
 * Used by wallets to show the provider info (label, icon).
 * We DO NOT validate reference or anything here – just return metadata,
 * exactly like the QuickNode example.
 */
app.get("/api/solana-pay/tx-request", (req, res) => {
  console.log("[tx-request][GET] Solana Pay wallet metadata requested:", {
    query: req.query,
  });

  const label = "Promo Targeting Demo Store";
  const icon =
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Coffee_cup_icon.svg/512px-Coffee_cup_icon.svg.png";

  return res.status(200).json({ label, icon });
});

/**
 * POST /api/solana-pay/tx-request
 *
 * Query:
 *   reference: string  (required – identifies the payment session)
 *
 * Body:
 *   { account: string }  // payer wallet public key (base58)
 *
 * Response (what the wallet expects):
 *   { transaction: string, message: string }
 *
 * The transaction can include:
 *   - redeem_coupon (if session.couponAddress is set)
 *   - SystemProgram.transfer from payer -> merchant (with reference key)
 */

app.post("/api/solana-pay/tx-request", async (req, res) => {
  const query = req.query || {};
  const body = req.body || {};
  console.log("[tx-request][POST] Incoming request payload:", {
    headers: req.headers,
    query,
    body,
  });

  const reference =
    typeof query.reference === "string" ? query.reference : null;
  let accountFromBody =
    typeof body.account === "string" ? body.account : null;
  if (!accountFromBody && Buffer.isBuffer(body)) {
    try {
      const parsed = JSON.parse(body.toString("utf8"));
      if (parsed && typeof parsed.account === "string") {
        accountFromBody = parsed.account;
      }
    } catch (_err) {
      // Ignore malformed JSON
    }
  } else if (!accountFromBody && typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.account === "string") {
        accountFromBody = parsed.account;
      }
    } catch (_err) {
      // Ignore malformed JSON
    }
  }
  const accountFromQuery =
    typeof query.account === "string" ? query.account : null;
  const account =
    accountFromBody ||
    accountFromQuery ||
    (typeof req.headers["x-payer-account"] === "string"
      ? req.headers["x-payer-account"]
      : null);

  if (!reference) {
    console.error("[tx-request][POST] Missing 'reference' in query.");
    return res.status(400).json({
      error: "Missing 'reference' query parameter.",
    });
  }

  if (!account) {
    console.error("[tx-request][POST] Missing payer account in request.", {
      headers: req.headers,
      query: req.query,
      rawBody: req.body,
    });
    return res.status(400).json({
      error: "Missing payer account in request body (field 'account').",
    });
  }

  console.log("[tx-request][POST] Build transaction request:", {
    reference,
    account,
  });

  const session = solanaPaySessions.get(reference);
  if (!session) {
    console.error(
      "[tx-request][POST] Payment session not found for reference:",
      reference
    );
    return res.status(404).json({
      error: "Payment session not found for this reference.",
    });
  }

  if (session.mode !== "transaction-request") {
    console.error(
      "[tx-request][POST] Session is not in 'transaction-request' mode:",
      { reference, mode: session.mode }
    );
    return res.status(400).json({
      error: "This payment session is not in 'transaction-request' mode.",
    });
  }

  try {
    const connection = sharedConnection;
    const payerPubkey = new PublicKey(account);
    const merchant = loadMerchantKeypair();
    const recipient = merchant.publicKey;
    const referencePubkey = new PublicKey(reference);

    const purchaseAmountLamports = Math.round(
      Number(session.amountSol) * LAMPORTS_PER_SOL
    );

    if (!purchaseAmountLamports || purchaseAmountLamports <= 0) {
      console.error(
        "[tx-request][POST] Invalid purchase amount in session:",
        session.amountSol
      );
      return res.status(400).json({
        error: "Invalid purchase amount stored in session.",
      });
    }

    /** @type {import('@solana/web3.js').TransactionInstruction[]} */
    const instructions = [];

    // -----------------------------------------------------------------------
    // 1) Optional: redeem_coupon instruction if couponAddress exists
    // -----------------------------------------------------------------------
    if (session.couponAddress) {
      console.log(
        "[tx-request][POST] Building redeem_coupon for session:",
        {
          couponAddress: session.couponAddress,
        }
      );

      if (!PROGRAM_IDL || !CODER) {
        throw new Error(
          "IDL not loaded or coder not initialized. Cannot build redeem_coupon instruction."
        );
      }

      const couponPk = new PublicKey(session.couponAddress);

      const couponDef = findAccount(["coupon"]);
      if (!couponDef) {
        throw new Error(
          `Could not find 'coupon' account in IDL. Available accounts: ${
            PROGRAM_IDL.accounts
              ? PROGRAM_IDL.accounts.map((a) => a.name).join(", ")
              : "none"
          }`
        );
      }

      const couponInfo = await rpcWithBackoff(
        `getAccountInfo(coupon:${couponPk.toBase58()})`,
        () => connection.getAccountInfo(couponPk)
      );

      if (!couponInfo) {
        return res.status(404).json({
          error: "Coupon account not found on-chain.",
        });
      }

      const decodedCoupon = CODER.accounts.decode(
        couponDef.name,
        couponInfo.data
      );

      const pickBool = (obj, keys, fallback) => {
        if (!obj) return fallback;
        for (const k of keys) {
          const v = obj[k];
          if (typeof v === "boolean") return v;
        }
        return fallback;
      };

      // Owner + campaign from coupon
      let ownerPk = null;
      let campaignPk = null;

      if (
        decodedCoupon.owner &&
        typeof decodedCoupon.owner.toBase58 === "function"
      ) {
        ownerPk = decodedCoupon.owner.toBase58();
      }

      if (
        decodedCoupon.campaign &&
        typeof decodedCoupon.campaign.toBase58 === "function"
      ) {
        campaignPk = decodedCoupon.campaign.toBase58();
      } else {
        const pkFields = Object.entries(decodedCoupon)
          .filter(
            ([, value]) =>
              value && typeof value.toBase58 === "function"
          )
          .map(([key, value]) => ({
            key,
            value,
            base58: value.toBase58(),
          }));

        const campaignField = pkFields.find((f) =>
          /campaign/i.test(f.key)
        );
        if (campaignField) {
          campaignPk = campaignField.base58;
        }
      }

      if (!ownerPk) {
        return res.status(500).json({
          error: "Failed to read coupon owner from on-chain account.",
        });
      }

      if (!campaignPk) {
        return res.status(500).json({
          error:
            "Failed to read coupon campaign from on-chain account.",
        });
      }

      if (ownerPk !== payerPubkey.toBase58()) {
        return res.status(400).json({
          error: "This wallet is not the owner of the coupon.",
          details: {
            onChainOwner: ownerPk,
            providedWallet: payerPubkey.toBase58(),
          },
        });
      }

      const isUsed = pickBool(
        decodedCoupon,
        ["used", "is_used", "redeemed"],
        false
      );
      const isListed = pickBool(
        decodedCoupon,
        ["listed", "is_listed"],
        false
      );

      if (isUsed) {
        return res.status(400).json({
          error: "Coupon is already used (unusable).",
        });
      }

      if (isListed) {
        return res.status(400).json({
          error:
            "Coupon is currently listed for sale and cannot be redeemed.",
        });
      }

      const campaignDef = findAccount(["campaign"]);
      if (!campaignDef) {
        throw new Error(
          `Could not find 'campaign' account in IDL. Available accounts: ${
            PROGRAM_IDL.accounts
              ? PROGRAM_IDL.accounts.map((a) => a.name).join(", ")
              : "none"
          }`
        );
      }

      const campaignPubkey = new PublicKey(campaignPk);

      const campaignInfo = await rpcWithBackoff(
        `getAccountInfo(campaign:${campaignPk})`,
        () => connection.getAccountInfo(campaignPubkey)
      );

      if (!campaignInfo) {
        return res.status(404).json({
          error: "Campaign account not found on-chain for this coupon.",
        });
      }

      // 🔥 NOVO: decodamos a campaign para pegar o product_code
      const decodedCampaign = CODER.accounts.decode(
        campaignDef.name,
        campaignInfo.data
      );

      let productCodeNumber = null;

      if (
        decodedCampaign &&
        decodedCampaign.product_code !== undefined &&
        decodedCampaign.product_code !== null
      ) {
        const v = decodedCampaign.product_code;
        if (typeof v === "number") {
          productCodeNumber = v;
        } else if (v && typeof v.toNumber === "function") {
          productCodeNumber = v.toNumber();
        }
      } else if (
        decodedCampaign &&
        decodedCampaign.productCode !== undefined &&
        decodedCampaign.productCode !== null
      ) {
        const v = decodedCampaign.productCode;
        if (typeof v === "number") {
          productCodeNumber = v;
        } else if (v && typeof v.toNumber === "function") {
          productCodeNumber = v.toNumber();
        }
      }

      if (productCodeNumber === null) {
        console.error(
          "[tx-request][POST] Could not determine product_code from campaign account.",
          {
            decodedCampaignKeys: Object.keys(decodedCampaign || {}),
          }
        );
        return res.status(500).json({
          error:
            "Could not determine product_code for coupon from campaign account.",
        });
      }

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaignPubkey.toBuffer()],
        PROGRAM_ID
      );

      const platformTreasuryPubkey = await resolvePlatformTreasuryPubkey(
        connection,
        merchant.publicKey,
        "[tx-request][POST]"
      );

      const redeemIxDef = findInstruction(["redeem", "coupon"]);
      if (!redeemIxDef) {
        throw new Error(
          `Could not find redeem_coupon-like instruction in IDL. Available instructions: ${
            PROGRAM_IDL.instructions
              ? PROGRAM_IDL.instructions.map((ix) => ix.name).join(", ")
              : "none"
          }`
        );
      }

      const purchaseAmountBn = new anchor.BN(purchaseAmountLamports);

      // 🔥 NOVO: passamos também product_code / productCode
      const valuesMap = {
        purchase_amount: purchaseAmountBn,
        purchaseAmount: purchaseAmountBn,
        product_code: productCodeNumber,
        productCode: productCodeNumber,
      };

      const encodedArgs = buildArgsFromIdl(
        redeemIxDef.args || [],
        valuesMap
      );
      const data = CODER.instruction.encode(
        redeemIxDef.name,
        encodedArgs
      );

      const redeemKeys = [
        {
          pubkey: campaignPubkey,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: vaultPda,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: couponPk,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: payerPubkey,
          isSigner: true,
          isWritable: true,
        },
        {
          pubkey: platformTreasuryPubkey,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
      ];

      const redeemIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: redeemKeys,
        data,
      });

      instructions.push(redeemIx);
    }

    // -----------------------------------------------------------------------
    // 2) SOL transfer from payer to merchant with reference PDA
    // -----------------------------------------------------------------------
    const transferIx = SystemProgram.transfer({
      fromPubkey: payerPubkey,
      toPubkey: recipient,
      lamports: purchaseAmountLamports,
    });

    transferIx.keys.push({
      pubkey: referencePubkey,
      isSigner: false,
      isWritable: false,
    });

    instructions.push(transferIx);

    const tx = new Transaction().add(...instructions);

    const latestBlockhash = await rpcWithBackoff(
      "getLatestBlockhash(tx-request)",
      () => connection.getLatestBlockhash("finalized")
    );

    tx.feePayer = payerPubkey;
    tx.recentBlockhash = latestBlockhash.blockhash;

    const serialized = tx.serialize({
      requireAllSignatures: false,
    });

    const transactionBase64 = serialized.toString("base64");

    console.log("[tx-request][POST] Built unsigned transaction:", {
      reference,
      payer: payerPubkey.toBase58(),
      recipient: recipient.toBase58(),
      lamports: purchaseAmountLamports,
      hasCouponInstruction: !!session.couponAddress,
    });

    return res.status(200).json({
      transaction: transactionBase64,
      message: "Order payment via Solana Pay",
    });
  } catch (err) {
    console.error("[tx-request][POST] Error building transaction:", err);
    return res.status(500).json({
      error: "Failed to build transaction for Solana Pay request",
      details: err?.message || String(err),
    });
  }
});

// ---------------------------------------------------------------------------
// Solana Pay - Payment status checker
// Frontend polls this endpoint with ?reference=.. to know if payment is confirmed
// ---------------------------------------------------------------------------
app.get("/api/solana-pay/status/:reference", async (req, res) => {
  const referenceStr =
    typeof req.params.reference === "string" ? req.params.reference : null;

  if (!referenceStr) {
    console.error("[solana-pay/status] Missing reference param.");
    return res.status(400).json({
      status: "error",
      error: "Missing reference parameter.",
    });
  }

  console.log(
    "[solana-pay/status] Incoming status check for reference:",
    referenceStr
  );

  const session = solanaPaySessions.get(referenceStr);

  if (!session) {
    console.warn(
      "[solana-pay/status] No in-memory session found for reference:",
      referenceStr
    );
    // 404 aqui já é suficiente pra não quebrar o fluxo,
    // mas vamos ser explícitos no payload
    return res.status(404).json({
      status: "not_found",
      error: "Payment session not found for this reference.",
    });
  }

  // If we already marked this session as confirmed, just return it
  if (session.status === "confirmed" && session.signature) {
    console.log(
      "[solana-pay/status] Session already confirmed in memory:",
      referenceStr
    );
    return res.json({
      status: "confirmed",
      signature: session.signature,
    });
  }

  try {
    const connection = sharedConnection;
    const referencePubkey = new PublicKey(referenceStr);

    // Try to find a confirmed tx that includes this reference
    const foundTx = await rpcWithBackoff(
      `findReference(${referenceStr})`,
      () =>
        findReference(connection, referencePubkey, {
          finality: "confirmed",
        })
    );

    if (!foundTx || !foundTx.signature) {
      console.log(
        "[solana-pay/status] No confirmed transaction yet for reference:",
        referenceStr
      );
      return res.json({ status: "pending" });
    }

    console.log(
      "[solana-pay/status] Found confirmed transaction for reference:",
      referenceStr,
      "signature:",
      foundTx.signature
    );

    // Update in-memory session
    session.status = "confirmed";
    session.signature = foundTx.signature;
    session.lastError = null;
    solanaPaySessions.set(referenceStr, session);

    return res.json({
      status: "confirmed",
      signature: foundTx.signature,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);

    // "not found" == still pending, not an error
    if (msg.toLowerCase().includes("not found")) {
      console.log(
        "[solana-pay/status] No confirmed transaction yet for reference:",
        referenceStr
      );
      return res.json({ status: "pending" });
    }

    console.error(
      "[solana-pay/status] Error while checking transaction status:",
      err
    );

    // Optionally store lastError in session
    session.lastError = msg;
    solanaPaySessions.set(referenceStr, session);

    return res.status(500).json({
      status: "error",
      error: msg,
    });
  }
});


/**
 * GET /api/secondary/listings
 * Returns marketplace listings stored in memory.
 */
app.get("/api/secondary/listings", (req, res) => {
  try {
    return res.json({
      listings: secondaryListings,
      count: secondaryListings.length,
    });
  } catch (err) {
    console.error("[secondary] Failed to serve listings:", err);
    return res
      .status(500)
      .json({ error: "Failed to load secondary listings." });
  }
});

/**
 * POST /api/secondary/list
 * MVP endpoint that records a listing in memory.
 */
app.post("/api/secondary/list", async (req, res) => {
  try {
    const {
      campaignAddress,
      couponAddress,
      sellerWallet,
      price,
      currency,
    } = req.body || {};

    if (!campaignAddress || !couponAddress || !sellerWallet) {
      return res.status(400).json({
        error: "campaignAddress, couponAddress and sellerWallet are required.",
      });
    }

    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return res
        .status(400)
        .json({ error: "price must be a positive number." });
    }

    const normalizedCurrency =
      typeof currency === "string" ? currency.trim().toUpperCase() : "SOL";
    if (normalizedCurrency !== "SOL") {
      return res
        .status(400)
        .json({ error: "Only SOL listings are supported at the moment." });
    }

    if (!PROGRAM_IDL || !CODER) {
      throw new Error(
        "IDL not loaded or coder not initialized. Run `anchor build` before listing secondary coupons."
      );
    }

    let campaignPubkey;
    try {
      campaignPubkey = new PublicKey(campaignAddress);
    } catch (e) {
      return res.status(400).json({
        error: "Invalid campaignAddress.",
        details: e.message || String(e),
      });
    }

    const campaignInfo = await rpcWithBackoff(
      `getAccountInfo(secondary-list:${campaignAddress})`,
      () => sharedConnection.getAccountInfo(campaignPubkey)
    );

    if (!campaignInfo) {
      return res
        .status(404)
        .json({ error: "Campaign account not found for this listing." });
    }

    const campaignDef = findAccount(["campaign"]);
    if (!campaignDef) {
      throw new Error(
        "Failed to find campaign account definition in the IDL."
      );
    }

    const decodedCampaign = CODER.accounts.decode(
      campaignDef.name,
      campaignInfo.data
    );

    const maxDiscountLamports = getFirstNumeric(
      decodedCampaign,
      ["max_discount_lamports", "maxDiscountLamports"],
      0
    );
    const discountBps = getFirstNumeric(
      decodedCampaign,
      ["discount_bps", "discountBps"],
      0
    );
    const productCode = getFirstNumeric(
      decodedCampaign,
      ["product_code", "productCode"],
      0
    );

    const resaleBps = getFirstNumeric(
      decodedCampaign,
      ["resale_bps", "resaleBps"],
      0
    );

    const productPriceSol = Object.prototype.hasOwnProperty.call(
      PRODUCT_CODE_PRICE_SOL,
      productCode
    )
      ? PRODUCT_CODE_PRICE_SOL[productCode]
      : 0;
    const discountFraction = discountBps > 0 ? discountBps / 10_000 : 0;
    const productDiscountLamports =
      productPriceSol > 0 && discountFraction > 0
        ? Math.floor(
            productPriceSol *
              LAMPORTS_PER_SOL *
              discountFraction
          )
        : 0;

    let effectiveDiscountLamports = maxDiscountLamports;
    if (productDiscountLamports > 0) {
      if (effectiveDiscountLamports > 0) {
        effectiveDiscountLamports = Math.min(
          effectiveDiscountLamports,
          productDiscountLamports
        );
      } else {
        effectiveDiscountLamports = productDiscountLamports;
      }
    }

    let maxResaleLamports = effectiveDiscountLamports;
    if (resaleBps > 0 && effectiveDiscountLamports > 0) {
      maxResaleLamports = Math.floor(
        (effectiveDiscountLamports * resaleBps) / 10_000
      );
      maxResaleLamports = Math.min(
        maxResaleLamports,
        effectiveDiscountLamports
      );
    }

    const maxResaleValueSol =
      maxResaleLamports > 0 ? maxResaleLamports / LAMPORTS_PER_SOL : 0;

    if (
      maxResaleValueSol > 0 &&
      numericPrice > maxResaleValueSol + 1e-9
    ) {
      return res.status(400).json({
        error: `Listing price exceeds the resale cap (${maxResaleValueSol} SOL).`,
        maxAllowedPriceSol: maxResaleValueSol,
      });
    }

    const alreadyListed = secondaryListings.find(
      (l) =>
        l.couponAddress === couponAddress &&
        (l.status === "active" || l.status === "pending")
    );
    if (alreadyListed) {
      return res
        .status(400)
        .json({ error: "This coupon already has an active listing." });
    }

    const now = Date.now();
    const listing = {
      id: generateListingId(),
      campaignAddress,
      couponAddress,
      sellerWallet,
      price: numericPrice,
      currency: normalizedCurrency,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    secondaryListings.push(listing);
    locallyListedCoupons.add(couponAddress);
    console.log("[secondary] Created listing:", listing);

    return res.status(201).json({ listing });
  } catch (err) {
    console.error("[secondary] Failed to create listing:", err);
    return res.status(500).json({ error: "Failed to list coupon." });
  }
});


/**
 * POST /api/secondary/buy
 * Simple MVP "buy" endpoint.
 * For now it only marks the listing as "sold" and does NOT
 * perform any on-chain transfer or payment.
 *
 * Body:
 * - listingId: string
 * - buyerWallet: string
 */
app.post("/api/secondary/buy", async (req, res) => {
  try {
    const { listingId, buyerWallet } = req.body || {};

    if (!listingId || !buyerWallet) {
      return res
        .status(400)
        .json({ error: "listingId and buyerWallet are required." });
    }

    const listing = secondaryListings.find((l) => l.id === listingId);

    if (!listing) {
      return res.status(404).json({ error: "Listing not found." });
    }

    if (listing.status !== "active") {
      return res.status(400).json({ error: "Listing is not active." });
    }

    // MVP: mark as sold. Future: attach on-chain transfer + payment.
    listing.status = "sold";
    listing.buyerWallet = buyerWallet;
    listing.updatedAt = Date.now();
    locallyListedCoupons.delete(listing.couponAddress);

    console.log(
      "[secondary] Listing sold:",
      listingId,
      "buyer:",
      buyerWallet
    );

    return res.json({ listing });
  } catch (err) {
    console.error("[secondary] Error buying listing:", err);
    return res.status(500).json({ error: "Failed to buy listing." });
  }
});


// -----------------------------------------------------------------------------
// Startup
// -----------------------------------------------------------------------------

loadMerchantKeypair();

app.listen(PORT, () => {
  console.log(`AI server listening on http://localhost:${PORT}`);
});
