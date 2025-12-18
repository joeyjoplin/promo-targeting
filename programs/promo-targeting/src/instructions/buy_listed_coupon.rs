use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::errors::*;
use crate::states::*;

/// Buy a listed coupon.
    ///
    /// - Buyer pays SOL (lamports) directly to the seller.
    /// - Ownership of the coupon is updated.
    /// - Listing is cleared.
    ///
    /// Safety:
    /// - Enforces that `coupon.sale_price_lamports` is still within
    ///   the allowed bounds relative to `max_discount_lamports` and `resale_bps`.
    pub fn buy_listed_coupon(ctx: Context<BuyListedCoupon>) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        let coupon = &mut ctx.accounts.coupon;
        let seller = &ctx.accounts.seller;
        let buyer = &ctx.accounts.buyer;
        let system_program = &ctx.accounts.system_program;

        // Coupon must belong to this campaign (safety)
        require_keys_eq!(
            coupon.campaign,
            campaign.key(),
            PromoError::InvalidCouponCampaign
        );

        // Must be listed
        require!(coupon.listed, PromoError::CouponNotListed);

        // Seller must be current owner
        require_keys_eq!(coupon.owner, seller.key(), PromoError::NotCouponOwner);

        // Cannot buy your own coupon
        require!(buyer.key() != seller.key(), PromoError::InvalidBuyer);

        // Validate sale price is within allowed bounds
        let sale_price = coupon.sale_price_lamports;
        require!(sale_price > 0, PromoError::InvalidResalePrice);

        require!(
            sale_price <= campaign.max_discount_lamports,
            PromoError::InvalidResalePrice
        );

        let max_allowed = campaign
            .max_discount_lamports
            .checked_mul(campaign.resale_bps as u64)
            .ok_or(PromoError::Overflow)?
            / 10_000;
        require!(sale_price <= max_allowed, PromoError::InvalidResalePrice);

        // Transfer lamports from buyer to seller using the System Program
        let cpi_accounts = system_program::Transfer {
            from: buyer.to_account_info(),
            to: seller.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(system_program.to_account_info(), cpi_accounts);
        system_program::transfer(cpi_ctx, sale_price)?;

        // Update coupon ownership and clear listing
        coupon.owner = buyer.key();
        coupon.listed = false;
        coupon.sale_price_lamports = 0;

        Ok(())
    }

    /// Buy a previously listed coupon using SOL.
    #[derive(Accounts)]
    pub struct BuyListedCoupon<'info> {
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        has_one = campaign @ PromoError::InvalidCouponCampaign
    )]
    pub coupon: Account<'info, Coupon>,


    /// CHECK: Seller is an unchecked account because we only compare
    /// its public key against `coupon.owner` and receive lamports.
    /// No PDA derivation or data deserialization is required.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,


    /// Buyer paying SOL and receiving the coupon.
    /// Must be mutable because lamports are debited in the CPI transfer.
    #[account(mut)]
    pub buyer: Signer<'info>,


    pub system_program: Program<'info, System>,
    }
