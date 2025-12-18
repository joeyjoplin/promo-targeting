use anchor_lang::prelude::*;

use crate::errors::*;
use crate::states::*;

/// List a coupon for sale on the secondary market.
    ///
    /// - Only the current owner can list.
    /// - Coupon must not be used.
    /// - Caller chooses `sale_price_lamports`, but:
    ///   * must be > 0
    ///   * must be <= campaign.max_discount_lamports
    ///   * must be <= max_allowed, where
    ///       max_allowed = max_discount_lamports * resale_bps / 10_000
    pub fn list_coupon_for_sale(
        ctx: Context<ListCouponForSale>,
        sale_price_lamports: u64,
    ) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        let coupon = &mut ctx.accounts.coupon;
        let owner = &ctx.accounts.owner;

        // Ensure owner matches coupon
        require_keys_eq!(coupon.owner, owner.key(), PromoError::NotCouponOwner);

        // Cannot list used coupons
        require!(!coupon.used, PromoError::CouponAlreadyUsed);

        // Prevent double listing
        require!(!coupon.listed, PromoError::CouponAlreadyListed);

        require!(sale_price_lamports > 0, PromoError::InvalidResalePrice);

        // Upper bound: cannot sell the coupon for more than the max discount
        require!(
            sale_price_lamports <= campaign.max_discount_lamports,
            PromoError::InvalidResalePrice
        );

        // Additional bound: apply campaign-level resale_bps (capped by global config)
        let max_allowed = campaign
            .max_discount_lamports
            .checked_mul(campaign.resale_bps as u64)
            .ok_or(PromoError::Overflow)?
            / 10_000;

        require!(
            sale_price_lamports <= max_allowed,
            PromoError::InvalidResalePrice
        );

        coupon.listed = true;
        coupon.sale_price_lamports = sale_price_lamports;

        Ok(())
    }

/// List a coupon for sale (no extra PDA needed, we store listing info on Coupon).
#[derive(Accounts)]
pub struct ListCouponForSale<'info> {
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        has_one = campaign @ PromoError::InvalidCouponCampaign,
        constraint = coupon.owner == owner.key() @ PromoError::NotCouponOwner
    )]
    pub coupon: Account<'info, Coupon>,


    pub owner: Signer<'info>,
}
