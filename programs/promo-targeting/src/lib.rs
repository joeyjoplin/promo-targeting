use anchor_lang::prelude::*;

pub mod errors;
pub use errors::*;

pub mod instructions;
pub use instructions::*;

pub mod states;
pub use states::*;

pub mod utils;
pub use utils::*;

declare_id!("41eti7CsZBWD1QYdor2RnxmqzsaNGpRQCkJQZqX2JEKr");

#[program]
pub mod promo_targeting {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        max_resale_bps: u16,
        service_fee_bps: u16,
    ) -> Result<()> {
        initialize_config::initialize_config(ctx, max_resale_bps, service_fee_bps)
    }

    pub fn upgrade_config(
        ctx: Context<UpgradeConfig>,
        max_resale_bps: u16,
        service_fee_bps: u16,
    ) -> Result<()> {
        upgrade_config::upgrade_config(ctx, max_resale_bps, service_fee_bps)
    }

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
        requires_wallet: bool,
        target_wallet: Pubkey,
    ) -> Result<()> {
        create_campaign::create_campaign(
            ctx,
            campaign_id,
            discount_bps,
            resale_bps,
            expiration_timestamp,
            total_coupons,
            mint_cost_lamports,
            max_discount_lamports,
            category_code,
            product_code,
            campaign_name,
            deposit_amount,
            requires_wallet,
            target_wallet,
        )
    }

    pub fn mint_coupon(
        ctx: Context<MintCoupon>,
        campaign_id: u64,
        coupon_index: u64,
    ) -> Result<()> {
        mint_coupon::mint_coupon(ctx, campaign_id, coupon_index)
    }

    pub fn redeem_coupon(
        ctx: Context<RedeemCoupon>,
        purchase_amount: u64,
        product_code: u16,
    ) -> Result<()> {
        redeem_coupon::redeem_coupon(ctx, purchase_amount, product_code)
    }

    pub fn transfer_coupon(ctx: Context<TransferCoupon>) -> Result<()> {
        transfer_coupon::transfer_coupon(ctx)
    }

    pub fn list_coupon_for_sale(
        ctx: Context<ListCouponForSale>,
        sale_price_lamports: u64,
    ) -> Result<()> {
        list_coupon_for_sale::list_coupon_for_sale(ctx, sale_price_lamports)
    }

    pub fn buy_listed_coupon(ctx: Context<BuyListedCoupon>) -> Result<()> {
        buy_listed_coupon::buy_listed_coupon(ctx)
    }

    pub fn close_campaign_vault(ctx: Context<CloseCampaignVault>) -> Result<()> {
        close_campaign_vault::close_campaign_vault(ctx)
    }

    pub fn expire_coupon(ctx: Context<ExpireCoupon>) -> Result<()> {
        expire_coupon::expire_coupon(ctx)
    }

    pub fn check_treasury_balance(ctx: Context<CheckTreasuryBalance>) -> Result<()> {
        check_treasury_balance::check_treasury_balance(ctx)
    }
}
    



