use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("275CL3mEoiKubGcPic1C488aHVqPGcM6gesJADidsoNB");

#[program]
pub mod promoTargeting {
    use super::*;

    /// Initialize global configuration for the protocol.
    ///
    /// This should be called once by the protocol owner (admin) after deploy.
    /// - `max_resale_bps` defines the maximum percentage (over max_discount_lamports)
    ///   that each campaign can use as `resale_bps` to cap secondary prices.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        max_resale_bps: u16,
    ) -> Result<()> {
        require!(max_resale_bps <= 10_000, CustomError::InvalidBps);

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.max_resale_bps = max_resale_bps;

        Ok(())
    }

    /// Merchant creates a new discount campaign and funds a vault for it.
    ///
    /// Business logic:
    /// - The merchant deposits a budget into a dedicated vault.
    /// - This vault is used to:
    ///   * pay minting costs for each coupon (to the platform treasury)
    ///   * pay service fees (a percentage over the discount) to the platform treasury
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
        service_fee_bps: u16,
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
        require!(discount_bps <= 10_000, CustomError::InvalidBps);
        require!(service_fee_bps <= 10_000, CustomError::InvalidBps);
        require!(resale_bps <= 10_000, CustomError::InvalidBps);
        require!(total_coupons > 0, CustomError::InvalidTotalCoupons);
        require!(mint_cost_lamports > 0, CustomError::InvalidMintCost);
        require!(max_discount_lamports > 0, CustomError::InvalidMaxDiscount);
        require!(deposit_amount > 0, CustomError::InvalidDepositAmount);

        // Enforce resale_bps policy defined by the admin in GlobalConfig
        require!(
            resale_bps <= config.max_resale_bps,
            CustomError::InvalidResalePrice
        );

        // If the campaign requires a wallet, dashboard/frontend must provide a non-default target wallet.
        if requires_wallet {
            require!(
                target_wallet != Pubkey::default(),
                CustomError::TargetWalletRequired
            );
        }

        // Enforce a maximum length for the campaign name (in bytes)
        require!(
            campaign_name.as_bytes().len() <= Campaign::MAX_NAME_LEN,
            CustomError::NameTooLong
        );

        // Initialize campaign fields
        campaign.merchant = merchant.key();
        campaign.campaign_id = campaign_id;
        campaign.discount_bps = discount_bps;
        campaign.service_fee_bps = service_fee_bps;
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
            CustomError::InvalidCampaignId
        );

        // Ensure we do not exceed the total number of coupons configured for this campaign
        require!(
            campaign.minted_coupons < campaign.total_coupons,
            CustomError::NoCouponsLeft
        );

        let mint_cost = campaign.mint_cost_lamports;
        require!(mint_cost > 0, CustomError::InvalidMintCost);

        // Enforce targeting logic:
        // - If requires_wallet == true, only the configured target_wallet can receive coupons.
        if campaign.requires_wallet {
            require_keys_eq!(
                recipient.key(),
                campaign.target_wallet,
                CustomError::NotEligibleForCampaign
            );
        }

        // Check if vault has enough lamports for mint cost (real SOL check)
        let vault_lamports = **vault.to_account_info().lamports.borrow();
        require!(
            vault_lamports >= mint_cost,
            CustomError::InsufficientVaultBalance
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
            .ok_or(CustomError::Overflow)?;

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
            .ok_or(CustomError::Overflow)?;

        Ok(())
    }

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
            CustomError::CampaignExpired
        );

        // Ensure correct product for this coupon
        require!(
            product_code == campaign.product_code,
            CustomError::InvalidProductForCoupon
        );

        // Safety check for available coupons
        require!(
            campaign.used_coupons < campaign.total_coupons,
            CustomError::NoCouponsLeft
        );

        // Ensure coupon is not already used
        require!(!coupon.used, CustomError::CouponAlreadyUsed);

        // Ensure coupon is not currently listed in the secondary market
        require!(!coupon.listed, CustomError::CouponListed);

        // Ensure coupon owner matches user
        require_keys_eq!(coupon.owner, user.key(), CustomError::NotCouponOwner);

        // Calculate raw discount
        let mut discount_value = purchase_amount
            .checked_mul(campaign.discount_bps as u64)
            .ok_or(CustomError::Overflow)?
            / 10_000;

        // Cap discount by max_discount_lamports
        if discount_value > campaign.max_discount_lamports {
            discount_value = campaign.max_discount_lamports;
        }

        let service_fee_value = discount_value
            .checked_mul(campaign.service_fee_bps as u64)
            .ok_or(CustomError::Overflow)?
            / 10_000;

        // If service fee is > 0, transfer real lamports from vault to treasury
        if service_fee_value > 0 {
            let vault_lamports = **vault.to_account_info().lamports.borrow();
            require!(
                vault_lamports >= service_fee_value,
                CustomError::InsufficientVaultBalance
            );

            transfer_lamports(
                &vault.to_account_info(),
                &platform_treasury.to_account_info(),
                service_fee_value,
            )?;

            vault.total_service_spent = vault
                .total_service_spent
                .checked_add(service_fee_value)
                .ok_or(CustomError::Overflow)?;
        }

        // Mark coupon as used and clear any listing flags
        coupon.used = true;
        coupon.listed = false;
        coupon.sale_price_lamports = 0;

        // Increase used coupons counter
        campaign.used_coupons = campaign
            .used_coupons
            .checked_add(1)
            .ok_or(CustomError::Overflow)?;

        // Update campaign analytics
        campaign.total_purchase_amount = campaign
            .total_purchase_amount
            .checked_add(purchase_amount)
            .ok_or(CustomError::Overflow)?;

        campaign.total_discount_lamports = campaign
            .total_discount_lamports
            .checked_add(discount_value)
            .ok_or(CustomError::Overflow)?;

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

    /// List a coupon for sale on the secondary market.
    ///
    /// - Only the current owner can list.
    /// - Coupon must not be used.
    /// - Caller chooses `sale_price_lamports`, but:
    ///   * must be > 0
    ///   * must be <= campaign.max_discount_lamports
    ///   * must be <= max_allowed, where
    ///       max_allowed = max_discount_lamports * resale_bps / 10_000
    pub fn list_coupon_for_sale(
        ctx: Context<ListCouponForSale>,
        sale_price_lamports: u64,
    ) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        let coupon = &mut ctx.accounts.coupon;
        let owner = &ctx.accounts.owner;

        // Ensure owner matches coupon
        require_keys_eq!(coupon.owner, owner.key(), CustomError::NotCouponOwner);

        // Cannot list used coupons
        require!(!coupon.used, CustomError::CouponAlreadyUsed);

        // Prevent double listing
        require!(!coupon.listed, CustomError::CouponAlreadyListed);

        require!(sale_price_lamports > 0, CustomError::InvalidResalePrice);

        // Upper bound: cannot sell the coupon for more than the max discount
        require!(
            sale_price_lamports <= campaign.max_discount_lamports,
            CustomError::InvalidResalePrice
        );

        // Additional bound: apply campaign-level resale_bps (capped by global config)
        let max_allowed = campaign
            .max_discount_lamports
            .checked_mul(campaign.resale_bps as u64)
            .ok_or(CustomError::Overflow)?
            / 10_000;

        require!(
            sale_price_lamports <= max_allowed,
            CustomError::InvalidResalePrice
        );

        coupon.listed = true;
        coupon.sale_price_lamports = sale_price_lamports;

        Ok(())
    }

    /// Buy a listed coupon.
    ///
    /// - Buyer pays SOL (lamports) directly to the seller.
    /// - Ownership of the coupon is updated.
    /// - Listing is cleared.
    ///
    /// Safety:
    /// - Enforces that `coupon.sale_price_lamports` is still within
    ///   the allowed bounds relative to `max_discount_lamports` and `resale_bps`.
    pub fn buy_listed_coupon(ctx: Context<BuyListedCoupon>) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        let coupon = &mut ctx.accounts.coupon;
        let seller = &ctx.accounts.seller;
        let buyer = &ctx.accounts.buyer;
        let system_program = &ctx.accounts.system_program;

        // Coupon must belong to this campaign (safety)
        require_keys_eq!(
            coupon.campaign,
            campaign.key(),
            CustomError::InvalidCouponCampaign
        );

        // Must be listed
        require!(coupon.listed, CustomError::CouponNotListed);

        // Seller must be current owner
        require_keys_eq!(coupon.owner, seller.key(), CustomError::NotCouponOwner);

        // Cannot buy your own coupon
        require!(buyer.key() != seller.key(), CustomError::InvalidBuyer);

        // Validate sale price is within allowed bounds
        let sale_price = coupon.sale_price_lamports;
        require!(sale_price > 0, CustomError::InvalidResalePrice);

        require!(
            sale_price <= campaign.max_discount_lamports,
            CustomError::InvalidResalePrice
        );

        let max_allowed = campaign
            .max_discount_lamports
            .checked_mul(campaign.resale_bps as u64)
            .ok_or(CustomError::Overflow)?
            / 10_000;
        require!(sale_price <= max_allowed, CustomError::InvalidResalePrice);

        // Transfer lamports from buyer to seller using the System Program
        let cpi_accounts = system_program::Transfer {
            from: buyer.to_account_info(),
            to: seller.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(system_program.to_account_info(), cpi_accounts);
        system_program::transfer(cpi_ctx, sale_price)?;

        // Update coupon ownership and clear listing
        coupon.owner = buyer.key();
        coupon.listed = false;
        coupon.sale_price_lamports = 0;

        Ok(())
    }

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
        require_keys_eq!(campaign.merchant, merchant.key(), CustomError::NotMerchant);

        // Campaign must be expired
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp > campaign.expiration_timestamp,
            CustomError::CampaignNotExpired
        );

        Ok(())
    }

    /// Expire (burn) a coupon after campaign expiration.
    ///
    /// - Can only be called by the merchant that owns the campaign.
    /// - Campaign must be expired.
    /// - Coupon must belong to this campaign.
    /// - Coupon must not be listed.
    /// - Coupon is closed and rent is returned to the merchant.
    pub fn expire_coupon(ctx: Context<ExpireCoupon>) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        let coupon = &ctx.accounts.coupon;
        let merchant = &ctx.accounts.merchant;

        // Campaign must belong to this merchant
        require_keys_eq!(campaign.merchant, merchant.key(), CustomError::NotMerchant);

        // Campaign must be expired
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp > campaign.expiration_timestamp,
            CustomError::CampaignNotExpired
        );

        // Coupon must not be listed at expiration cleanup
        require!(!coupon.listed, CustomError::CouponListed);

        // We allow expiring both used and unused coupons here.
        // The actual close is handled by `close = merchant` in the accounts struct.
        Ok(())
    }

    /// Helper: check the balance of the platform treasury.
    ///
    /// - Only the admin from GlobalConfig can call this.
    /// - Emits a TreasuryBalance event with the current lamports.
    pub fn check_treasury_balance(ctx: Context<CheckTreasuryBalance>) -> Result<()> {
        let platform_treasury = &ctx.accounts.platform_treasury;
        let lamports = **platform_treasury.to_account_info().lamports.borrow();

        emit!(TreasuryBalance {
            platform_treasury: platform_treasury.key(),
            lamports,
        });

        Ok(())
    }
}

