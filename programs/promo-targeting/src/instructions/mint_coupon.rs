use anchor_lang::prelude::*;

use crate::errors::*;
use crate::states::*;
use crate::utils::*;

/// Merchant mints a coupon for a recipient.
    ///
    /// Targeting rules:
    /// - If `campaign.requires_wallet == false`:
    ///   * `recipient` can be any wallet (open campaign).
    /// - If `campaign.requires_wallet == true`:
    ///   * `recipient` MUST match `campaign.target_wallet`.
    ///
    /// Additionally:
    /// - Creates a logical "NFT-like" coupon account.
    /// - Transfers `mint_cost_lamports` in real lamports from the campaign vault
    ///   to the platform treasury using a custom lamports transfer helper.
    /// - Updates vault accounting (`total_mint_spent`).
    pub fn mint_coupon(
        ctx: Context<MintCoupon>,
        campaign_id: u64,
        coupon_index: u64,
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let vault = &mut ctx.accounts.vault;
        let coupon = &mut ctx.accounts.coupon;
        let recipient = &ctx.accounts.recipient;
        let platform_treasury = &ctx.accounts.platform_treasury;

        // Ensure the campaign id matches (safety)
        require!(
            campaign.campaign_id == campaign_id,
            PromoError::InvalidCampaignId
        );

        // Ensure we do not exceed the total number of coupons configured for this campaign
        require!(
            campaign.minted_coupons < campaign.total_coupons,
            PromoError::NoCouponsLeft
        );

        let mint_cost = campaign.mint_cost_lamports;
        require!(mint_cost > 0, PromoError::InvalidMintCost);

        // Enforce targeting logic:
        // - If requires_wallet == true, only the configured target_wallet can receive coupons.
        if campaign.requires_wallet {
            require_keys_eq!(
                recipient.key(),
                campaign.target_wallet,
                PromoError::NotEligibleForCampaign
            );
        }

        // Check if vault has enough lamports for mint cost (real SOL check)
        let vault_lamports = **vault.to_account_info().lamports.borrow();
        require!(
            vault_lamports >= mint_cost,
            PromoError::InsufficientVaultBalance
        );

        // Transfer real lamports from vault PDA to platform treasury.
        transfer_lamports(
            &vault.to_account_info(),
            &platform_treasury.to_account_info(),
            mint_cost,
        )?;

        // Update vault analytics (logical mint spending)
        vault.total_mint_spent = vault
            .total_mint_spent
            .checked_add(mint_cost)
            .ok_or(PromoError::Overflow)?;

        // Initialize coupon fields
        coupon.campaign = campaign.key();
        coupon.coupon_index = coupon_index;
        coupon.owner = recipient.key();
        coupon.used = false;
        coupon.listed = false;
        coupon.sale_price_lamports = 0;

        // Update campaign minted count
        campaign.minted_coupons = campaign
            .minted_coupons
            .checked_add(1)
            .ok_or(PromoError::Overflow)?;

        Ok(())
    }

#[derive(Accounts)]
#[instruction(campaign_id: u64, coupon_index: u64)]
pub struct MintCoupon<'info> {
    /// Campaign PDA for this coupon.
    #[account(
        mut,
        seeds = [
            b"campaign",
            merchant.key().as_ref(),
            &campaign_id.to_le_bytes(),
        ],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    /// Vault PDA associated with this campaign.
    #[account(
        mut,
        seeds = [
            b"vault",
            campaign.key().as_ref(),
        ],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,


    /// Coupon PDA. One PDA per (campaign, coupon_index).
    #[account(
        init,
        payer = merchant,
        space = 8 + Coupon::SIZE,
        seeds = [
            b"coupon",
            campaign.key().as_ref(),
            &coupon_index.to_le_bytes(),
        ],
        bump
    )]
    pub coupon: Account<'info, Coupon>,


    /// Merchant paying for the account creation (rent).
    #[account(mut)]
    pub merchant: Signer<'info>,


    /// CHECK: This is the wallet that will receive the coupon. We only read its public key.
    pub recipient: UncheckedAccount<'info>,


    /// CHECK: This is the platform treasury account that will receive real lamports
    /// from the vault (mint cost and service fees).
    #[account(mut)]
    pub platform_treasury: UncheckedAccount<'info>,


    pub system_program: Program<'info, System>,
}
