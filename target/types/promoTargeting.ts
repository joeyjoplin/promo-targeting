/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/promoTargeting.json`.
 */
export type PromoTargeting = {
  "address": "275CL3mEoiKubGcPic1C488aHVqPGcM6gesJADidsoNB",
  "metadata": {
    "name": "promoTargeting",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "buyListedCoupon",
      "docs": [
        "Buy a listed coupon.",
        "",
        "- Buyer pays SOL (lamports) directly to the seller.",
        "- Ownership of the coupon is updated.",
        "- Listing is cleared.",
        "",
        "Safety:",
        "- Enforces that `coupon.sale_price_lamports` is still within",
        "the allowed bounds relative to `max_discount_lamports` and `resale_bps`."
      ],
      "discriminator": [
        97,
        206,
        133,
        142,
        69,
        250,
        41,
        168
      ],
      "accounts": [
        {
          "name": "campaign",
          "writable": true,
          "relations": [
            "coupon"
          ]
        },
        {
          "name": "coupon",
          "writable": true
        },
        {
          "name": "seller",
          "docs": [
            "its public key against `coupon.owner` and receive lamports.",
            "No PDA derivation or data deserialization is required."
          ],
          "writable": true
        },
        {
          "name": "buyer",
          "docs": [
            "Buyer paying SOL and receiving the coupon.",
            "Must be mutable because lamports are debited in the CPI transfer."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "checkTreasuryBalance",
      "docs": [
        "Helper: check the balance of the platform treasury.",
        "",
        "- Only the admin from GlobalConfig can call this.",
        "- Emits a TreasuryBalance event with the current lamports."
      ],
      "discriminator": [
        185,
        237,
        4,
        229,
        126,
        66,
        55,
        255
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "platformTreasury"
        }
      ],
      "args": []
    },
    {
      "name": "closeCampaignVault",
      "docs": [
        "Close the campaign vault and return remaining budget to the merchant",
        "after campaign expiration.",
        "",
        "- Mint costs and service fees have already been transferred to the",
        "platform treasury at each operation.",
        "- Remaining lamports in the vault (if any) are returned to the merchant.",
        "- The campaign account stays alive for historical analytics."
      ],
      "discriminator": [
        178,
        231,
        231,
        5,
        59,
        68,
        52,
        64
      ],
      "accounts": [
        {
          "name": "campaign",
          "docs": [
            "Campaign associated with the vault. Kept alive for history/analytics."
          ]
        },
        {
          "name": "vault",
          "docs": [
            "Vault to be closed. Remaining lamports go to `merchant`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              }
            ]
          }
        },
        {
          "name": "merchant",
          "docs": [
            "Merchant receiving the remaining lamports from the vault."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "campaign"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createCampaign",
      "docs": [
        "Merchant creates a new discount campaign and funds a vault for it.",
        "",
        "Business logic:",
        "- The merchant deposits a budget into a dedicated vault.",
        "- This vault is used to:",
        "* pay minting costs for each coupon (to the platform treasury)",
        "* pay service fees (a percentage over the discount) to the platform treasury",
        "- Each campaign also defines:",
        "* a max discount value in lamports (max_discount_lamports)",
        "* a resale_bps (capped by GlobalConfig.max_resale_bps) that defines",
        "the maximum secondary market price as a percentage of max_discount_lamports.",
        "",
        "Targeting model (MVP):",
        "- `requires_wallet = false`:",
        "* Open campaign, no specific target wallet required.",
        "* Used for \"All users\" / marketplace airdrops.",
        "- `requires_wallet = true`:",
        "* Targeted campaign that requires a specific `target_wallet`.",
        "* Only this wallet will be able to receive minted coupons on-chain."
      ],
      "discriminator": [
        111,
        131,
        187,
        98,
        160,
        193,
        114,
        244
      ],
      "accounts": [
        {
          "name": "config",
          "docs": [
            "Global config – defines policy for campaigns (including max_resale_bps)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "campaign",
          "docs": [
            "Campaign account PDA. One PDA per (merchant, campaign_id)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "merchant"
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Vault PDA that holds the campaign budget and accounting."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              }
            ]
          }
        },
        {
          "name": "merchant",
          "docs": [
            "Merchant funding the campaign."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        },
        {
          "name": "discountBps",
          "type": "u16"
        },
        {
          "name": "serviceFeeBps",
          "type": "u16"
        },
        {
          "name": "resaleBps",
          "type": "u16"
        },
        {
          "name": "expirationTimestamp",
          "type": "i64"
        },
        {
          "name": "totalCoupons",
          "type": "u32"
        },
        {
          "name": "mintCostLamports",
          "type": "u64"
        },
        {
          "name": "maxDiscountLamports",
          "type": "u64"
        },
        {
          "name": "categoryCode",
          "type": "u16"
        },
        {
          "name": "productCode",
          "type": "u16"
        },
        {
          "name": "campaignName",
          "type": "string"
        },
        {
          "name": "depositAmount",
          "type": "u64"
        },
        {
          "name": "requiresWallet",
          "type": "bool"
        },
        {
          "name": "targetWallet",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "expireCoupon",
      "docs": [
        "Expire (burn) a coupon after campaign expiration.",
        "",
        "- Can only be called by the merchant that owns the campaign.",
        "- Campaign must be expired.",
        "- Coupon must belong to this campaign.",
        "- Coupon must not be listed.",
        "- Coupon is closed and rent is returned to the merchant."
      ],
      "discriminator": [
        127,
        14,
        251,
        143,
        143,
        32,
        32,
        157
      ],
      "accounts": [
        {
          "name": "campaign",
          "relations": [
            "coupon"
          ]
        },
        {
          "name": "coupon",
          "writable": true
        },
        {
          "name": "merchant",
          "writable": true,
          "signer": true,
          "relations": [
            "campaign"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "initializeConfig",
      "docs": [
        "Initialize global configuration for the protocol.",
        "",
        "This should be called once by the protocol owner (admin) after deploy.",
        "- `max_resale_bps` defines the maximum percentage (over max_discount_lamports)",
        "that each campaign can use as `resale_bps` to cap secondary prices."
      ],
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "maxResaleBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "listCouponForSale",
      "docs": [
        "List a coupon for sale on the secondary market.",
        "",
        "- Only the current owner can list.",
        "- Coupon must not be used.",
        "- Caller chooses `sale_price_lamports`, but:",
        "* must be > 0",
        "* must be <= campaign.max_discount_lamports",
        "* must be <= max_allowed, where",
        "max_allowed = max_discount_lamports * resale_bps / 10_000"
      ],
      "discriminator": [
        237,
        57,
        133,
        26,
        105,
        69,
        161,
        74
      ],
      "accounts": [
        {
          "name": "campaign",
          "writable": true,
          "relations": [
            "coupon"
          ]
        },
        {
          "name": "coupon",
          "writable": true
        },
        {
          "name": "owner",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "salePriceLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "mintCoupon",
      "docs": [
        "Merchant mints a coupon for a recipient.",
        "",
        "Targeting rules:",
        "- If `campaign.requires_wallet == false`:",
        "* `recipient` can be any wallet (open campaign).",
        "- If `campaign.requires_wallet == true`:",
        "* `recipient` MUST match `campaign.target_wallet`.",
        "",
        "Additionally:",
        "- Creates a logical \"NFT-like\" coupon account.",
        "- Transfers `mint_cost_lamports` in real lamports from the campaign vault",
        "to the platform treasury using a custom lamports transfer helper.",
        "- Updates vault accounting (`total_mint_spent`)."
      ],
      "discriminator": [
        190,
        110,
        73,
        138,
        8,
        160,
        244,
        63
      ],
      "accounts": [
        {
          "name": "campaign",
          "docs": [
            "Campaign PDA for this coupon."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "merchant"
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Vault PDA associated with this campaign."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              }
            ]
          }
        },
        {
          "name": "coupon",
          "docs": [
            "Coupon PDA. One PDA per (campaign, coupon_index)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  117,
                  112,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              },
              {
                "kind": "arg",
                "path": "couponIndex"
              }
            ]
          }
        },
        {
          "name": "merchant",
          "docs": [
            "Merchant paying for the account creation (rent)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "recipient"
        },
        {
          "name": "platformTreasury",
          "docs": [
            "from the vault (mint cost and service fees)."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        },
        {
          "name": "couponIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "redeemCoupon",
      "docs": [
        "Redeem a coupon for a purchase.",
        "",
        "Flow:",
        "- Off-chain: the e-commerce / Solana Pay handles payment with discount.",
        "- On-chain:",
        "* we mark the coupon as used",
        "* update `used_coupons`",
        "* calculate discount and service fee",
        "* cap the discount by `max_discount_lamports`",
        "* transfer real lamports equal to the service fee from vault to platform treasury",
        "* update `total_service_spent` in the vault",
        "* update campaign analytics (total purchase / discount / last redeem ts)",
        "* emit an event with all data needed for analytics",
        "* burn the coupon account (close to user)",
        "",
        "`product_code` argument must match `campaign.product_code`, ensuring",
        "the coupon is only used for the product it was configured for."
      ],
      "discriminator": [
        66,
        181,
        163,
        197,
        244,
        189,
        153,
        0
      ],
      "accounts": [
        {
          "name": "campaign",
          "docs": [
            "Campaign this coupon belongs to."
          ],
          "writable": true,
          "relations": [
            "coupon"
          ]
        },
        {
          "name": "vault",
          "docs": [
            "Vault associated with this campaign."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              }
            ]
          }
        },
        {
          "name": "coupon",
          "docs": [
            "Coupon to be redeemed.",
            "",
            "`close = user` burns the coupon account after the instruction",
            "completes successfully, sending the rent back to the user."
          ],
          "writable": true
        },
        {
          "name": "user",
          "docs": [
            "User redeeming the coupon (must be the coupon owner)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "platformTreasury",
          "docs": [
            "from the vault corresponding to the service fee."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "purchaseAmount",
          "type": "u64"
        },
        {
          "name": "productCode",
          "type": "u16"
        }
      ]
    },
    {
      "name": "transferCoupon",
      "docs": [
        "Transfer a coupon (P2P) from the current owner to a new owner.",
        "",
        "This is the primitive for off-market transfers.",
        "Any existing listing is cleared when the owner changes."
      ],
      "discriminator": [
        144,
        38,
        18,
        1,
        196,
        64,
        73,
        74
      ],
      "accounts": [
        {
          "name": "coupon",
          "docs": [
            "Coupon whose ownership is being transferred."
          ],
          "writable": true
        },
        {
          "name": "currentOwner",
          "docs": [
            "Current owner of the coupon (must sign the transfer)."
          ],
          "signer": true
        },
        {
          "name": "newOwner"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "campaign",
      "discriminator": [
        50,
        40,
        49,
        11,
        157,
        220,
        229,
        192
      ]
    },
    {
      "name": "coupon",
      "discriminator": [
        24,
        230,
        224,
        210,
        200,
        206,
        79,
        57
      ]
    },
    {
      "name": "globalConfig",
      "discriminator": [
        149,
        8,
        156,
        202,
        160,
        252,
        176,
        217
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "events": [
    {
      "name": "couponRedeemed",
      "discriminator": [
        123,
        241,
        185,
        217,
        117,
        208,
        200,
        89
      ]
    },
    {
      "name": "treasuryBalance",
      "discriminator": [
        135,
        81,
        89,
        226,
        2,
        108,
        143,
        172
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidBps",
      "msg": "Invalid basis points value"
    },
    {
      "code": 6001,
      "name": "invalidTotalCoupons",
      "msg": "Invalid total coupons value"
    },
    {
      "code": 6002,
      "name": "invalidMintCost",
      "msg": "Invalid mint cost"
    },
    {
      "code": 6003,
      "name": "invalidDepositAmount",
      "msg": "Invalid deposit amount"
    },
    {
      "code": 6004,
      "name": "invalidMaxDiscount",
      "msg": "Invalid max discount amount"
    },
    {
      "code": 6005,
      "name": "campaignExpired",
      "msg": "Campaign is expired"
    },
    {
      "code": 6006,
      "name": "noCouponsLeft",
      "msg": "No coupons left in this campaign"
    },
    {
      "code": 6007,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6008,
      "name": "nameTooLong",
      "msg": "Campaign name is too long"
    },
    {
      "code": 6009,
      "name": "couponAlreadyUsed",
      "msg": "Coupon is already used"
    },
    {
      "code": 6010,
      "name": "invalidCouponCampaign",
      "msg": "Invalid coupon campaign reference"
    },
    {
      "code": 6011,
      "name": "notCouponOwner",
      "msg": "Signer is not the coupon owner"
    },
    {
      "code": 6012,
      "name": "invalidCampaignId",
      "msg": "Invalid campaign id"
    },
    {
      "code": 6013,
      "name": "insufficientVaultBalance",
      "msg": "Insufficient vault balance"
    },
    {
      "code": 6014,
      "name": "notMerchant",
      "msg": "Signer is not the merchant"
    },
    {
      "code": 6015,
      "name": "campaignNotExpired",
      "msg": "Campaign is not expired yet"
    },
    {
      "code": 6016,
      "name": "couponListed",
      "msg": "Coupon is currently listed"
    },
    {
      "code": 6017,
      "name": "couponAlreadyListed",
      "msg": "Coupon is already listed"
    },
    {
      "code": 6018,
      "name": "couponNotListed",
      "msg": "Coupon is not listed"
    },
    {
      "code": 6019,
      "name": "invalidResalePrice",
      "msg": "Invalid resale price"
    },
    {
      "code": 6020,
      "name": "invalidBuyer",
      "msg": "Invalid buyer for this coupon"
    },
    {
      "code": 6021,
      "name": "targetWalletRequired",
      "msg": "Target wallet is required for this campaign type"
    },
    {
      "code": 6022,
      "name": "notEligibleForCampaign",
      "msg": "User is not eligible for this campaign"
    },
    {
      "code": 6023,
      "name": "invalidProductForCoupon",
      "msg": "Invalid product for this coupon"
    }
  ],
  "types": [
    {
      "name": "campaign",
      "docs": [
        "Campaign account: stores all campaign parameters and summary stats."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "campaignId",
            "type": "u64"
          },
          {
            "name": "discountBps",
            "type": "u16"
          },
          {
            "name": "serviceFeeBps",
            "type": "u16"
          },
          {
            "name": "resaleBps",
            "type": "u16"
          },
          {
            "name": "expirationTimestamp",
            "type": "i64"
          },
          {
            "name": "totalCoupons",
            "type": "u32"
          },
          {
            "name": "usedCoupons",
            "type": "u32"
          },
          {
            "name": "mintedCoupons",
            "type": "u32"
          },
          {
            "name": "mintCostLamports",
            "type": "u64"
          },
          {
            "name": "maxDiscountLamports",
            "type": "u64"
          },
          {
            "name": "categoryCode",
            "type": "u16"
          },
          {
            "name": "productCode",
            "type": "u16"
          },
          {
            "name": "campaignName",
            "type": "string"
          },
          {
            "name": "requiresWallet",
            "type": "bool"
          },
          {
            "name": "targetWallet",
            "type": "pubkey"
          },
          {
            "name": "totalPurchaseAmount",
            "type": "u64"
          },
          {
            "name": "totalDiscountLamports",
            "type": "u64"
          },
          {
            "name": "lastRedeemTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "coupon",
      "docs": [
        "Coupon account: represents a single \"logical NFT\" coupon",
        "plus listing data for the secondary market."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaign",
            "type": "pubkey"
          },
          {
            "name": "couponIndex",
            "type": "u64"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "used",
            "type": "bool"
          },
          {
            "name": "listed",
            "type": "bool"
          },
          {
            "name": "salePriceLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "couponRedeemed",
      "docs": [
        "Event emitted whenever a coupon is redeemed, enabling off-chain analytics."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "campaign",
            "type": "pubkey"
          },
          {
            "name": "campaignId",
            "type": "u64"
          },
          {
            "name": "categoryCode",
            "type": "u16"
          },
          {
            "name": "productCode",
            "type": "u16"
          },
          {
            "name": "couponIndex",
            "type": "u64"
          },
          {
            "name": "purchaseAmount",
            "type": "u64"
          },
          {
            "name": "discountValue",
            "type": "u64"
          },
          {
            "name": "serviceFeeValue",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "globalConfig",
      "docs": [
        "Global configuration for the protocol."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "maxResaleBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "treasuryBalance",
      "docs": [
        "Event emitted when checking platform treasury balance."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "platformTreasury",
            "type": "pubkey"
          },
          {
            "name": "lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vault",
      "docs": [
        "Vault account: holds the campaign budget and accounting."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaign",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "totalDeposit",
            "type": "u64"
          },
          {
            "name": "totalMintSpent",
            "type": "u64"
          },
          {
            "name": "totalServiceSpent",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
