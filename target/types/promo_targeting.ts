/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/promo_targeting.json`.
 */
export type PromoTargeting = {
  "address": "41eti7CsZBWD1QYdor2RnxmqzsaNGpRQCkJQZqX2JEKr",
  "metadata": {
    "name": "promoTargeting",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "buyListedCoupon",
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
        },
        {
          "name": "serviceFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "listCouponForSale",
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
    },
    {
      "name": "upgradeConfig",
      "discriminator": [
        129,
        185,
        25,
        221,
        96,
        63,
        251,
        97
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
        },
        {
          "name": "serviceFeeBps",
          "type": "u16"
        }
      ]
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
      "name": "invalidCampaignState",
      "msg": "Invalid campaign state"
    },
    {
      "code": 6001,
      "name": "invalidCouponState",
      "msg": "Invalid coupon state"
    },
    {
      "code": 6002,
      "name": "couponAlreadyUsed",
      "msg": "Coupon already used"
    },
    {
      "code": 6003,
      "name": "invalidCouponCampaign",
      "msg": "Invalid coupon campaign reference"
    },
    {
      "code": 6004,
      "name": "notCouponOwner",
      "msg": "Signer is not the coupon owner"
    },
    {
      "code": 6005,
      "name": "invalidCampaignId",
      "msg": "Invalid campaign id"
    },
    {
      "code": 6006,
      "name": "insufficientVaultBalance",
      "msg": "Insufficient vault balance"
    },
    {
      "code": 6007,
      "name": "notMerchant",
      "msg": "Signer is not the merchant"
    },
    {
      "code": 6008,
      "name": "campaignNotExpired",
      "msg": "Campaign is not expired yet"
    },
    {
      "code": 6009,
      "name": "notAdmin",
      "msg": "Signer is not the admin"
    },
    {
      "code": 6010,
      "name": "invalidConfigAccount",
      "msg": "Invalid config account data"
    },
    {
      "code": 6011,
      "name": "couponListed",
      "msg": "Coupon is currently listed"
    },
    {
      "code": 6012,
      "name": "couponAlreadyListed",
      "msg": "Coupon is already listed"
    },
    {
      "code": 6013,
      "name": "couponNotListed",
      "msg": "Coupon is not listed"
    },
    {
      "code": 6014,
      "name": "invalidResalePrice",
      "msg": "Invalid resale price"
    },
    {
      "code": 6015,
      "name": "invalidBuyer",
      "msg": "Invalid buyer for this coupon"
    },
    {
      "code": 6016,
      "name": "targetWalletRequired",
      "msg": "Target wallet is required for this campaign type"
    },
    {
      "code": 6017,
      "name": "notEligibleForCampaign",
      "msg": "User is not eligible for this campaign"
    },
    {
      "code": 6018,
      "name": "invalidProductForCoupon",
      "msg": "Invalid product for this coupon"
    },
    {
      "code": 6019,
      "name": "invalidBps",
      "msg": "Invalid bps value"
    },
    {
      "code": 6020,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6021,
      "name": "invalidTotalCoupons",
      "msg": "Invalid total coupons value"
    },
    {
      "code": 6022,
      "name": "invalidMintCost",
      "msg": "Invalid mint cost"
    },
    {
      "code": 6023,
      "name": "invalidMaxDiscount",
      "msg": "Invalid max discount"
    },
    {
      "code": 6024,
      "name": "invalidDepositAmount",
      "msg": "Invalid deposit amount"
    },
    {
      "code": 6025,
      "name": "nameTooLong",
      "msg": "Campaign name is too long"
    },
    {
      "code": 6026,
      "name": "noCouponsLeft",
      "msg": "No coupons left for this campaign"
    },
    {
      "code": 6027,
      "name": "campaignExpired",
      "msg": "Campaign has already expired"
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
          },
          {
            "name": "serviceFeeBps",
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
