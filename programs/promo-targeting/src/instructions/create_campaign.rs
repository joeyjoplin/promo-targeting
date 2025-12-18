use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::errors::*;
use crate::states::*;

/// Merchant creates a new discount campaign and funds a vault for it.
    ///
    /// Business logic:
    /// - The merchant deposits a budget into a dedicated vault.
    /// - This vault is used to:
    ///   * pay minting costs for each coupon (to the platform treasury)
    ///   * pay service fees (percentage over the discount defined in GlobalConfig) to the platform treasury
    /// - Each campaign also defines:
    ///   * a max discount value in lamports (max_discount_lamports)
    ///   * a resale_bps (capped by GlobalConfig.max_resale_bps) that defines
    ///     the maximum secondary market price as a percentage of max_discount_lamports.
    ///
    /// Targeting model (MVP):
    /// - `requires_wallet = false`:
    ///     * Open campaign, no specific target wallet required.
    ///     * Used for "All users" / marketplace airdrops.
    /// - `requires_wallet = true`:
    ///     * Targeted campaign that requires a specific `target_wallet`.
    ///     * Only this wallet will be able to receive minted coupons on-chain.
    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        campaign_id: u64,
        discount_bps: u16,
        resale_bps: u16,
        expiration_timestamp: i64,
        total_coupons: u32,
        mint_cost_lamports: u64,
        max_discount_lamports: u64,
        category_code: u16,
        product_code: u16,
        campaign_name: String,
        deposit_amount: u64,
        requires_wallet: bool, // false = All users, true = targeted
        target_wallet: Pubkey, // only relevant if requires_wallet = true
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let campaign = &mut ctx.accounts.campaign;
        let vault = &mut ctx.accounts.vault;
        let merchant = &ctx.accounts.merchant;

        // Basic validation for inputs
        require!(discount_bps <= 10_000, PromoError::InvalidBps);
        require!(resale_bps <= 10_000, PromoError::InvalidBps);
        require!(total_coupons > 0, PromoError::InvalidTotalCoupons);
        require!(mint_cost_lamports > 0, PromoError::InvalidMintCost);
        require!(max_discount_lamports > 0, PromoError::InvalidMaxDiscount);
        require!(deposit_amount > 0, PromoError::InvalidDepositAmount);

        // Enforce resale_bps policy defined by the admin in GlobalConfig
        require!(
            resale_bps <= config.max_resale_bps,
            PromoError::InvalidResalePrice
        );

        // If the campaign requires a wallet, dashboard/frontend must provide a non-default target wallet.
        if requires_wallet {
            require!(
                target_wallet != Pubkey::default(),
                PromoError::TargetWalletRequired
            );
        }

        // Enforce a maximum length for the campaign name (in bytes)
        require!(
            campaign_name.as_bytes().len() <= Campaign::MAX_NAME_LEN,
            PromoError::NameTooLong
        );

        // Initialize campaign fields
        campaign.merchant = merchant.key();
        campaign.campaign_id = campaign_id;
        campaign.discount_bps = discount_bps;
        campaign.service_fee_bps = config.service_fee_bps;
        campaign.resale_bps = resale_bps;
        campaign.expiration_timestamp = expiration_timestamp;
        campaign.total_coupons = total_coupons;
        campaign.used_coupons = 0;
        campaign.minted_coupons = 0;
        campaign.mint_cost_lamports = mint_cost_lamports;
        campaign.max_discount_lamports = max_discount_lamports;
        campaign.category_code = category_code;
        campaign.product_code = product_code;
        campaign.campaign_name = campaign_name;
        campaign.requires_wallet = requires_wallet;
        campaign.target_wallet = if requires_wallet {
            target_wallet
        } else {
            Pubkey::default()
        };

        // Analytics helpers
        campaign.total_purchase_amount = 0;
        campaign.total_discount_lamports = 0;
        campaign.last_redeem_timestamp = 0;

        // Initialize vault fields
        vault.campaign = campaign.key();
        vault.merchant = merchant.key();
        vault.bump = ctx.bumps.vault;
        vault.total_deposit = deposit_amount;
        vault.total_mint_spent = 0;
        vault.total_service_spent = 0;

        // Transfer lamports from merchant (system account) to vault (program-owned PDA).
        let cpi_accounts = system_program::Transfer {
            from: merchant.to_account_info(),
            to: vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
        system_program::transfer(cpi_ctx, deposit_amount)?;

        Ok(())
    }

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct CreateCampaign<'info> {
    /// Global config – defines policy for campaigns (including max_resale_bps).
    #[account(
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, GlobalConfig>,


    /// Campaign account PDA. One PDA per (merchant, campaign_id).
    #[account(
        init,
        payer = merchant,
        space = 8 + Campaign::SIZE,
        seeds = [
            b"campaign",
            merchant.key().as_ref(),
            &campaign_id.to_le_bytes(),
        ],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    /// Vault PDA that holds the campaign budget and accounting.
    #[account(
        init,
        payer = merchant,
        space = 8 + Vault::SIZE,
        seeds = [
            b"vault",
            campaign.key().as_ref(),
        ],
        bump
    )]
    pub vault: Account<'info, Vault>,


    /// Merchant funding the campaign.
    #[account(mut)]
    pub merchant: Signer<'info>,

    pub system_program: Program<'info, System>,
}