// ---------------------------
// Accounts: Instructions
// ---------------------------

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
        has_one = campaign @ CustomError::InvalidCouponCampaign,
        constraint = coupon.owner == user.key() @ CustomError::NotCouponOwner,
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

/// Accounts for transferring coupon ownership between users.
#[derive(Accounts)]
pub struct TransferCoupon<'info> {
    /// Coupon whose ownership is being transferred.
    #[account(
        mut,
        constraint = coupon.owner == current_owner.key() @ CustomError::NotCouponOwner
    )]
    pub coupon: Account<'info, Coupon>,


    /// Current owner of the coupon (must sign the transfer).
    pub current_owner: Signer<'info>,


    /// CHECK: This is the new coupon owner. We only read the public key.
    pub new_owner: UncheckedAccount<'info>,
}

/// List a coupon for sale (no extra PDA needed, we store listing info on Coupon).
#[derive(Accounts)]
pub struct ListCouponForSale<'info> {
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        has_one = campaign @ CustomError::InvalidCouponCampaign,
        constraint = coupon.owner == owner.key() @ CustomError::NotCouponOwner
    )]
    pub coupon: Account<'info, Coupon>,


    pub owner: Signer<'info>,
}

/// Buy a previously listed coupon using SOL.
#[derive(Accounts)]
pub struct BuyListedCoupon<'info> {
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        has_one = campaign @ CustomError::InvalidCouponCampaign
    )]
    pub coupon: Account<'info, Coupon>,


    /// CHECK: Seller is an unchecked account because we only compare
    /// its public key against `coupon.owner` and receive lamports.
    /// No PDA derivation or data deserialization is required.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,


    /// Buyer paying SOL and receiving the coupon.
    /// Must be mutable because lamports are debited in the CPI transfer.
    #[account(mut)]
    pub buyer: Signer<'info>,


    pub system_program: Program<'info, System>,
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

