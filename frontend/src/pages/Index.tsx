// src/pages/Index.tsx
import { useEffect, useState } from "react";
import { Navigation } from "@/components/Navigation";
import { MetricCard } from "@/components/MetricCard";
import {
  CampaignsTable,
  type OnChainCampaign,
} from "@/components/CampaignsTable";
import { TrendingUp, DollarSign, Percent, Users } from "lucide-react";
import { AICampaignAssistant } from "@/components/AICampaignAssistant";
import { CampaignDetailsCard } from "@/components/CampaignDetailsCard";

/**
 * Same key used by the e-commerce page to persist shopper context.
 * The dashboard reads this snapshot to create targeted campaigns.
 */
const SHOPPER_CONTEXT_KEY = "promo-targeting:shopper-context";

interface ShopperContextCartItem {
  id: string;
  quantity: number;
  price: number;
}

export interface ShopperContext {
  productId: string | null;
  productPriceSol: number | null;
  walletAddress: string | null;
  cartSnapshot: ShopperContextCartItem[];
  updatedAt: string;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

const Index = () => {
  // This key is used to tell CampaignsTable to re-fetch on-chain campaigns
  const [campaignsRefreshKey, setCampaignsRefreshKey] = useState(0);

  // Full list of on-chain campaigns (used for analytics overview + AI assistant)
  const [campaigns, setCampaigns] = useState<OnChainCampaign[]>([]);

  // Currently selected campaign in the table (used by the details + mint panel)
  const [selectedCampaign, setSelectedCampaign] =
    useState<OnChainCampaign | null>(null);

  // Shopper context coming from the ecommerce frontend (wallet + product intent)
  const [shopperContext, setShopperContext] = useState<ShopperContext | null>(
    null
  );

  const handleCampaignCreated = (campaignAddress?: string | null) => {
    // Bump the key so CampaignsTable useEffect runs again
    setCampaignsRefreshKey((prev) => prev + 1);

    if (campaignAddress) {
      console.log("[Index] New on-chain campaign created:", campaignAddress);
    }
  };

  /**
   * Read shopper context from localStorage when the dashboard loads.
   * This snapshot is written by the Ecommerce page whenever
   * the cart or wallet changes.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(SHOPPER_CONTEXT_KEY);
      if (!raw) {
        setShopperContext(null);
        return;
      }

      const parsed = JSON.parse(raw);

      if (typeof parsed !== "object" || parsed === null) {
        setShopperContext(null);
        return;
      }

      const normalized: ShopperContext = {
        productId:
          typeof parsed.productId === "string" ? parsed.productId : null,
        productPriceSol:
          typeof parsed.productPriceSol === "number"
            ? parsed.productPriceSol
            : null,
        walletAddress:
          typeof parsed.walletAddress === "string"
            ? parsed.walletAddress
            : null,
        cartSnapshot: Array.isArray(parsed.cartSnapshot)
          ? parsed.cartSnapshot.map((item: any) => ({
              id: String(item.id),
              quantity: Number(item.quantity) || 0,
              price: Number(item.price) || 0,
            }))
          : [],
        updatedAt:
          typeof parsed.updatedAt === "string"
            ? parsed.updatedAt
            : new Date().toISOString(),
      };

      setShopperContext(normalized);
      console.log("[Index] Loaded shopper context from localStorage:", normalized);
    } catch (err) {
      console.error("[Index] Failed to parse shopper context:", err);
      setShopperContext(null);
    }
  }, []);

  // -----------------------------
  // On-chain analytics (overview)
  // -----------------------------

  const deriveStatus = (
    c: OnChainCampaign
  ): "active" | "scheduled" | "ended" => {
    const now = Math.floor(Date.now() / 1000);
    const hasExpired = c.expiration_timestamp <= now;
    const totalCoupons = Number(c.total_coupons) || 0;
    const mintedCoupons = Number(c.minted_coupons) || 0;
    const usedCoupons = Number(c.used_coupons) || 0;
    const fullyClaimed =
      totalCoupons > 0 &&
      (mintedCoupons >= totalCoupons || usedCoupons >= totalCoupons);

    if (hasExpired || fullyClaimed) {
      return "ended";
    }

    return "active";
  };

  const activeCampaignsCount = campaigns.filter(
    (c) => deriveStatus(c) === "active"
  ).length;

  // Total potential discount capacity across all campaigns (in SOL).
  // Formula: sum(total_coupons * max_discount_lamports) / LAMPORTS_PER_SOL
  const totalDiscountCapacityLamports = campaigns.reduce((acc, c) => {
    const perCampaign =
      Number(c.total_coupons || 0) *
      Number(c.max_discount_lamports || 0);
    return acc + perCampaign;
  }, 0);

  const totalDiscountCapacitySol =
    totalDiscountCapacityLamports / LAMPORTS_PER_SOL;

  // Total redeemed coupons across all campaigns.
  const totalRedeemedCoupons = campaigns.reduce(
    (acc, c) => acc + Number(c.used_coupons || 0),
    0
  );

  // Average redeem rate across all campaigns.
  // For each campaign: used / (minted || total), then we compute a weighted average by denominator.
  let avgRedeemRatePercent = 0;
  (() => {
    let weightedSum = 0;
    let totalWeight = 0;

    campaigns.forEach((c) => {
      const denominator = c.minted_coupons || c.total_coupons || 0;
      if (!denominator) return;
      const rate = c.used_coupons / denominator; // 0..1
      weightedSum += rate * denominator;
      totalWeight += denominator;
    });

    if (totalWeight > 0) {
      avgRedeemRatePercent = (weightedSum / totalWeight) * 100;
    } else {
      avgRedeemRatePercent = 0;
    }
  })();

  // Average nominal discount configured on campaigns (bps -> %).
  let avgDiscountPercent = 0;
  if (campaigns.length > 0) {
    const sumBps = campaigns.reduce(
      (acc, c) => acc + Number(c.discount_bps || 0),
      0
    );
    avgDiscountPercent = (sumBps / campaigns.length) / 100;
  }

  // Overall conversion (for AI assistant) as 0..1
  const overallConversion = avgRedeemRatePercent / 100;

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Analytics Overview */}
        <section className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-6">
            Campaign Overview
          </h1>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <MetricCard
              label="Active Campaigns"
              value={activeCampaignsCount.toString()}
              icon={<TrendingUp className="h-6 w-6" />}
            />
            <MetricCard
              label="Total Discount Capacity"
              value={`${totalDiscountCapacitySol.toFixed(2)} SOL`}
              icon={<DollarSign className="h-6 w-6" />}
            />
            <MetricCard
              label="Redeemed Coupons"
              value={totalRedeemedCoupons.toString()}
              icon={<Users className="h-6 w-6" />}
            />
            <MetricCard
              label="Avg. Redeem Rate"
              value={`${avgRedeemRatePercent.toFixed(1)}%`}
              icon={<Percent className="h-6 w-6" />}
            />
          </div>
        </section>

