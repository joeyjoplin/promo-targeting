use anchor_lang::prelude::*;

use crate::utils::*;
use crate::errors::*;
use crate::states::*;

/// Redeem a coupon for a purchase.
    ///
    /// Flow:
    /// - Off-chain: the e-commerce / Solana Pay handles payment with discount.
    /// - On-chain:
    ///   * we mark the coupon as used
    ///   * update `used_coupons`
    ///   * calculate discount and service fee
    ///   * cap the discount by `max_discount_lamports`
    ///   * transfer real lamports equal to the service fee from vault to platform treasury
    ///   * update `total_service_spent` in the vault
    ///   * update campaign analytics (total purchase / discount / last redeem ts)
    ///   * emit an event with all data needed for analytics
    ///   * burn the coupon account (close to user)
    ///
    /// `product_code` argument must match `campaign.product_code`, ensuring
    /// the coupon is only used for the product it was configured for.
    pub fn redeem_coupon(
        ctx: Context<RedeemCoupon>,
        purchase_amount: u64,
        product_code: u16,
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let vault = &mut ctx.accounts.vault;
        let coupon = &mut ctx.accounts.coupon;
        let user = &ctx.accounts.user;
        let platform_treasury = &ctx.accounts.platform_treasury;

        let clock = Clock::get()?;

        // Check campaign expiration
        require!(
            clock.unix_timestamp <= campaign.expiration_timestamp,
            PromoError::CampaignExpired
        );

        // Ensure correct product for this coupon
        require!(
            product_code == campaign.product_code,
            PromoError::InvalidProductForCoupon
        );

        // Safety check for available coupons
        require!(
            campaign.used_coupons < campaign.total_coupons,
            PromoError::NoCouponsLeft
        );

        // Ensure coupon is not already used
        require!(!coupon.used, PromoError::CouponAlreadyUsed);

        // Ensure coupon is not currently listed in the secondary market
        require!(!coupon.listed, PromoError::CouponListed);

        // Ensure coupon owner matches user
        require_keys_eq!(coupon.owner, user.key(), PromoError::NotCouponOwner);

        // Calculate raw discount
        let mut discount_value = purchase_amount
            .checked_mul(campaign.discount_bps as u64)
            .ok_or(PromoError::Overflow)?
            / 10_000;

        // Cap discount by max_discount_lamports
        if discount_value > campaign.max_discount_lamports {
            discount_value = campaign.max_discount_lamports;
        }

        let service_fee_value = discount_value
            .checked_mul(campaign.service_fee_bps as u64)
            .ok_or(PromoError::Overflow)?
            / 10_000;

        // If service fee is > 0, transfer real lamports from vault to treasury
        if service_fee_value > 0 {
            let vault_lamports = **vault.to_account_info().lamports.borrow();
            require!(
                vault_lamports >= service_fee_value,
                PromoError::InsufficientVaultBalance
            );

            transfer_lamports(
                &vault.to_account_info(),
                &platform_treasury.to_account_info(),
                service_fee_value,
            )?;

            vault.total_service_spent = vault
                .total_service_spent
                .checked_add(service_fee_value)
                .ok_or(PromoError::Overflow)?;
        }

        // Mark coupon as used and clear any listing flags
        coupon.used = true;
        coupon.listed = false;
        coupon.sale_price_lamports = 0;

        // Increase used coupons counter
        campaign.used_coupons = campaign
            .used_coupons
            .checked_add(1)
            .ok_or(PromoError::Overflow)?;

        // Update campaign analytics
        campaign.total_purchase_amount = campaign
            .total_purchase_amount
            .checked_add(purchase_amount)
            .ok_or(PromoError::Overflow)?;

        campaign.total_discount_lamports = campaign
            .total_discount_lamports
            .checked_add(discount_value)
            .ok_or(PromoError::Overflow)?;

        campaign.last_redeem_timestamp = clock.unix_timestamp;

        // Emit event so the frontend/indexer can aggregate analytics (ROI, etc.)
        emit!(CouponRedeemed {
            merchant: campaign.merchant,
            campaign: campaign.key(),
            campaign_id: campaign.campaign_id,
            category_code: campaign.category_code,
            product_code: campaign.product_code,
            coupon_index: coupon.coupon_index,
            purchase_amount,
            discount_value,
            service_fee_value,
        });

        // Burn coupon: close account and return rent to user
        // (enforced by `close = user` in the RedeemCoupon accounts struct)
        Ok(())
}

/// Event emitted whenever a coupon is redeemed, enabling off-chain analytics.
#[event]
pub struct CouponRedeemed {
    pub merchant: Pubkey,
    pub campaign: Pubkey,
    pub campaign_id: u64,
    pub category_code: u16,
    pub product_code: u16,
    pub coupon_index: u64,
    pub purchase_amount: u64,
    pub discount_value: u64,
    pub service_fee_value: u64,
}


/// Accounts required to redeem a coupon.
#[derive(Accounts)]
pub struct RedeemCoupon<'info> {
    /// Campaign this coupon belongs to.
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    /// Vault associated with this campaign.
    #[account(
        mut,
        seeds = [
            b"vault",
            campaign.key().as_ref(),
        ],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    /// Coupon to be redeemed.
    ///
    /// `close = user` burns the coupon account after the instruction
    /// completes successfully, sending the rent back to the user.
    #[account(
        mut,
        has_one = campaign @ PromoError::InvalidCouponCampaign,
        constraint = coupon.owner == user.key() @ PromoError::NotCouponOwner,
        close = user
    )]
    pub coupon: Account<'info, Coupon>,

    /// User redeeming the coupon (must be the coupon owner).
    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: This is the platform treasury account that will receive real lamports
    /// from the vault corresponding to the service fee.
    #[account(mut)]
    pub platform_treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