/// Expire (burn) a coupon after campaign expiration.
/// The coupon account is closed and rent is returned to the merchant.
#[derive(Accounts)]
pub struct ExpireCoupon<'info> {
    #[account(has_one = merchant)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        has_one = campaign @ CustomError::InvalidCouponCampaign,
        close = merchant
    )]
    pub coupon: Account<'info, Coupon>,


    #[account(mut)]
    pub merchant: Signer<'info>,
}

/// Helper to check platform treasury balance.
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

// ---------------------------
// Accounts: State
// ---------------------------

/// Global configuration for the protocol.
#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,       // 32 bytes - who is allowed to update config / call admin helpers
    pub max_resale_bps: u16, // 2 bytes  - maximum resale_bps allowed per campaign
}

impl GlobalConfig {
    pub const SIZE: usize = 32 + 2;
}

/// Campaign account: stores all campaign parameters and summary stats.
#[account]
pub struct Campaign {
    pub merchant: Pubkey,            // 32 bytes
    pub campaign_id: u64,            // 8 bytes
    pub discount_bps: u16,           // 2 bytes
    pub service_fee_bps: u16,        // 2 bytes (over discount)
    pub resale_bps: u16,             // 2 bytes (over max discount, for secondary cap)
    pub expiration_timestamp: i64,   // 8 bytes
    pub total_coupons: u32,          // 4 bytes
    pub used_coupons: u32,           // 4 bytes
    pub minted_coupons: u32,         // 4 bytes
    pub mint_cost_lamports: u64,     // 8 bytes
    pub max_discount_lamports: u64,  // 8 bytes
    pub category_code: u16,          // 2 bytes
    pub product_code: u16,           // 2 bytes
    // String in account: 4 bytes for length + MAX_NAME_LEN bytes reserved
    pub campaign_name: String,       // 4 + MAX_NAME_LEN bytes
    // Targeting metadata
    pub requires_wallet: bool,       // 1 byte - whether campaign enforces a target wallet
    pub target_wallet: Pubkey,       // 32 bytes - eligible wallet for targeted campaigns
    // Aggregated analytics
    pub total_purchase_amount: u64,      // 8 bytes - sum of all purchase_amount in redeem
    pub total_discount_lamports: u64,    // 8 bytes - sum of all discount_value in redeem
    pub last_redeem_timestamp: i64,      // 8 bytes - last time a coupon was redeemed
}

