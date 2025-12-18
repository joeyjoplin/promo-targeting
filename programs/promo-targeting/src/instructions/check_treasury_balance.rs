use anchor_lang::prelude::*;

use crate::states::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct CheckTreasuryBalance<'info> {
    #[account(
        seeds = [b"config"],
        bump,
        has_one = admin
    )]
    pub config: Account<'info, GlobalConfig>,

    pub admin: Signer<'info>,

    /// CHECK: We only read lamports from this account.
    pub platform_treasury: UncheckedAccount<'info>,
}

pub fn check_treasury_balance(ctx: Context<CheckTreasuryBalance>) -> Result<()> {
    let platform_treasury = &ctx.accounts.platform_treasury;
    let lamports = **platform_treasury.to_account_info().lamports.borrow();

    emit!(TreasuryBalance {
        platform_treasury: platform_treasury.key(),
        lamports,
    });

    Ok(())
}

/// Event emitted when checking platform treasury balance.
#[event]
pub struct TreasuryBalance {
    pub platform_treasury: Pubkey,
    pub lamports: u64,
}