use anchor_lang::prelude::*;

use crate::errors::*;
use crate::states::*;

    /// Close the campaign vault and return remaining budget to the merchant
    /// after campaign expiration.
    ///
    /// - Mint costs and service fees have already been transferred to the
    ///   platform treasury at each operation.
    /// - Remaining lamports in the vault (if any) are returned to the merchant.
    /// - The campaign account stays alive for historical analytics.
    pub fn close_campaign_vault(ctx: Context<CloseCampaignVault>) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        let merchant = &ctx.accounts.merchant;

        // Campaign must belong to this merchant
        require_keys_eq!(campaign.merchant, merchant.key(), PromoError::NotMerchant);

        // Campaign must be expired
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp > campaign.expiration_timestamp,
            PromoError::CampaignNotExpired
        );

        Ok(())
    }

    /// Close the vault after campaign expiration, refunding remaining lamports to the merchant.
    #[derive(Accounts)]
    pub struct CloseCampaignVault<'info> {
    /// Campaign associated with the vault. Kept alive for history/analytics.
    #[account(has_one = merchant)]
    pub campaign: Account<'info, Campaign>,

    /// Vault to be closed. Remaining lamports go to `merchant`.
    #[account(
        mut,
        seeds = [
            b"vault",
            campaign.key().as_ref(),
        ],
        bump = vault.bump,
        close = merchant
    )]
    pub vault: Account<'info, Vault>,


    /// Merchant receiving the remaining lamports from the vault.
    #[account(mut)]
    pub merchant: Signer<'info>,


    pub system_program: Program<'info, System>,
    }
