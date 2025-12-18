use anchor_lang::prelude::*;

use crate::errors::*;
use crate::states::*;

/// Transfer a coupon (P2P) from the current owner to a new owner.
///
/// This is the primitive for off-market transfers.
/// Any existing listing is cleared when the owner changes.
pub fn transfer_coupon(ctx: Context<TransferCoupon>) -> Result<()> {
    let coupon = &mut ctx.accounts.coupon;
    let new_owner = &ctx.accounts.new_owner;

    coupon.owner = new_owner.key();
    coupon.listed = false;
    coupon.sale_price_lamports = 0;

    Ok(())
}

/// Accounts for transferring coupon ownership between users.
#[derive(Accounts)]
pub struct TransferCoupon<'info> {
    /// Coupon whose ownership is being transferred.
    #[account(
        mut,
        constraint = coupon.owner == current_owner.key() @ PromoError::NotCouponOwner
    )]
    pub coupon: Account<'info, Coupon>,


    /// Current owner of the coupon (must sign the transfer).
    pub current_owner: Signer<'info>,


    /// CHECK: This is the new coupon owner. We only read the public key.
    pub new_owner: UncheckedAccount<'info>,
}