impl Campaign {
    pub const MAX_NAME_LEN: usize = 64;

    /// Space calculation:
    /// - merchant: 32
    /// - campaign_id: 8
    /// - discount_bps: 2
    /// - service_fee_bps: 2
    /// - resale_bps: 2
    /// - expiration_timestamp: 8
    /// - total_coupons: 4
    /// - used_coupons: 4
    /// - minted_coupons: 4
    /// - mint_cost_lamports: 8
    /// - max_discount_lamports: 8
    /// - category_code: 2
    /// - product_code: 2
    /// - campaign_name: 4 (len) + MAX_NAME_LEN
    /// - requires_wallet: 1
    /// - target_wallet: 32
    /// - total_purchase_amount: 8
    /// - total_discount_lamports: 8
    /// - last_redeem_timestamp: 8
    ///
    /// Total = 32 + 8 + 2 + 2 + 2 + 8 + 4 + 4 + 4 + 8 + 8
    ///       + 2 + 2 + 4 + MAX_NAME_LEN + 1 + 32 + 8 + 8 + 8
    pub const SIZE: usize = 32
        + 8
        + 2
        + 2
        + 2
        + 8
        + 4
        + 4
        + 4
        + 8
        + 8
        + 2
        + 2
        + 4
        + Self::MAX_NAME_LEN
        + 1
        + 32
        + 8
        + 8
        + 8;
}

