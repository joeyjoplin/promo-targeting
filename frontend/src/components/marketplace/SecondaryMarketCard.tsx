// src/components/marketplace/SecondaryMarketCard.tsx
import * as React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Wallet } from "lucide-react";
import type { SecondaryListing } from "@/pages/Marketplace";

interface SecondaryMarketCardProps {
  listing: SecondaryListing;
  walletConnected: boolean;
  connecting: boolean;
  onConnectWallet: () => Promise<void> | void;
}

/**
 * SecondaryMarketCard
 *
 * Shows a single listing in the secondary market:
 * - Product / campaign info
 * - Listing price (what the buyer pays for the coupon)
 * - Product total price (from Ecommerce catalog)
 * - Monetary value of the discount (how much the coupon saves)
 * - Optional: effective price after discount
 */
export const SecondaryMarketCard: React.FC<SecondaryMarketCardProps> = ({
  listing,
  walletConnected,
  connecting,
  onConnectWallet,
}) => {
  const { token, price, currency, expirationDate, seller, couponAddress } =
    listing;

  const productPrice = token.productPrice ?? 0;
  const discountValue = productPrice * (token.discount / 100);
  const effectivePrice = Math.max(productPrice - discountValue, 0);

  const formatCurrency = (value: number) =>
    `$${value.toFixed(2)}`; // simple USD-style formatting for now

  const handleClickBuy = async () => {
    if (!walletConnected) {
      await onConnectWallet();
      return;
    }

    // For now, this is just a stub.
    // In the next step we will call /api/secondary/buy here.
    alert(
      "Buy flow is not implemented yet. Next step: call /api/secondary/buy and handle ownership transfer."
    );
  };

  return (
    <Card className="flex flex-col overflow-hidden border border-border bg-card/80">
      {/* Image */}
      <div className="relative h-40 w-full overflow-hidden border-b border-border bg-muted">
        <img
          src={token.image}
          alt={token.title}
          className="h-full w-full object-cover"
        />
        {token.label && (
          <Badge className="absolute left-3 top-3 bg-primary text-primary-foreground text-[10px]">
            {token.label}
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {token.title}
            </h3>
            <p className="text-xs text-muted-foreground">{token.merchant}</p>
          </div>
          <div className="text-sm font-semibold text-primary">
            {token.discount}% OFF
          </div>
        </div>

        {/* Economic info: product price, discount value, listing price */}
        <div className="mt-1 rounded-md border border-border bg-muted/40 p-2 text-[11px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Product price</span>
            <span className="font-medium">
              {productPrice > 0
                ? formatCurrency(productPrice)
                : "Not available"}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Discount value ({token.discount}%)
            </span>
            <span className="font-medium">
              {productPrice > 0
                ? formatCurrency(discountValue)
                : "Not available"}
            </span>
          </div>

          {productPrice > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Effective price after discount
              </span>
              <span className="font-semibold">
                {formatCurrency(effectivePrice)}
              </span>
            </div>
          )}

          <div className="mt-1 flex justify-between border-t border-border pt-1">
            <span className="text-muted-foreground">Coupon listing price</span>
            <span className="font-semibold">
              {price} {currency}
            </span>
          </div>
        </div>

        {/* Meta info: seller, expiration */}
        <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          <div className="flex justify-between">
            <span>Seller</span>
            <span className="truncate font-mono">
              {seller.slice(0, 4)}...{seller.slice(-4)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Coupon expires</span>
            <span>{expirationDate}</span>
          </div>
          {couponAddress && (
            <div className="flex justify-between">
              <span>Coupon NFT</span>
              <span className="truncate font-mono">
                {couponAddress.slice(0, 4)}...{couponAddress.slice(-4)}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Wallet className="h-3 w-3" />
            <span>
              {walletConnected
                ? "Ready to buy with your wallet"
                : connecting
                ? "Connecting wallet…"
                : "Connect wallet to buy"}
            </span>
          </div>

          <Button
            size="sm"
            onClick={handleClickBuy}
            disabled={connecting}
            className="inline-flex items-center gap-1"
          >
            <ShoppingCart className="h-3 w-3" />
            <span className="text-xs">Buy coupon</span>
          </Button>
        </div>
      </div>
    </Card>
  );
};
