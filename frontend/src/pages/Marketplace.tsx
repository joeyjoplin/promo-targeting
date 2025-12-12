// src/pages/Marketplace.tsx
import { useEffect, useState } from "react";
import { Navigation } from "@/components/Navigation";
import { MarketplaceHero } from "@/components/marketplace/MarketplaceHero";
import { DiscountCard } from "@/components/marketplace/DiscountCard";
import { SecondaryMarketCard } from "@/components/marketplace/SecondaryMarketCard";
import { WalletModal } from "@/components/marketplace/WalletModal";
import { useSolanaWallet } from "@/solana/useSolanaWallet";
import type { OnChainCampaign } from "@/components/CampaignsTable";
import { findProductByCode } from "@/data/products";
import { toast } from "@/hooks/use-toast";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * UI types used by the Marketplace.
 * These are decoupled from the raw on-chain layout and can evolve independently.
 */
export interface DiscountToken {
  id: string;
  merchant: string;
  title: string;
  discount: number; // plain percentage, e.g. 25 for 25%
  category: string;
  supply: number;
  totalSupply: number;
  label?: "New" | "Trending" | "Ending Soon";
  image: string;
  productPrice?: number; // base product price from Ecommerce catalog
  maxDiscountValueSol?: number; // cap for resale price derived from on-chain + catalog data
}

export interface SecondaryListing {
  id: string;
  token: DiscountToken;
  price: number;
  currency: "USDC" | "SOL";
  expirationDate: string;
  seller: string;
  couponAddress?: string;
}

export interface OwnedToken extends DiscountToken {
  status: "valid" | "expired";
  expirationDate: string;
  // Optional on-chain coupon/NFT address returned by the backend
  couponAddress?: string;
}

/**
 * Expected response shape from /api/mint-coupon.
 * Adjust field names if your backend is different.
 */
interface MintCouponResponse {
  couponAddress?: string;
  coupon_address?: string;
  expiration_timestamp?: number; // seconds since epoch
}

/**
 * Helper: derive Marketplace category from the on-chain campaign.
 * For now we mostly use product_code as a proxy; this can be refined later.
 */
function deriveCategory(campaign: OnChainCampaign): string {
  const product = findProductByCode(campaign.product_code);
  if (!product) {
    return "General";
  }

  const name = product.name.toLowerCase();
  if (name.includes("coffee") || name.includes("chocolate")) {
    return "Food & Beverage";
  }
  if (name.includes("t-shirt") || name.includes("shirt")) {
    return "Fashion";
  }

  return "General";
}

/**
 * Helper: derive a "label" for the Marketplace card based on
 * time to expiration and usage in the campaign.
 */
function deriveLabel(campaign: OnChainCampaign): DiscountToken["label"] {
  const now = Math.floor(Date.now() / 1000);
  const secondsToExpiry = campaign.expiration_timestamp - now;

  if (secondsToExpiry <= 0) {
    // Already expired, no label needed
    return undefined;
  }

  const daysToExpiry = secondsToExpiry / (24 * 60 * 60);

  // High usage → "Trending"
  if (
    campaign.total_coupons > 0 &&
    campaign.used_coupons / campaign.total_coupons > 0.7
  ) {
    return "Trending";
  }

  // Short time to expiry → "Ending Soon"
  if (daysToExpiry <= 7) {
    return "Ending Soon";
  }

  // Fresh campaign → "New"
  return "New";
}

/**
 * Helper: convert an on-chain open campaign into a Marketplace discount token.
 * Uses the shared products catalog for image + coherence with the Ecommerce page.
 */
function mapCampaignToDiscountToken(campaign: OnChainCampaign): DiscountToken {
  const product = findProductByCode(campaign.product_code);

  const fallbackImage =
    "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=400&h=300&fit=crop";

  const maxDiscountLamports = Number(campaign.max_discount_lamports || 0);
  const maxDiscountByCampaign =
    maxDiscountLamports > 0
      ? maxDiscountLamports / LAMPORTS_PER_SOL
      : 0;

  const discountBps = Number(campaign.discount_bps || 0);
  const discountFraction = discountBps > 0 ? discountBps / 10_000 : 0;
  const discountValueFromProduct =
    product && product.price && discountFraction > 0
      ? product.price * discountFraction
      : 0;

  let maxDiscountValueSol = maxDiscountByCampaign;
  if (discountValueFromProduct > 0) {
    if (maxDiscountValueSol > 0) {
      maxDiscountValueSol = Math.min(
        maxDiscountValueSol,
        discountValueFromProduct
      );
    } else {
      maxDiscountValueSol = discountValueFromProduct;
    }
  }

  return {
    id: campaign.address,
    merchant: campaign.merchant || "Unknown merchant",
    title: campaign.campaign_name || "Unnamed campaign",
    // discount_bps is basis points (e.g. 2500 = 25.00%)
    discount: campaign.discount_bps / 100,
    category: deriveCategory(campaign),
    supply: campaign.minted_coupons,
    totalSupply: campaign.total_coupons,
    label: deriveLabel(campaign),
    image: product?.image ?? fallbackImage,
    productPrice: product?.price,
    maxDiscountValueSol:
      maxDiscountValueSol > 0 ? maxDiscountValueSol : undefined,
  };
}