/// Vault account: holds the campaign budget and accounting.
#[account]
pub struct Vault {
    pub campaign: Pubkey,         // 32 bytes
    pub merchant: Pubkey,         // 32 bytes
    pub bump: u8,                 // 1 byte
    pub total_deposit: u64,       // 8 bytes
    pub total_mint_spent: u64,    // 8 bytes (real lamports moved out)
    pub total_service_spent: u64, // 8 bytes (real lamports moved out)
}

impl Vault {
    /// Space = 32 + 32 + 1 + 8 + 8 + 8 = 89 bytes
    pub const SIZE: usize = 32 + 32 + 1 + 8 + 8 + 8;
}

/// Coupon account: represents a single "logical NFT" coupon
/// plus listing data for the secondary market.
#[account]
pub struct Coupon {
    pub campaign: Pubkey,          // 32 bytes - campaign this coupon is linked to
    pub coupon_index: u64,         // 8 bytes  - index within the campaign
    pub owner: Pubkey,             // 32 bytes - current owner of the coupon
    pub used: bool,                // 1 byte   - whether the coupon is already redeemed
    pub listed: bool,              // 1 byte   - whether coupon is listed for sale
    pub sale_price_lamports: u64,  // 8 bytes  - listing price in lamports
}

impl Coupon {
    pub const SIZE: usize = 32 + 8 + 32 + 1 + 1 + 8; // 82 bytes
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

/// Event emitted when checking platform treasury balance.
#[event]
pub struct TreasuryBalance {
    pub platform_treasury: Pubkey,
    pub lamports: u64,
}

#[error_code]
pub enum CustomError {
    #[msg("Invalid basis points value")]
    InvalidBps,
    #[msg("Invalid total coupons value")]
    InvalidTotalCoupons,
    #[msg("Invalid mint cost")]
    InvalidMintCost,
    #[msg("Invalid deposit amount")]
    InvalidDepositAmount,
    #[msg("Invalid max discount amount")]
    InvalidMaxDiscount,
    #[msg("Campaign is expired")]
    CampaignExpired,
    #[msg("No coupons left in this campaign")]
    NoCouponsLeft,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Campaign name is too long")]
    NameTooLong,
    #[msg("Coupon is already used")]
    CouponAlreadyUsed,
    #[msg("Invalid coupon campaign reference")]
    InvalidCouponCampaign,
    #[msg("Signer is not the coupon owner")]
    NotCouponOwner,
    #[msg("Invalid campaign id")]
    InvalidCampaignId,
    #[msg("Insufficient vault balance")]
    InsufficientVaultBalance,
    #[msg("Signer is not the merchant")]
    NotMerchant,
    #[msg("Campaign is not expired yet")]
    CampaignNotExpired,
    #[msg("Coupon is currently listed")]
    CouponListed,
    #[msg("Coupon is already listed")]
    CouponAlreadyListed,
    #[msg("Coupon is not listed")]
    CouponNotListed,
    #[msg("Invalid resale price")]
    InvalidResalePrice,
    #[msg("Invalid buyer for this coupon")]
    InvalidBuyer,
    #[msg("Target wallet is required for this campaign type")]
    TargetWalletRequired,
    #[msg("User is not eligible for this campaign")]
    NotEligibleForCampaign,
    #[msg("Invalid product for this coupon")]
    InvalidProductForCoupon,
}

/// Helper function to transfer lamports from one account to another
/// without invoking the System Program.
///
/// This is required when the `from` account carries data (e.g. a PDA
/// owned by this program), which cannot be used as `from` in
/// `system_program::transfer`.
fn transfer_lamports<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let from_lamports = **from.lamports.borrow();
    require!(
        from_lamports >= amount,
        CustomError::InsufficientVaultBalance
    );

    let to_lamports = **to.lamports.borrow();

    let new_from = from_lamports
        .checked_sub(amount)
        .ok_or(CustomError::Overflow)?;
    let new_to = to_lamports
        .checked_add(amount)
        .ok_or(CustomError::Overflow)?;

    **from.try_borrow_mut_lamports()? = new_from;
    **to.try_borrow_mut_lamports()? = new_to;

    Ok(())
}