        <div className="space-y-8">
          {/* Campaigns Table + Details / Mint Panel */}
          <div>
            <h2 className="text-xl font-semibold text-foreground mb-4">
              Active Campaigns
            </h2>

            {/* Full-width table with vertical scroll limited to 4 rows */}
            <div className="space-y-4">
              <CampaignsTable
                refreshKey={campaignsRefreshKey}
                onSelectCampaign={(campaign) => setSelectedCampaign(campaign)}
                onCampaignsLoaded={(cs) => setCampaigns(cs)}
              />

              <CampaignDetailsCard
                selectedCampaign={selectedCampaign}
                onMintSuccess={() => {
                  setCampaignsRefreshKey((prev) => prev + 1);
                  setSelectedCampaign(null);
                }}
              />
            </div>
          </div>

          {/* AI Campaign Copilot */}
          <div className="mt-8">
            <h2 className="text-xl font-semibold text-foreground mb-2">
              AI Campaign Copilot
            </h2>
            <p className="text-sm text-muted-foreground mb-3">
              Ask the copilot for a campaign in natural language (for example:
              “Create a Black Friday campaign for all users with a 0.5 SOL
              budget”). The assistant will propose the parameters, and you can
              confirm on-chain creation.
            </p>
            <AICampaignAssistant
              totalActiveCampaigns={activeCampaignsCount}
              // Note: this is in SOL, not USD. For now we pass SOL-equivalent as a proxy.
              totalBudgetUsd={totalDiscountCapacitySol}
              avgDiscountPercent={avgDiscountPercent}
              overallConversion={overallConversion}
              onCampaignCreated={handleCampaignCreated}
              shopperContext={shopperContext}
            />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
