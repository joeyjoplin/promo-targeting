use anchor_lang::prelude::*;

use crate::errors::*;
use crate::states::*;

 /// Initialize global configuration for the protocol.
    ///
    /// This should be called once by the protocol owner (admin) after deploy.
    /// - `max_resale_bps` defines the maximum percentage (over max_discount_lamports)
    ///   that each campaign can use as `resale_bps` to cap secondary prices.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        max_resale_bps: u16,
        service_fee_bps: u16,
    ) -> Result<()> {
        require!(max_resale_bps <= 10_000, PromoError::InvalidBps);
        require!(service_fee_bps <= 10_000, PromoError::InvalidBps);

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.max_resale_bps = max_resale_bps;
        config.service_fee_bps = service_fee_bps;

        Ok(())
    }

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + GlobalConfig::SIZE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}