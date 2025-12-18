use anchor_lang::prelude::*;
use anchor_lang::system_program;
use std::io::Cursor;

use crate::errors::*;
use crate::states::*;

/// Upgrade (or update) the global configuration.
    ///
    /// This instruction allows the admin to migrate legacy config accounts
    /// that were created before `service_fee_bps` existed, as well as update
    /// max_resale_bps / service_fee_bps in a single call.
    pub fn upgrade_config(
        ctx: Context<UpgradeConfig>,
        max_resale_bps: u16,
        service_fee_bps: u16,
    ) -> Result<()> {
        require!(max_resale_bps <= 10_000, PromoError::InvalidBps);
        require!(service_fee_bps <= 10_000, PromoError::InvalidBps);

        let config_info = &ctx.accounts.config;
        let mut data = config_info.try_borrow_mut_data()?;

        const DISCRIMINATOR_LEN: usize = 8;
        const ADMIN_OFFSET: usize = DISCRIMINATOR_LEN;
        const ADMIN_END: usize = ADMIN_OFFSET + 32;

        require!(
            data.len() >= ADMIN_END + 2,
            PromoError::InvalidConfigAccount
        );

        let admin_bytes: [u8; 32] = data[ADMIN_OFFSET..ADMIN_END]
            .try_into()
            .map_err(|_| PromoError::InvalidConfigAccount)?;
        let existing_admin = Pubkey::new_from_array(admin_bytes);

        require_keys_eq!(existing_admin, ctx.accounts.admin.key(), PromoError::NotAdmin);

        let expected_len = DISCRIMINATOR_LEN + GlobalConfig::SIZE;
        if data.len() != expected_len {
            let rent = Rent::get()?;
            let min_balance = rent.minimum_balance(expected_len);
            let current_balance = config_info.lamports();
            if current_balance < min_balance {
                let diff = min_balance
                    .checked_sub(current_balance)
                    .ok_or(PromoError::Overflow)?;
                let transfer_accounts = system_program::Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: ctx.accounts.config.clone(),
                };
                let cpi_ctx =
                    CpiContext::new(ctx.accounts.system_program.to_account_info(), transfer_accounts);
                system_program::transfer(cpi_ctx, diff)?;
            }

            config_info.realloc(expected_len, false)?;
            data = config_info.try_borrow_mut_data()?;
        }

        for byte in data[DISCRIMINATOR_LEN..].iter_mut() {
            *byte = 0;
        }

        let updated = GlobalConfig {
            admin: existing_admin,
            max_resale_bps,
            service_fee_bps,
        };

        let mut cursor = Cursor::new(&mut data[DISCRIMINATOR_LEN..]);
        updated.try_serialize(&mut cursor)?;

        Ok(())
    }

#[derive(Accounts)]
pub struct UpgradeConfig<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump
    )]
    /// CHECK: Legacy configs may not match the latest struct. We verify admin and resize manually.
    pub config: AccountInfo<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}
