// src/components/marketplace/WalletModal.tsx
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Wallet, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface WalletOwnedToken {
  id: string;
  merchant: string;
  title: string;
  discount: number; // e.g. 25 means 25%
  category: string;
  supply: number;
  totalSupply: number;
  label?: "New" | "Trending" | "Ending Soon";
  image?: string;
  productPrice?: number;
  maxDiscountValueSol?: number;
  status: "valid" | "expired";
  expirationDate: string;
  couponAddress?: string;
}

interface ListTokenParams {
  price: number;
}

const formatSolValue = (value: number) =>
  value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");

const deriveMaxListingPrice = (
  token: WalletOwnedToken
): number | null => {
  if (token.maxDiscountValueSol && token.maxDiscountValueSol > 0) {
    return token.maxDiscountValueSol;
  }
  if (token.productPrice && token.discount) {
    return token.productPrice * (token.discount / 100);
  }
  return null;
};

interface WalletModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownedTokens: WalletOwnedToken[];
  walletConnected: boolean;
  walletAddress?: string;
  onListForSale?: (
    token: WalletOwnedToken,
    params: ListTokenParams
  ) => Promise<void> | void;
}

/**
 * WalletModal
 *
 * Customer-facing view of all claimed discount NFTs.
 * - Shows basic wallet info (address, connection state)
 * - Lists all owned discount tokens (NFT coupons)
 * - Each token shows:
 *   - Campaign name, merchant, discount
 *   - Status (valid / expired) + expiration date
 *   - Optional image (product)
 *   - Optional couponAddress with a link to Solana Explorer (devnet)
 *   - Optional "List for sale" action
 */
