use anchor_lang::prelude::*;

#[error_code]
pub enum PromoError {
    #[msg("Invalid campaign state")]
    InvalidCampaignState,
    #[msg("Invalid coupon state")]
    InvalidCouponState,
    #[msg("Coupon already used")]
    CouponAlreadyUsed,
    #[msg("Invalid coupon campaign reference")]
    InvalidCouponCampaign,
    #[msg("Signer is not the coupon owner")]
    NotCouponOwner,
    #[msg("Invalid campaign id")]
    InvalidCampaignId,
    #[msg("Insufficient vault balance")]
    InsufficientVaultBalance,
    #[msg("Signer is not the merchant")]
    NotMerchant,
    #[msg("Campaign is not expired yet")]
    CampaignNotExpired,
    #[msg("Signer is not the admin")]
    NotAdmin,
    #[msg("Invalid config account data")]
    InvalidConfigAccount,
    #[msg("Coupon is currently listed")]
    CouponListed,
    #[msg("Coupon is already listed")]
    CouponAlreadyListed,
    #[msg("Coupon is not listed")]
    CouponNotListed,
    #[msg("Invalid resale price")]
    InvalidResalePrice,
    #[msg("Invalid buyer for this coupon")]
    InvalidBuyer,
    #[msg("Target wallet is required for this campaign type")]
    TargetWalletRequired,
    #[msg("User is not eligible for this campaign")]
    NotEligibleForCampaign,
    #[msg("Invalid product for this coupon")]
    InvalidProductForCoupon,
    #[msg("Invalid bps value")]
    InvalidBps,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Invalid total coupons value")]
    InvalidTotalCoupons,
    #[msg("Invalid mint cost")]
    InvalidMintCost,
    #[msg("Invalid max discount")]
    InvalidMaxDiscount,
    #[msg("Invalid deposit amount")]
    InvalidDepositAmount,
    #[msg("Campaign name is too long")]
    NameTooLong,
    #[msg("No coupons left for this campaign")]
    NoCouponsLeft,
    #[msg("Campaign has already expired")]
    CampaignExpired,
}