/**
 * Helper: check if a campaign is still "active" for Marketplace purposes.
 * - Not expired
 * - Has remaining coupons available
 */
function isActiveCampaign(campaign: OnChainCampaign): boolean {
  const now = Math.floor(Date.now() / 1000);

  if (campaign.expiration_timestamp <= now) {
    return false;
  }

  const totalCoupons = Number(campaign.total_coupons) || 0;
  if (totalCoupons > 0) {
    const mintedCoupons = Number(campaign.minted_coupons) || 0;
    const usedCoupons = Number(campaign.used_coupons) || 0;

    if (mintedCoupons >= totalCoupons || usedCoupons >= totalCoupons) {
      return false;
    }
  }

  return true;
}

/**
 * Helper: filters campaigns to only "open audience" (All users)
 * and active ones (not expired / not fully used).
 */
function filterOpenAirdropCampaigns(
  campaigns: OnChainCampaign[]
): OnChainCampaign[] {
  return campaigns.filter(
    (c) => !c.requires_wallet && isActiveCampaign(c)
  );
}

const Marketplace = () => {
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [ownedTokens, setOwnedTokens] = useState<OwnedToken[]>([]);

  // On-chain open airdrop campaigns mapped into DiscountToken objects
  const [airdropTokens, setAirdropTokens] = useState<DiscountToken[]>([]);
  const [loadingAirdrops, setLoadingAirdrops] = useState(false);
  const [airdropError, setAirdropError] = useState<string | null>(null);

  // Claim state (simple feedback for user)
  const [claimingTokenId, setClaimingTokenId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Secondary market listings (MVP off-chain order book)
  const [secondaryListings, setSecondaryListings] = useState<SecondaryListing[]>(
    []
  );
  const [loadingSecondary, setLoadingSecondary] = useState(false);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);

  // Customer wallet (persona: airdrop & secondary buyer)
  const {
    walletAddress,
    connected,
    connecting,
    connectWallet,
    disconnectWallet,
  } = useSolanaWallet();

  const walletConnected = connected && !!walletAddress;

  const shortAddress =
    walletAddress && walletAddress.length > 8
      ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
      : walletAddress ?? undefined;

  /**
   * Fetch on-chain campaigns from the AI server
   * and map open audience campaigns into Marketplace tokens.
   */
  const fetchAirdropTokens = async () => {
    setLoadingAirdrops(true);
    setAirdropError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/campaigns`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error: ${res.status} - ${text}`);
      }

      const data = await res.json();
      if (!data || !Array.isArray(data.campaigns)) {
        throw new Error("Malformed response from /api/campaigns");
      }

      const allCampaigns: OnChainCampaign[] = data.campaigns;
      const openCampaigns = filterOpenAirdropCampaigns(allCampaigns);

      const mappedTokens = openCampaigns.map(mapCampaignToDiscountToken);
      setAirdropTokens(mappedTokens);
    } catch (err: any) {
      console.error("[Marketplace] Failed to fetch airdrop campaigns:", err);
      setAirdropError(err.message || "Failed to load open airdrops.");
    } finally {
      setLoadingAirdrops(false);
    }
  };

  /**
   * Fetch secondary market listings from the backend and
   * map them into UI-ready SecondaryListing objects.
   */
  const fetchSecondaryListings = async () => {
    setLoadingSecondary(true);
    setSecondaryError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/secondary/listings`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error: ${res.status} - ${text}`);
      }

      const data = await res.json();
      if (!data || !Array.isArray(data.listings)) {
        throw new Error("Malformed response from /api/secondary/listings");
      }

      type BackendListing = {
        id: string;
        campaignAddress: string;
        couponAddress: string;
        sellerWallet: string;
        price: number;
        currency: "USDC" | "SOL";
        status: string;
      };

      const backendListings: BackendListing[] = data.listings;

      const fallbackImage =
        "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=400&h=300&fit=crop";

      const mapped: SecondaryListing[] = backendListings.map((l) => {
        // Try to find an existing DiscountToken for this campaign
        const baseToken =
          airdropTokens.find((t) => t.id === l.campaignAddress) ?? {
            id: l.campaignAddress,
            merchant: "Unknown merchant",
            title: "Discount coupon",
            discount: 0,
            category: "General",
            supply: 0,
            totalSupply: 0,
            image: fallbackImage,
            productPrice: 0,
          };

        return {
          id: l.id,
          token: baseToken,
          price: l.price,
          currency: l.currency,
          // For now we do not track per-listing expiration on backend.
          // Later this can come from coupon account or metadata.
          expirationDate: "2024-12-31",
          seller: l.sellerWallet,
          couponAddress: l.couponAddress,
        };
      });

      setSecondaryListings(mapped);
    } catch (err: any) {
      console.error("[Marketplace] Failed to fetch secondary listings:", err);
      setSecondaryError(err.message || "Failed to load secondary listings.");
    } finally {
      setLoadingSecondary(false);
    }
  };

  useEffect(() => {
    fetchAirdropTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When airdrop tokens are available (or whenever they change),
  // refresh secondary listings so mapping to DiscountToken is up to date.
  useEffect(() => {
    fetchSecondaryListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airdropTokens.length]);

  /**
   * Handle user clicking "Claim" on a discount token:
   * - Ensure wallet is connected
   * - Call backend /api/mint-coupon to mint the NFT/coupon on-chain
   * - Add the claimed token to the OwnedToken list and open the wallet modal
   * - Optimistically update supply in the airdrop grid
   */
  const handleClaimToken = async (token: DiscountToken) => {
    setClaimError(null);

    // If wallet is not connected, trigger connect flow and ask for a second click
    if (!walletConnected || !walletAddress) {
      await connectWallet();
      return;
    }

    // Optional: avoid duplicate claims of the same campaign in the UI
    const alreadyOwned = ownedTokens.some((t) => t.id === token.id);
    if (alreadyOwned) {
      setClaimError("You have already claimed this discount token.");
      setShowWalletModal(true);
      return;
    }

    try {
      setClaimingTokenId(token.id);

      const res = await fetch(`${API_BASE_URL}/api/mint-coupon`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // Adjust keys if your backend expects different field names.
        body: JSON.stringify({
          campaignAddress: token.id, // on-chain campaign PDA
          customerWallet: walletAddress, // connected wallet (recipient)
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Mint API error: ${res.status} - ${text}`);
      }

      const data: MintCouponResponse = await res.json();

      // Derive expiration date from backend if available, otherwise fallback
      let expirationDate = "2024-12-31";
      if (data.expiration_timestamp) {
        const d = new Date(data.expiration_timestamp * 1000);
        expirationDate = d.toISOString().split("T")[0];
      }

      const couponAddress = data.couponAddress ?? data.coupon_address;

      const newToken: OwnedToken = {
        ...token,
        status: "valid",
        expirationDate,
        couponAddress,
      };

      // 1) Update local wallet view
      setOwnedTokens((prev) => [...prev, newToken]);
      setShowWalletModal(true);

      // 2) Optimistically update local supply in the Marketplace grid
      setAirdropTokens((prev) =>
        prev
          // First increment supply for the claimed token
          .map((t) =>
            t.id === token.id ? { ...t, supply: t.supply + 1 } : t
          )
          // Optionally: remove fully minted campaigns from the list
          .filter((t) => t.supply < t.totalSupply)
      );

      // 3) (Optional) If you prefer to re-sync from backend instead of optimistic update:
      // await fetchAirdropTokens();
    } catch (err: any) {
      console.error("[Marketplace] Failed to mint coupon:", err);
      setClaimError(
        err.message || "Failed to claim discount token. Please try again."
      );
    } finally {
      setClaimingTokenId(null);
    }
  };

  /**
   * Handle listing a claimed NFT coupon for sale in the secondary market.
   * Triggered by the wallet modal form with explicit price/currency inputs.
   */
  const handleListTokenForSale = async (
    token: OwnedToken,
    params: { price: number }
  ) => {
    if (!walletConnected || !walletAddress) {
      throw new Error("Connect your wallet before listing a discount NFT.");
    }

    if (!token.couponAddress) {
      throw new Error(
        "This discount NFT is missing a coupon address and cannot be listed."
      );
    }

    const computedMaxPrice =
      (token.maxDiscountValueSol && token.maxDiscountValueSol > 0
        ? token.maxDiscountValueSol
        : token.productPrice && token.discount
        ? token.productPrice * (token.discount / 100)
        : null) ?? null;

    if (
      computedMaxPrice !== null &&
      params.price > computedMaxPrice + 1e-9
    ) {
      throw new Error(
        `Listing price exceeds the max discount value (${computedMaxPrice.toFixed(
          3
        )} SOL).`
      );
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/secondary/list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaignAddress: token.id,
          couponAddress: token.couponAddress,
          sellerWallet: walletAddress,
          price: params.price,
          currency: "SOL",
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`List API error: ${res.status} - ${text}`);
      }

      const data = await res.json();
      console.log("[Marketplace] Listed coupon for sale:", data.listing);

      // Refresh secondary listings so the new one appears
      await fetchSecondaryListings();

      toast({
        title: "Listing created",
        description: "Your discount NFT is now live in the secondary market.",
      });
    } catch (err: any) {
      console.error("[Marketplace] Failed to list coupon:", err);
      const message =
        err?.message || "Failed to list discount NFT. Please try again.";
      throw new Error(message);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main>
        {/* Hero Section */}
        <MarketplaceHero
          walletConnected={walletConnected}
          onViewWallet={() => setShowWalletModal(true)}
        />

        {/* Discount Airdrop Grid (open on-chain campaigns) */}
        <section className="mx-auto max-w-7xl px-6 py-12">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-foreground mb-1">
                Available Airdrops
              </h2>
              <p className="text-muted-foreground text-sm">
                Claim free discount tokens from verified on-chain campaigns
                (open audience)
              </p>
            </div>

            {/* Simple global claim feedback */}
            {claimingTokenId && (
              <div className="text-xs text-muted-foreground">
                Claiming discount token…
              </div>
            )}
            {claimError && !claimingTokenId && (
              <div className="text-xs text-destructive">{claimError}</div>
            )}
          </div>

          {loadingAirdrops && (
            <div className="text-sm text-muted-foreground">
              Loading on-chain airdrops from Solana devnet…
            </div>
          )}

          {airdropError && !loadingAirdrops && (
            <div className="text-sm text-destructive">
              Failed to load airdrops: {airdropError}
            </div>
          )}

          {!loadingAirdrops && !airdropError && airdropTokens.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No open airdrop campaigns found yet. Create a campaign with{" "}
              <span className="font-semibold">Audience = All users (open)</span>{" "}
              in the dashboard to see it here.
            </div>
          )}

          {!loadingAirdrops && !airdropError && airdropTokens.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {airdropTokens.map((token) => (
                <DiscountCard
                  key={token.id}
                  token={token}
                  onClaim={handleClaimToken}
                  walletConnected={walletConnected}
                  connecting={connecting}
                  onConnectWallet={connectWallet}
                />
              ))}
            </div>
          )}
        </section>

        {/* Secondary Market (real listings from backend) */}
        <section className="mx-auto max-w-7xl px-6 py-12 border-t border-border">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-foreground mb-2">
              Secondary Market
            </h2>
            <p className="text-muted-foreground">
              Buy discount tokens from other users (MVP off-chain order book)
            </p>
          </div>

          {loadingSecondary && (
            <div className="text-sm text-muted-foreground">
              Loading secondary market listings…
            </div>
          )}

          {secondaryError && !loadingSecondary && (
            <div className="text-sm text-destructive">
              Failed to load secondary listings: {secondaryError}
            </div>
          )}

          {!loadingSecondary &&
            !secondaryError &&
            secondaryListings.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No secondary listings available yet. List a discount NFT from
                your wallet to see it here.
              </div>
            )}

          {!loadingSecondary &&
            !secondaryError &&
            secondaryListings.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {secondaryListings.map((listing) => (
                  <SecondaryMarketCard
                    key={listing.id}
                    listing={listing}
                    walletConnected={walletConnected}
                    connecting={connecting}
                    onConnectWallet={connectWallet}
                  />
                ))}
              </div>
            )}
        </section>
      </main>

      {/* Wallet Modal (customer view of owned discount tokens) */}
      <WalletModal
        open={showWalletModal}
        onOpenChange={setShowWalletModal}
        ownedTokens={ownedTokens}
        walletConnected={walletConnected}
        walletAddress={walletAddress ?? undefined}
        onListForSale={handleListTokenForSale}
      />
    </div>
  );
};

export default Marketplace;
