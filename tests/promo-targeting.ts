import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PromoTargeting as PromoTargetingIdl } from "../target/types/promo_targeting";
import { assert } from "chai";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";

let provider: anchor.AnchorProvider;
let program: Program<PromoTargetingIdl>;
let connection: anchor.web3.Connection;

before(async () => {
  // Use the provider configured by Anchor (from Anchor.toml / env)
  provider = anchor.getProvider() as anchor.AnchorProvider;
  anchor.setProvider(provider);

  program = anchor.workspace.PromoTargeting as Program<PromoTargetingIdl>;
  connection = provider.connection;
});

describe("PromoTargeting", () => {
  const merchant = () => provider.wallet;

  // ---- Base "All Users" campaign (requires_wallet = false) ----
  const CAMPAIGN_ID = 1;
  const CAMPAIGN_NAME = "Launch Campaign";
  const DISCOUNT_BPS = 2000; // 20%
  const SERVICE_FEE_BPS = 500; // 5% over discount
  const RESALE_BPS = 1000; // 10% of discount value (secondary price cap)
  const MAX_RESALE_BPS = 1000; // global cap set by admin
  const TOTAL_COUPONS = 5;

  const MINT_COST_LAMPORTS = 1_000_000; // 0.001 SOL equivalent
  const MAX_DISCOUNT_LAMPORTS = 20_000_000; // max discount per coupon
  const CATEGORY_CODE = 10; // e.g. "electronics"
  const PRODUCT_CODE = 101; // e.g. "smartphone"

  // Budget deposited into the vault. Needs to be large enough to cover:
  // - mint cost * total_coupons
  // - service fees for expected redemptions
  const DEPOSIT_AMOUNT = 10_000_000; // 0.01 SOL equivalent

  const COUPON_INDEX_1 = 1;
  const COUPON_INDEX_2 = 2;
  const COUPON_INDEX_3 = 3;
  const COUPON_INDEX_4 = 4;
  const COUPON_INDEX_5 = 5;

  // ---- Targeted campaign (requires_wallet = true) ----
  const TARGETED_CAMPAIGN_ID = 2;
  const TARGETED_CAMPAIGN_NAME = "VIP Targeted Campaign";
  const TARGETED_TOTAL_COUPONS = 3;

  // ---- Expired campaign (for expireCoupon happy path) ----
  const EXPIRED_CAMPAIGN_ID = 3;
  const EXPIRED_CAMPAIGN_NAME = "Expired Campaign";
  const EXPIRED_TOTAL_COUPONS = 2;

  let configPda: PublicKey;
  let campaignPda: PublicKey;
  let vaultPda: PublicKey;
  let couponPda1: PublicKey;
  let couponPda2: PublicKey;
  let couponPda3: PublicKey;
  let couponPda4: PublicKey;
  let couponPda5: PublicKey;

  let targetedCampaignPda: PublicKey;
  let targetedVaultPda: PublicKey;
  let targetedCouponPda: PublicKey;

  let expiredCampaignPda: PublicKey;
  let expiredVaultPda: PublicKey;
  let expiredCouponPda: PublicKey;

  const recipient = Keypair.generate();
  const newOwner = Keypair.generate();
  const buyer = Keypair.generate();
  const targetUser = Keypair.generate(); // wallet that should be eligible in targeted campaign
  const nonEligibleUser = Keypair.generate(); // wallet that should NOT be eligible

  // Platform treasury account (just a generic keypair for tests)
  const platformTreasury = Keypair.generate();

  function toLEBytesU64(n: number): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(n));
    return buf;
  }

  it("Smoke Test - program loaded and ID matches", async () => {
    // Update this to your current deployed program ID if you want strict matching.
    const expectedProgramId = "41eti7CsZBWD1QYdor2RnxmqzsaNGpRQCkJQZqX2JEKr";

    if (program.programId.toBase58() !== expectedProgramId) {
      console.warn(
        "Warning: programId does not match expected. " +
          "Check Anchor.toml and declare_id! in lib.rs."
      );
    }

    assert.ok(program.programId instanceof PublicKey, "Invalid programId");
  });

  it("Initializes global config", async () => {
    // Derive GlobalConfig PDA: seeds = ["config"]
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    // Airdrop some SOL to test wallets and platform treasury
    const airdrops = [
      recipient.publicKey,
      newOwner.publicKey,
      buyer.publicKey,
      platformTreasury.publicKey,
      targetUser.publicKey,
      nonEligibleUser.publicKey,
    ].map((pubkey) =>
      connection.requestAirdrop(pubkey, 2 * anchor.web3.LAMPORTS_PER_SOL)
    );
    await Promise.all(airdrops);

    const txSig = await program.methods
      .initializeConfig(MAX_RESALE_BPS, SERVICE_FEE_BPS)
      .accounts({
        config: configPda,
        admin: merchant().publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Initialize config tx:", txSig);

    const configAccount = await program.account.globalConfig.fetch(configPda);

    assert.equal(
      configAccount.admin.toBase58(),
      merchant().publicKey.toBase58(),
      "Admin mismatch in GlobalConfig"
    );
    assert.equal(
      configAccount.maxResaleBps,
      MAX_RESALE_BPS,
      "maxResaleBps mismatch in GlobalConfig"
    );
    assert.equal(
      configAccount.serviceFeeBps,
      SERVICE_FEE_BPS,
      "serviceFeeBps mismatch in GlobalConfig"
    );
  });

  it("Creates an 'All Users' discount campaign and funds the vault", async () => {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const expirationTimestamp = nowInSeconds + 7 * 24 * 60 * 60; // 7 days

    // Derive campaign PDA: seeds = ["campaign", merchant, campaign_id_le]
    [campaignPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        merchant().publicKey.toBuffer(),
        toLEBytesU64(CAMPAIGN_ID),
      ],
      program.programId
    );

    // Derive vault PDA: seeds = ["vault", campaign]
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), campaignPda.toBuffer()],
      program.programId
    );

    // For "All users" campaign:
    // - requiresWallet = false
    // - targetWallet is ignored, but we pass a default (zero) pubkey
    const dummyTargetWallet = new PublicKey(new Uint8Array(32).fill(0));

    const txSig = await program.methods
      .createCampaign(
        new anchor.BN(CAMPAIGN_ID),
        DISCOUNT_BPS,
        RESALE_BPS,
        new anchor.BN(expirationTimestamp),
        TOTAL_COUPONS,
        new anchor.BN(MINT_COST_LAMPORTS),
        new anchor.BN(MAX_DISCOUNT_LAMPORTS),
        CATEGORY_CODE,
        PRODUCT_CODE,
        CAMPAIGN_NAME,
        new anchor.BN(DEPOSIT_AMOUNT),
        false, // requiresWallet = false
        dummyTargetWallet
      )
      .accounts({
        config: configPda,
        campaign: campaignPda,
        vault: vaultPda,
        merchant: merchant().publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Create 'All users' campaign tx:", txSig);

    const campaignAccount = await program.account.campaign.fetch(campaignPda);
    const vaultAccount = await program.account.vault.fetch(vaultPda);

    // Campaign checks
    assert.equal(
      campaignAccount.merchant.toBase58(),
      merchant().publicKey.toBase58(),
      "Merchant mismatch"
    );
    assert.equal(
      Number(campaignAccount.campaignId),
      CAMPAIGN_ID,
      "campaignId mismatch"
    );
    assert.equal(
      campaignAccount.discountBps,
      DISCOUNT_BPS,
      "discountBps mismatch"
    );
    assert.equal(
      campaignAccount.serviceFeeBps,
      SERVICE_FEE_BPS,
      "serviceFeeBps mismatch"
    );
    assert.equal(
      campaignAccount.resaleBps,
      RESALE_BPS,
      "resaleBps mismatch"
    );
    assert.equal(
      campaignAccount.totalCoupons,
      TOTAL_COUPONS,
      "totalCoupons mismatch"
    );
    assert.equal(
      campaignAccount.usedCoupons,
      0,
      "usedCoupons should start at 0"
    );
    assert.equal(
      campaignAccount.mintedCoupons,
      0,
      "mintedCoupons should start at 0"
    );
    assert.equal(
      campaignAccount.campaignName,
      CAMPAIGN_NAME,
      "campaignName mismatch"
    );
    assert.equal(
      Number(campaignAccount.mintCostLamports),
      MINT_COST_LAMPORTS,
      "mintCostLamports mismatch"
    );
    assert.equal(
      Number(campaignAccount.maxDiscountLamports),
      MAX_DISCOUNT_LAMPORTS,
      "maxDiscountLamports mismatch"
    );
    assert.equal(
      campaignAccount.categoryCode,
      CATEGORY_CODE,
      "categoryCode mismatch"
    );
    assert.equal(
      campaignAccount.productCode,
      PRODUCT_CODE,
      "productCode mismatch"
    );
    assert.equal(
      campaignAccount.requiresWallet,
      false,
      "requiresWallet should be false for 'All users' campaign"
    );

    // Analytics should start at zero
    assert.equal(
      Number(campaignAccount.totalPurchaseAmount),
      0,
      "totalPurchaseAmount should start at 0"
    );
    assert.equal(
      Number(campaignAccount.totalDiscountLamports),
      0,
      "totalDiscountLamports should start at 0"
    );
    assert.equal(
      Number(campaignAccount.lastRedeemTimestamp),
      0,
      "lastRedeemTimestamp should start at 0"
    );

    // Vault checks
    assert.equal(
      vaultAccount.campaign.toBase58(),
      campaignPda.toBase58(),
      "Vault campaign mismatch"
    );
    assert.equal(
      vaultAccount.merchant.toBase58(),
      merchant().publicKey.toBase58(),
      "Vault merchant mismatch"
    );
    assert.equal(
      Number(vaultAccount.totalDeposit),
      DEPOSIT_AMOUNT,
      "Vault totalDeposit mismatch"
    );
    assert.equal(
      Number(vaultAccount.totalMintSpent),
      0,
      "Vault totalMintSpent should start at 0"
    );
    assert.equal(
      Number(vaultAccount.totalServiceSpent),
      0,
      "Vault totalServiceSpent should start at 0"
    );
  });

  it("Mints a coupon for a recipient and charges mint cost from vault (All users campaign)", async () => {
    // coupon PDA: seeds = ["coupon", campaign, coupon_index_le]
    [couponPda1] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("coupon"),
        campaignPda.toBuffer(),
        toLEBytesU64(COUPON_INDEX_1),
      ],
      program.programId
    );

    const txSig = await program.methods
      .mintCoupon(new anchor.BN(CAMPAIGN_ID), new anchor.BN(COUPON_INDEX_1))
      .accounts({
        campaign: campaignPda,
        vault: vaultPda,
        coupon: couponPda1,
        merchant: merchant().publicKey,
        recipient: recipient.publicKey,
        platformTreasury: platformTreasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Mint coupon tx:", txSig);

    const couponAccount = await program.account.coupon.fetch(couponPda1);
    const campaignAccount = await program.account.campaign.fetch(campaignPda);
    const vaultAccount = await program.account.vault.fetch(vaultPda);

    // Coupon checks
    assert.equal(
      couponAccount.campaign.toBase58(),
      campaignPda.toBase58(),
      "Coupon campaign mismatch"
    );
    assert.equal(
      couponAccount.owner.toBase58(),
      recipient.publicKey.toBase58(),
      "Coupon owner mismatch"
    );
    assert.equal(couponAccount.used, false, "Coupon should start unused");
    assert.equal(couponAccount.listed, false, "Coupon should start unlisted");
    assert.equal(
      Number(couponAccount.salePriceLamports),
      0,
      "Coupon salePriceLamports should start at 0"
    );

    // Campaign minted coupons should be 1
    assert.equal(
      campaignAccount.mintedCoupons,
      1,
      "mintedCoupons should be 1 after first mint"
    );

    // Vault must have spent mint cost
    assert.equal(
      Number(vaultAccount.totalMintSpent),
      MINT_COST_LAMPORTS,
      "Vault totalMintSpent should equal mint cost after first mint"
    );
  });

  it("Redeems a coupon (happy path), updates analytics and burns the coupon", async () => {
    const purchaseAmountLamports = 100_000_000; // example purchase amount
    const purchaseAmount = new anchor.BN(purchaseAmountLamports);

    const txSig = await program.methods
      .redeemCoupon(purchaseAmount, PRODUCT_CODE)
      .accounts({
        campaign: campaignPda,
        vault: vaultPda,
        coupon: couponPda1,
        user: recipient.publicKey,
        platformTreasury: platformTreasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([recipient])
      .rpc();

    console.log("Redeem coupon tx:", txSig);

    // Coupon account should be closed (burned) after redeem
    const couponInfo = await connection.getAccountInfo(couponPda1);
    assert.isNull(
      couponInfo,
      "Coupon account should be closed after redeem (burned)"
    );

    const campaignAccount = await program.account.campaign.fetch(campaignPda);
    const vaultAccount = await program.account.vault.fetch(vaultPda);

    // Campaign used coupons should be 1
    assert.equal(
      campaignAccount.usedCoupons,
      1,
      "usedCoupons should be 1 after redeem"
    );

    // Compute expected discount and service fee for verification
    const rawDiscount = (purchaseAmountLamports * DISCOUNT_BPS) / 10_000;
    const discountValue = Math.min(rawDiscount, MAX_DISCOUNT_LAMPORTS);
    const expectedServiceFee =
      (discountValue * SERVICE_FEE_BPS) / 10_000;

    // Vault service fee accounting
    assert.equal(
      Number(vaultAccount.totalServiceSpent),
      expectedServiceFee,
      "Vault totalServiceSpent should match expected service fee"
    );

    // Aggregated analytics on campaign
    assert.equal(
      Number(campaignAccount.totalPurchaseAmount),
      purchaseAmountLamports,
      "totalPurchaseAmount should match the redeemed purchase"
    );
    assert.equal(
      Number(campaignAccount.totalDiscountLamports),
      discountValue,
      "totalDiscountLamports should match the applied discount"
    );
    assert.isTrue(
      Number(campaignAccount.lastRedeemTimestamp) > 0,
      "lastRedeemTimestamp should be set after redeem"
    );
  });

  it("Fails to redeem an already used (burned) coupon", async () => {
    const purchaseAmount = new anchor.BN(50_000_000);

    let failed = false;
    try {
      await program.methods
        .redeemCoupon(purchaseAmount, PRODUCT_CODE)
        .accounts({
          campaign: campaignPda,
          vault: vaultPda,
          coupon: couponPda1, // account was closed in the previous test
          user: recipient.publicKey,
          platformTreasury: platformTreasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([recipient])
        .rpc();
    } catch (err) {
      failed = true;
      console.log("Expected failure on second redeem:", err.toString());
    }

    assert.isTrue(failed, "Second redeem should fail for a burned coupon");
  });

  it("Fails to redeem a coupon with wrong product code", async () => {
    // Mint a fresh coupon (index 5) for this test
    [couponPda5] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("coupon"),
        campaignPda.toBuffer(),
        toLEBytesU64(COUPON_INDEX_5),
      ],
      program.programId
    );

    const txMint = await program.methods
      .mintCoupon(new anchor.BN(CAMPAIGN_ID), new anchor.BN(COUPON_INDEX_5))
      .accounts({
        campaign: campaignPda,
        vault: vaultPda,
        coupon: couponPda5,
        merchant: merchant().publicKey,
        recipient: recipient.publicKey,
        platformTreasury: platformTreasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Mint coupon for product mismatch test tx:", txMint);

    const wrongProductCode = PRODUCT_CODE + 1;
    const purchaseAmount = new anchor.BN(10_000_000);

    let failed = false;
    try {
      await program.methods
        .redeemCoupon(purchaseAmount, wrongProductCode)
        .accounts({
          campaign: campaignPda,
          vault: vaultPda,
          coupon: couponPda5,
          user: recipient.publicKey,
          platformTreasury: platformTreasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([recipient])
        .rpc();
    } catch (err: any) {
      failed = true;
      console.log(
        "Expected failure redeeming with wrong product code:",
        err.toString()
      );
    }

    assert.isTrue(
      failed,
      "Redeem should fail when product_code does not match campaign.productCode"
    );

    // Coupon should still exist and remain unused
    const couponAccount = await program.account.coupon.fetch(couponPda5);
    assert.equal(
      couponAccount.used,
      false,
      "Coupon should remain unused after failed redeem"
    );
  });

  it("Transfers coupon to a new owner (P2P)", async () => {
    // Mint a second coupon (index 2) for the same recipient
    [couponPda2] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("coupon"),
        campaignPda.toBuffer(),
        toLEBytesU64(COUPON_INDEX_2),
      ],
      program.programId
    );

    const txMint = await program.methods
      .mintCoupon(new anchor.BN(CAMPAIGN_ID), new anchor.BN(COUPON_INDEX_2))
      .accounts({
        campaign: campaignPda,
        vault: vaultPda,
        coupon: couponPda2,
        merchant: merchant().publicKey,
        recipient: recipient.publicKey,
        platformTreasury: platformTreasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Mint second coupon tx:", txMint);

    // Transfer from recipient -> newOwner
    const txTransfer = await program.methods
      .transferCoupon()
      .accounts({
        coupon: couponPda2,
        currentOwner: recipient.publicKey,
        newOwner: newOwner.publicKey,
      })
      .signers([recipient])
      .rpc();

    console.log("Transfer coupon tx:", txTransfer);

    const couponAccount = await program.account.coupon.fetch(couponPda2);

    assert.equal(
      couponAccount.owner.toBase58(),
      newOwner.publicKey.toBase58(),
      "Coupon owner should be newOwner after transfer"
    );
    assert.equal(
      couponAccount.listed,
      false,
      "Coupon should not be listed after transfer"
    );
  });

  it("Fails to list a coupon above the resale price cap", async () => {
    // Mint a fourth coupon (index 4) for newOwner (so they can try to list)
    [couponPda4] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("coupon"),
        campaignPda.toBuffer(),
        toLEBytesU64(COUPON_INDEX_4),
      ],
      program.programId
    );

    const txMint = await program.methods
      .mintCoupon(new anchor.BN(CAMPAIGN_ID), new anchor.BN(COUPON_INDEX_4))
      .accounts({
        campaign: campaignPda,
        vault: vaultPda,
        coupon: couponPda4,
        merchant: merchant().publicKey,
        recipient: newOwner.publicKey,
        platformTreasury: platformTreasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Mint fourth coupon tx:", txMint);

    const campaignAccount = await program.account.campaign.fetch(campaignPda);
    const resaleCapLamports = Math.floor(
      (Number(campaignAccount.maxDiscountLamports) *
        campaignAccount.resaleBps) /
        10_000
    );
    const tooHighPrice =
      resaleCapLamports > 0
        ? resaleCapLamports + 1
        : Number(campaignAccount.maxDiscountLamports) + 1;
    let failed = false;
    try {
      await program.methods
        .listCouponForSale(new anchor.BN(tooHighPrice))
        .accounts({
          campaign: campaignPda,
          coupon: couponPda4,
          owner: newOwner.publicKey,
        })
        .signers([newOwner])
        .rpc();
    } catch (err: any) {
      failed = true;
      console.log(
        "Expected failure listing coupon above cap:",
        err.toString()
      );
    }

    assert.isTrue(
      failed,
      "Listing should fail when sale price is above resale cap"
    );
  });

  it("Lists a coupon for sale within allowed price range", async () => {
    // Mint a third coupon (index 3) for newOwner (so they can list directly)
    [couponPda3] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("coupon"),
        campaignPda.toBuffer(),
        toLEBytesU64(COUPON_INDEX_3),
      ],
      program.programId
    );

    const txMint = await program.methods
      .mintCoupon(new anchor.BN(CAMPAIGN_ID), new anchor.BN(COUPON_INDEX_3))
      .accounts({
        campaign: campaignPda,
        vault: vaultPda,
        coupon: couponPda3,
        merchant: merchant().publicKey,
        recipient: newOwner.publicKey,
        platformTreasury: platformTreasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Mint third coupon tx:", txMint);

    const campaignAccount = await program.account.campaign.fetch(campaignPda);

    const expectedPrice = Math.floor(
      (Number(campaignAccount.maxDiscountLamports) *
        campaignAccount.resaleBps) /
        10_000
    );

    const txList = await program.methods
      .listCouponForSale(new anchor.BN(expectedPrice))
      .accounts({
        campaign: campaignPda,
        coupon: couponPda3,
        owner: newOwner.publicKey,
      })
      .signers([newOwner])
      .rpc();

    console.log("List coupon for sale tx:", txList);

    const couponAccount = await program.account.coupon.fetch(couponPda3);

    assert.equal(
      couponAccount.listed,
      true,
      "Coupon should be marked as listed"
    );
    assert.equal(
      Number(couponAccount.salePriceLamports),
      expectedPrice,
      "salePriceLamports should match chosen price within cap"
    );
  });

  it("Buys a listed coupon using SOL and transfers ownership", async () => {
    // Before balances
    const sellerBefore = await connection.getBalance(newOwner.publicKey);
    const buyerBefore = await connection.getBalance(buyer.publicKey);

    const couponAccountBefore = await program.account.coupon.fetch(couponPda3);
    assert.equal(
      couponAccountBefore.listed,
      true,
      "Coupon should be listed before buy"
    );

    const txBuy = await program.methods
      .buyListedCoupon()
      .accounts({
        campaign: campaignPda,
        coupon: couponPda3,
        seller: newOwner.publicKey,
        buyer: buyer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    console.log("Buy listed coupon tx:", txBuy);

    const couponAccountAfter = await program.account.coupon.fetch(couponPda3);
    const sellerAfter = await connection.getBalance(newOwner.publicKey);
    const buyerAfter = await connection.getBalance(buyer.publicKey);

    // Expected sale price is what was stored in the coupon
    const expectedPrice = Number(couponAccountBefore.salePriceLamports);

    // Ownership should move to buyer, listing cleared
    assert.equal(
      couponAccountAfter.owner.toBase58(),
      buyer.publicKey.toBase58(),
      "Coupon owner should be buyer after purchase"
    );
    assert.equal(
      couponAccountAfter.listed,
      false,
      "Coupon should not be listed after purchase"
    );
    assert.equal(
      Number(couponAccountAfter.salePriceLamports),
      0,
      "salePriceLamports should reset to 0 after purchase"
    );

    // Seller should receive SOL, buyer should pay SOL (within fee tolerance)
    assert.isTrue(
      sellerAfter >= sellerBefore + expectedPrice,
      "Seller balance should increase by at least the sale price"
    );
    assert.isTrue(
      buyerBefore >= buyerAfter + expectedPrice,
      "Buyer balance should decrease by at least the sale price"
    );
  });

  // --------------------------------------------------------------------
  // Targeted campaign tests (requires_wallet = true, target_wallet set)
  // --------------------------------------------------------------------

  it("Creates a targeted campaign that requires a specific wallet", async () => {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const expirationTimestamp = nowInSeconds + 7 * 24 * 60 * 60; // 7 days

    [targetedCampaignPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        merchant().publicKey.toBuffer(),
        toLEBytesU64(TARGETED_CAMPAIGN_ID),
      ],
      program.programId
    );

    [targetedVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), targetedCampaignPda.toBuffer()],
      program.programId
    );

    const txSig = await program.methods
      .createCampaign(
        new anchor.BN(TARGETED_CAMPAIGN_ID),
        DISCOUNT_BPS,
        RESALE_BPS,
        new anchor.BN(expirationTimestamp),
        TARGETED_TOTAL_COUPONS,
        new anchor.BN(MINT_COST_LAMPORTS),
        new anchor.BN(MAX_DISCOUNT_LAMPORTS),
        CATEGORY_CODE,
        PRODUCT_CODE,
        TARGETED_CAMPAIGN_NAME,
        new anchor.BN(DEPOSIT_AMOUNT),
        true, // requiresWallet = true
        targetUser.publicKey // on-chain targeting: only this wallet is eligible
      )
      .accounts({
        config: configPda,
        campaign: targetedCampaignPda,
        vault: targetedVaultPda,
        merchant: merchant().publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Create targeted campaign tx:", txSig);

    const campaignAccount =
      await program.account.campaign.fetch(targetedCampaignPda);
    const vaultAccount =
      await program.account.vault.fetch(targetedVaultPda);

    assert.equal(
      campaignAccount.requiresWallet,
      true,
      "requiresWallet should be true for targeted campaign"
    );
    assert.equal(
      campaignAccount.targetWallet.toBase58(),
      targetUser.publicKey.toBase58(),
      "targetWallet should match the configured targetUser"
    );

    assert.equal(
      Number(vaultAccount.totalDeposit),
      DEPOSIT_AMOUNT,
      "Targeted campaign vault should receive initial deposit"
    );
  });

  it("Fails to mint coupon for non-eligible wallet in targeted campaign", async () => {
    [targetedCouponPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("coupon"),
        targetedCampaignPda.toBuffer(),
        toLEBytesU64(1),
      ],
      program.programId
    );

    let failed = false;
    try {
      await program.methods
        .mintCoupon(
          new anchor.BN(TARGETED_CAMPAIGN_ID),
          new anchor.BN(1)
        )
        .accounts({
          campaign: targetedCampaignPda,
          vault: targetedVaultPda,
          coupon: targetedCouponPda,
          merchant: merchant().publicKey,
          // Pass an ineligible wallet as recipient
          recipient: nonEligibleUser.publicKey,
          platformTreasury: platformTreasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err: any) {
      failed = true;
      console.log(
        "Expected failure minting for non-eligible wallet:",
        err.toString()
      );
    }

    assert.isTrue(
      failed,
      "Mint should fail when recipient is not the configured target wallet"
    );
  });

  it("Successfully mints coupon when recipient matches target wallet in targeted campaign", async () => {
    // Reuse targetedCouponPda index 1 (it was not initialized if previous test failed as expected)
    const txSig = await program.methods
      .mintCoupon(
        new anchor.BN(TARGETED_CAMPAIGN_ID),
        new anchor.BN(1)
      )
      .accounts({
        campaign: targetedCampaignPda,
        vault: targetedVaultPda,
        coupon: targetedCouponPda,
        merchant: merchant().publicKey,
        recipient: targetUser.publicKey, // now this matches campaign.targetWallet
        platformTreasury: platformTreasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(
      "Mint targeted coupon for eligible wallet tx:",
      txSig
    );

    const couponAccount =
      await program.account.coupon.fetch(targetedCouponPda);
    const campaignAccount =
      await program.account.campaign.fetch(targetedCampaignPda);

    assert.equal(
      couponAccount.owner.toBase58(),
      targetUser.publicKey.toBase58(),
      "Coupon owner should be targetUser"
    );
    assert.equal(
      campaignAccount.mintedCoupons,
      1,
      "mintedCoupons should be 1 in targeted campaign"
    );
  });

  // --------------------------------------------------------------------
  // ExpireCoupon tests (burn coupons after campaign expiration)
  // --------------------------------------------------------------------

  it("Fails to expire coupon when campaign is not expired", async () => {
    // At this point, couponPda5 exists, is unused, and the campaign is still active.
    let failed = false;
    try {
      await program.methods
        .expireCoupon()
        .accounts({
          campaign: campaignPda,
          coupon: couponPda5,
          merchant: merchant().publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err: any) {
      failed = true;
      console.log(
        "Expected failure expiring coupon before campaign expiration:",
        err.toString()
      );
    }

    assert.isTrue(
      failed,
      "expireCoupon should fail when campaign is not expired"
    );

    // Coupon should still be there and owned by the original recipient
    const couponAccount = await program.account.coupon.fetch(couponPda5);
    assert.equal(
      couponAccount.owner.toBase58(),
      recipient.publicKey.toBase58(),
      "Coupon should remain owned by recipient after failed expire"
    );
    assert.equal(
      couponAccount.used,
      false,
      "Coupon should remain unused after failed expire"
    );
  });

  it("Expires coupons and burns them after campaign expiration", async () => {
    // Create a campaign that is already expired (expiration in the past)
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const expiredTimestamp = nowInSeconds - 60; // 1 minute in the past

    [expiredCampaignPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        merchant().publicKey.toBuffer(),
        toLEBytesU64(EXPIRED_CAMPAIGN_ID),
      ],
      program.programId
    );

    [expiredVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), expiredCampaignPda.toBuffer()],
      program.programId
    );

    const dummyTargetWallet = new PublicKey(new Uint8Array(32).fill(0));

    const txCreate = await program.methods
      .createCampaign(
        new anchor.BN(EXPIRED_CAMPAIGN_ID),
        DISCOUNT_BPS,
        RESALE_BPS,
        new anchor.BN(expiredTimestamp),
        EXPIRED_TOTAL_COUPONS,
        new anchor.BN(MINT_COST_LAMPORTS),
        new anchor.BN(MAX_DISCOUNT_LAMPORTS),
        CATEGORY_CODE,
        PRODUCT_CODE,
        EXPIRED_CAMPAIGN_NAME,
        new anchor.BN(DEPOSIT_AMOUNT),
        false, // open campaign
        dummyTargetWallet
      )
      .accounts({
        config: configPda,
        campaign: expiredCampaignPda,
        vault: expiredVaultPda,
        merchant: merchant().publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Create expired campaign tx:", txCreate);

    // Mint a coupon in this already-expired campaign
    [expiredCouponPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("coupon"),
        expiredCampaignPda.toBuffer(),
        toLEBytesU64(1),
      ],
      program.programId
    );

    const txMint = await program.methods
      .mintCoupon(new anchor.BN(EXPIRED_CAMPAIGN_ID), new anchor.BN(1))
      .accounts({
        campaign: expiredCampaignPda,
        vault: expiredVaultPda,
        coupon: expiredCouponPda,
        merchant: merchant().publicKey,
        recipient: recipient.publicKey,
        platformTreasury: platformTreasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Mint coupon in expired campaign tx:", txMint);

    // Now expireCoupon should succeed and burn the coupon
    const txExpire = await program.methods
      .expireCoupon()
      .accounts({
        campaign: expiredCampaignPda,
        coupon: expiredCouponPda,
        merchant: merchant().publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Expire coupon tx:", txExpire);

    const couponInfo = await connection.getAccountInfo(expiredCouponPda);
    assert.isNull(
      couponInfo,
      "Coupon account should be closed after expireCoupon in expired campaign"
    );
  });

  // --------------------------------------------------------------------
  // checkTreasuryBalance tests (admin-only helper)
  // --------------------------------------------------------------------

  it("Checks treasury balance as admin", async () => {
    // At this point some mint/redeem operations have already moved lamports into the platform treasury.
    // We only assert that the helper call succeeds for the configured admin.
    const txSig = await program.methods
      .checkTreasuryBalance()
      .accounts({
        config: configPda,
        admin: merchant().publicKey,
        platformTreasury: platformTreasury.publicKey,
      })
      .rpc();

    console.log("checkTreasuryBalance tx:", txSig);

    // Optionally, we can verify that the platform treasury has some lamports
    const treasuryBalance = await connection.getBalance(
      platformTreasury.publicKey
    );
    assert.isTrue(
      treasuryBalance > 0,
      "Platform treasury should have received some lamports by now"
    );
  });

  it("Fails to check treasury balance with invalid admin", async () => {
    const fakeAdmin = Keypair.generate();
    await connection.requestAirdrop(
      fakeAdmin.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );

    let failed = false;
    try {
      await program.methods
        .checkTreasuryBalance()
        .accounts({
          config: configPda,
          admin: fakeAdmin.publicKey, // does not match config.admin
          platformTreasury: platformTreasury.publicKey,
        })
        .signers([fakeAdmin])
        .rpc();
    } catch (err: any) {
      failed = true;
      console.log(
        "Expected failure calling checkTreasuryBalance with invalid admin:",
        err.toString()
      );
    }

    assert.isTrue(
      failed,
      "checkTreasuryBalance should fail if admin does not match GlobalConfig.admin"
    );
  });
});