export const WalletModal: React.FC<WalletModalProps> = ({
  open,
  onOpenChange,
  ownedTokens,
  walletConnected,
  walletAddress,
  onListForSale,
}) => {
  const hasTokens = ownedTokens && ownedTokens.length > 0;
  const [listingTokenKey, setListingTokenKey] = React.useState<string | null>(
    null
  );
  const [listingPrice, setListingPrice] = React.useState("");
  const [listingError, setListingError] = React.useState<string | null>(null);
  const [listingLoading, setListingLoading] = React.useState(false);

  const shortAddress =
    walletAddress && walletAddress.length > 8
      ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
      : walletAddress ?? "Not connected";

  const getTokenKey = (token: WalletOwnedToken) =>
    token.couponAddress ?? token.id;

  const startListingFlow = (
    token: WalletOwnedToken,
    suggestedPrice?: number | null
  ) => {
    setListingTokenKey(getTokenKey(token));
    setListingPrice(
      suggestedPrice && suggestedPrice > 0
        ? suggestedPrice.toString()
        : ""
    );
    setListingError(null);
  };

  const resetListingFlow = () => {
    setListingTokenKey(null);
    setListingPrice("");
    setListingError(null);
    setListingLoading(false);
  };

  const handleSubmitListing = async (token: WalletOwnedToken) => {
    if (!onListForSale) return;
    const priceNumber = Number(listingPrice);

    if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
      setListingError("Enter a valid positive price.");
      return;
    }

    const maxListingPrice = deriveMaxListingPrice(token);
    if (
      maxListingPrice !== null &&
      priceNumber > maxListingPrice + 1e-9
    ) {
      setListingError(
        `Price cannot exceed ${formatSolValue(maxListingPrice)} SOL.`
      );
      return;
    }

    try {
      setListingLoading(true);
      setListingError(null);
      await onListForSale(token, {
        price: priceNumber,
      });
      resetListingFlow();
    } catch (err: any) {
      const message =
        err?.message || "Failed to list this discount NFT. Please try again.";
      setListingError(message);
      setListingLoading(false);
    }
  };

  React.useEffect(() => {
    if (!open) {
      resetListingFlow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <DialogHeader className="px-6 pt-6 pb-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Wallet className="h-4 w-4 text-primary" />
            </span>
            <div className="flex flex-col">
              <DialogTitle className="text-lg font-semibold">
                Your Discount Wallet
              </DialogTitle>
              <DialogDescription className="text-xs">
                View all claimed discount NFTs associated with your wallet.
              </DialogDescription>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Wallet
              </span>
              <span className="font-mono text-[11px]">{shortAddress}</span>
            </div>
            <Badge
              variant={walletConnected ? "outline" : "secondary"}
              className={
                walletConnected
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                  : "border-border bg-muted text-muted-foreground"
              }
            >
              {walletConnected ? "Connected" : "Not connected"}
            </Badge>
          </div>
        </DialogHeader>

        {/* Content area */}
        <div className="px-6 pb-5">
          {!walletConnected && (
            <div className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-4 text-xs text-muted-foreground">
              Connect your wallet in the Marketplace header to start claiming
              discount NFTs. Once you claim a token, it will appear here.
            </div>
          )}

          {walletConnected && !hasTokens && (
            <div className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-4 text-xs text-muted-foreground">
              You do not own any discount NFTs yet.
              <br />
              Visit the <span className="font-semibold">Available Airdrops</span>{" "}
              section in the Marketplace and claim a coupon to see it here.
            </div>
          )}

          {walletConnected && hasTokens && (
            <ScrollArea className="mt-2 max-h-80 pr-2">
              <div className="flex flex-col gap-3 pb-2">
                {ownedTokens.map((token) => {
                  const tokenKey = getTokenKey(token);
                  const isListingToken = listingTokenKey === tokenKey;
                  const maxListingPrice = deriveMaxListingPrice(token);
                  const formattedMaxPrice =
                    maxListingPrice !== null
                      ? `${formatSolValue(maxListingPrice)} SOL`
                      : null;

                  return (
                    <div
                      key={`${token.id}-${token.couponAddress ?? "no-coupon"}`}
                      className="flex gap-3 rounded-lg border border-border bg-card/70 p-3"
                    >
                      {/* Optional product image */}
                      {token.image && (
                        <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                          <img
                            src={token.image}
                            alt={token.title}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )}

                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-foreground">
                              {token.title}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {token.merchant}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-primary">
                            {token.discount}% OFF
                          </div>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span>
                            Status:{" "}
                            {token.status === "valid" ? "Valid" : "Expired"}
                          </span>
                          <span>Expires: {token.expirationDate}</span>
                          {token.label && (
                            <Badge
                              variant="outline"
                              className="border-primary/30 bg-primary/5 text-[10px] font-normal"
                            >
                              {token.label}
                            </Badge>
                          )}
                        </div>

                        {token.couponAddress && (
                          <div className="mt-1 flex flex-col gap-1 text-[11px]">
                            <span className="text-muted-foreground">
                              NFT address:
                            </span>
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-mono text-[11px] text-muted-foreground">
                                {token.couponAddress}
                              </span>
                              <a
                                href={`https://explorer.solana.com/address/${token.couponAddress}?cluster=devnet`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary underline"
                              >
                                View on Explorer
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>
                        )}

                        {onListForSale &&
                          token.status === "valid" &&
                          token.couponAddress && (
                            <div className="mt-2">
                              {isListingToken ? (
                                <div className="rounded-md border border-border bg-muted/30 p-3">
                                  <div className="text-xs font-medium text-foreground">
                                    List this NFT
                                  </div>
                                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                                    <div className="space-y-1">
                                      <Label htmlFor={`price-${token.id}`}>
                                        Price (SOL)
                                      </Label>
                                      <Input
                                        id={`price-${token.id}`}
                                        type="number"
                                        min="0"
                                        step="0.001"
                                        placeholder="e.g. 0.05"
                                        max={maxListingPrice ?? undefined}
                                        value={listingPrice}
                                        onChange={(e) =>
                                          setListingPrice(e.target.value)
                                        }
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label>Currency</Label>
                                      <div className="rounded-md border border-border bg-background/70 px-3 py-2 text-sm font-medium text-foreground">
                                        SOL
                                      </div>
                                    </div>
                                  </div>
                                  {formattedMaxPrice && (
                                    <p className="mt-2 text-[11px] text-muted-foreground">
                                      Maximum allowed price: {formattedMaxPrice}
                                    </p>
                                  )}
                                  {listingError && (
                                      <p className="mt-2 text-xs text-destructive">
                                        {listingError}
                                      </p>
                                    )}
                                  <div className="mt-3 flex justify-end gap-2">
                                    <Button
                                      variant="ghost"
                                      size="xs"
                                      onClick={resetListingFlow}
                                      disabled={listingLoading}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="xs"
                                      onClick={() => handleSubmitListing(token)}
                                      disabled={listingLoading}
                                    >
                                      {listingLoading
                                        ? "Listing..."
                                        : "Confirm listing"}
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex justify-end">
                                  <Button
                                    variant="outline"
                                    size="xs"
                                    onClick={() =>
                                      startListingFlow(token, maxListingPrice)
                                    }
                                  >
                                    List for sale
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="border-t border-border px-6 py-3 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
