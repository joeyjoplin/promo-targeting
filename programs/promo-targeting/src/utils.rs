use anchor_lang::prelude::*;

use crate::errors::PromoError;

pub fn transfer_lamports<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let from_lamports = **from.lamports.borrow();
    require!(
        from_lamports >= amount,
        PromoError::InsufficientVaultBalance
    );

    let to_lamports = **to.lamports.borrow();

    let new_from = from_lamports
        .checked_sub(amount)
        .ok_or(PromoError::Overflow)?;
    let new_to = to_lamports
        .checked_add(amount)
        .ok_or(PromoError::Overflow)?;

    **from.try_borrow_mut_lamports()? = new_from;
    **to.try_borrow_mut_lamports()? = new_to;

    Ok(())
}