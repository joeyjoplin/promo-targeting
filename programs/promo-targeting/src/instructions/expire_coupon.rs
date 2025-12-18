use anchor_lang::prelude::*;

use crate::errors::*;
use crate::states::*;

    /// Expire (burn) a coupon after campaign expiration.
    ///
    /// - Can only be called by the merchant that owns the campaign.
    /// - Campaign must be expired.
    /// - Coupon must belong to this campaign.
    /// - Coupon must not be listed.
    /// - Coupon is closed and rent is returned to the merchant.
    pub fn expire_coupon(ctx: Context<ExpireCoupon>) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        let coupon = &ctx.accounts.coupon;
        let merchant = &ctx.accounts.merchant;

        // Campaign must belong to this merchant
        require_keys_eq!(campaign.merchant, merchant.key(), PromoError::NotMerchant);

        // Campaign must be expired
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp > campaign.expiration_timestamp,
            PromoError::CampaignNotExpired
        );

        // Coupon must not be listed at expiration cleanup
        require!(!coupon.listed, PromoError::CouponListed);

        // We allow expiring both used and unused coupons here.
        // The actual close is handled by `close = merchant` in the accounts struct.
        Ok(())
    }

    /// Expire (burn) a coupon after campaign expiration.
    /// The coupon account is closed and rent is returned to the merchant.
    #[derive(Accounts)]
pub struct ExpireCoupon<'info> {
    #[account(has_one = merchant)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        has_one = campaign @ PromoError::InvalidCouponCampaign,
        close = merchant
    )]
    pub coupon: Account<'info, Coupon>,


    #[account(mut)]
    pub merchant: Signer<'info>,
}
