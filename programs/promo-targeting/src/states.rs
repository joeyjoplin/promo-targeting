use anchor_lang::prelude::*;

// ---------------------------
// Accounts: State
// ---------------------------

/// Global configuration for the protocol.
#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,       // 32 bytes - who is allowed to update config / call admin helpers
    pub max_resale_bps: u16, // 2 bytes  - maximum resale_bps allowed per campaign
    pub service_fee_bps: u16, // 2 bytes  - global protocol fee applied to all campaigns
}

impl GlobalConfig {
    pub const SIZE: usize = 32 + 2 + 2;
}

/// Campaign account: stores all campaign parameters and summary stats.
#[account]
pub struct Campaign {
    pub merchant: Pubkey,            // 32 bytes
    pub campaign_id: u64,            // 8 bytes
    pub discount_bps: u16,           // 2 bytes
    pub service_fee_bps: u16,        // 2 bytes (over discount)
    pub resale_bps: u16,             // 2 bytes (over max discount, for secondary cap)
    pub expiration_timestamp: i64,   // 8 bytes
    pub total_coupons: u32,          // 4 bytes
    pub used_coupons: u32,           // 4 bytes
    pub minted_coupons: u32,         // 4 bytes
    pub mint_cost_lamports: u64,     // 8 bytes
    pub max_discount_lamports: u64,  // 8 bytes
    pub category_code: u16,          // 2 bytes
    pub product_code: u16,           // 2 bytes
    // String in account: 4 bytes for length + MAX_NAME_LEN bytes reserved
    pub campaign_name: String,       // 4 + MAX_NAME_LEN bytes
    // Targeting metadata
    pub requires_wallet: bool,       // 1 byte - whether campaign enforces a target wallet
    pub target_wallet: Pubkey,       // 32 bytes - eligible wallet for targeted campaigns
    // Aggregated analytics
    pub total_purchase_amount: u64,      // 8 bytes - sum of all purchase_amount in redeem
    pub total_discount_lamports: u64,    // 8 bytes - sum of all discount_value in redeem
    pub last_redeem_timestamp: i64,      // 8 bytes - last time a coupon was redeemed
}

impl Campaign {
    pub const MAX_NAME_LEN: usize = 64;

    /// Space calculation:
    /// - merchant: 32
    /// - campaign_id: 8
    /// - discount_bps: 2
    /// - service_fee_bps: 2
    /// - resale_bps: 2
    /// - expiration_timestamp: 8
    /// - total_coupons: 4
    /// - used_coupons: 4
    /// - minted_coupons: 4
    /// - mint_cost_lamports: 8
    /// - max_discount_lamports: 8
    /// - category_code: 2
    /// - product_code: 2
    /// - campaign_name: 4 (len) + MAX_NAME_LEN
    /// - requires_wallet: 1
    /// - target_wallet: 32
    /// - total_purchase_amount: 8
    /// - total_discount_lamports: 8
    /// - last_redeem_timestamp: 8
    ///
    /// Total = 32 + 8 + 2 + 2 + 2 + 8 + 4 + 4 + 4 + 8 + 8
    ///       + 2 + 2 + 4 + MAX_NAME_LEN + 1 + 32 + 8 + 8 + 8
    pub const SIZE: usize = 32
        + 8
        + 2
        + 2
        + 2
        + 8
        + 4
        + 4
        + 4
        + 8
        + 8
        + 2
        + 2
        + 4
        + Self::MAX_NAME_LEN
        + 1
        + 32
        + 8
        + 8
        + 8;
}

/// Vault account: holds the campaign budget and accounting.
#[account]
pub struct Vault {
    pub campaign: Pubkey,         // 32 bytes
    pub merchant: Pubkey,         // 32 bytes
    pub bump: u8,                 // 1 byte
    pub total_deposit: u64,       // 8 bytes
    pub total_mint_spent: u64,    // 8 bytes (real lamports moved out)
    pub total_service_spent: u64, // 8 bytes (real lamports moved out)
}

impl Vault {
    /// Space = 32 + 32 + 1 + 8 + 8 + 8 = 89 bytes
    pub const SIZE: usize = 32 + 32 + 1 + 8 + 8 + 8;
}

/// Coupon account: represents a single "logical NFT" coupon
/// plus listing data for the secondary market.
#[account]
pub struct Coupon {
    pub campaign: Pubkey,          // 32 bytes - campaign this coupon is linked to
    pub coupon_index: u64,         // 8 bytes  - index within the campaign
    pub owner: Pubkey,             // 32 bytes - current owner of the coupon
    pub used: bool,                // 1 byte   - whether the coupon is already redeemed
    pub listed: bool,              // 1 byte   - whether coupon is listed for sale
    pub sale_price_lamports: u64,  // 8 bytes  - listing price in lamports
}

impl Coupon {
    pub const SIZE: usize = 32 + 8 + 32 + 1 + 1 + 8; // 82 bytes
}





