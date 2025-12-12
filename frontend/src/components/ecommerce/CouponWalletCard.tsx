// src/components/ecommerce/CouponWalletCard.tsx
import { useEffect, useState } from "react";
import type { CouponSummary } from "@/pages/Ecommerce";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Loader2, TicketPercent } from "lucide-react";

export interface CouponApiItem {
  address: string;
  campaign: string | null;
  recipient: string;
  // Discount in basis points (1000 = 10%)
  discount_bps?: number;
  // Max discount in lamports
  max_discount_lamports?: number;
  // Optional extra fields from campaign
  expiration_timestamp?: number;
  category_code?: number;
  product_code?: number;
  // Coupon flags
  is_used?: boolean;
}

interface CouponWalletCardProps {
  walletAddress?: string;

  // Currently selected coupon in the e-commerce flow
  selectedCoupon?: CouponSummary | null;

  // Callback when user selects / unselects a coupon
  onSelectCoupon?: (coupon: CouponSummary | null) => void;
}

interface CouponState {
  loading: boolean;
  error: string | null;
  coupons: CouponApiItem[];
}

/**
 * Base URL for the AI server API.
 * The AI server listens on http://localhost:8787.
 *
 * You can override this via:
 *   VITE_AI_SERVER_URL="http://localhost:8787"
 */
const API_BASE =
  import.meta.env.VITE_AI_SERVER_URL?.replace(/\/$/, "") ||
  "http://localhost:8787";

export const CouponWalletCard = ({
  walletAddress,
  selectedCoupon,
  onSelectCoupon,
}: CouponWalletCardProps) => {
  const [state, setState] = useState<CouponState>({
    loading: false,
    error: null,
    coupons: [],
  });

  // Simple counter used to force a re-fetch when global "coupon-updated" event fires
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Listen to global event from the e-commerce page when a coupon is consumed
  useEffect(() => {
    const handler = () => {
      console.log(
        "[CouponWalletCard] Received global event: promo-targeting:coupon-updated -> refreshing coupons."
      );
      setRefreshCounter((prev) => prev + 1);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("promo-targeting:coupon-updated", handler);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("promo-targeting:coupon-updated", handler);
      }
    };
  }, []);

  useEffect(() => {
    // If there is no connected wallet, clear state and skip fetch
    if (!walletAddress) {
      setState({
        loading: false,
        error: null,
        coupons: [],
      });
      return;
    }

    const abortController = new AbortController();

    const fetchCoupons = async () => {
      try {
        setState((prev) => ({ ...prev, loading: true, error: null }));

        // IMPORTANT: match server.js route:
        // app.get("/api/coupons/:walletAddress", ...)
        const url = `${API_BASE}/api/coupons/${encodeURIComponent(
          walletAddress
        )}`;
        console.log("[CouponWalletCard] Fetching coupons from:", url);

        const res = await fetch(url, {
          method: "GET",
          signal: abortController.signal,
        });

        const contentType = res.headers.get("content-type") || "";

        if (!contentType.includes("application/json")) {
          const text = await res.text();
          console.error(
            "[CouponWalletCard] Non-JSON response from coupons API:",
            text
          );
          throw new Error(
            `Coupons API did not return JSON (status ${res.status}). Check if the AI server on port 8787 is running and exposing GET /api/coupons/:walletAddress.`
          );
        }

        if (!res.ok) {
          const text = await res.text();
          console.error("[CouponWalletCard] Error response:", text);
          throw new Error(
            `Coupons API error (status ${res.status}): ${text.slice(0, 200)}`
          );
        }

        const data = await res.json();

        // server.js returns: { coupons: [...] }
        const coupons: CouponApiItem[] = Array.isArray(data?.coupons)
          ? data.coupons
          : [];

        console.log("[CouponWalletCard] Loaded coupons:", coupons);

        setState({
          loading: false,
          error: null,
          coupons,
        });
      } catch (err: any) {
        if (err?.name === "AbortError") return;

        console.error("[CouponWalletCard] Failed to load coupons:", err);
        setState({
          loading: false,
          error:
            err?.message ||
            "Failed to load coupons. Please try again or check the AI server logs.",
          coupons: [],
        });
      }
    };

    fetchCoupons();

    return () => {
      abortController.abort();
    };
  }, [walletAddress, refreshCounter]);

  const { loading, error, coupons } = state;

  const LAMPORTS_PER_SOL = 1_000_000_000;

  /**
   * Map a raw CouponApiItem into the CouponSummary structure used by the e-commerce page.
   */
  const mapToCouponSummary = (coupon: CouponApiItem): CouponSummary => {
    return {
      address: coupon.address,
      campaign: coupon.campaign,
      recipient: coupon.recipient,
      discount_bps: coupon.discount_bps ?? 0,
      max_discount_lamports: coupon.max_discount_lamports ?? 0,
      expiration_timestamp: coupon.expiration_timestamp ?? 0,
      category_code: coupon.category_code ?? 0,
      product_code: coupon.product_code ?? 0,
      is_used: !!coupon.is_used,
    };
  };

  /**
   * Handle click on a coupon card:
   * - If it is used or expired, ignore.
   * - If it is already selected, unselect it.
   * - Otherwise, select it and bubble up to the parent.
   */
  const handleCouponClick = (coupon: CouponApiItem) => {
    if (!onSelectCoupon) return;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const isExpired =
      !!coupon.expiration_timestamp &&
      coupon.expiration_timestamp > 0 &&
      coupon.expiration_timestamp < nowSeconds;

    const isUsed = !!coupon.is_used;

    if (isUsed || isExpired) {
      console.log(
        "[CouponWalletCard] Ignoring click on disabled coupon (used or expired).",
        {
          address: coupon.address,
          isUsed,
          isExpired,
        }
      );
      return;
    }

    const isCurrentlySelected =
      selectedCoupon && selectedCoupon.address === coupon.address;

    if (isCurrentlySelected) {
      console.log(
        "[CouponWalletCard] Unselecting currently selected coupon:",
        coupon.address
      );
      onSelectCoupon(null);
      return;
    }

    const mapped = mapToCouponSummary(coupon);
    console.log("[CouponWalletCard] Selecting coupon:", mapped);
    onSelectCoupon(mapped);
  };

  const renderBody = () => {
    if (!walletAddress) {
      return (
        <p className="text-sm text-muted-foreground">
          Connect your wallet to see available on-chain coupons for this
          shopper.
        </p>
      );
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center py-4 gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading coupons from on-chain data...</span>
        </div>
      );
    }

    if (error) {
      return (
        <Alert variant="destructive" className="mt-2">
          <AlertTitle>Failed to load coupons</AlertTitle>
          <AlertDescription className="break-words">
            {error}
          </AlertDescription>
        </Alert>
      );
    }

    if (coupons.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          No on-chain coupons found for this wallet yet. Keep shopping and let
          the AI Copilot create personalized campaigns for you.
        </p>
      );
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    // Only show coupons that are still available (not used and not expired)
    const availableCoupons = coupons.filter((coupon) => {
      const isUsed = !!coupon.is_used;
      const isExpired =
        !!coupon.expiration_timestamp &&
        coupon.expiration_timestamp > 0 &&
        coupon.expiration_timestamp < nowSeconds;

      return !isUsed && !isExpired;
    });

    if (availableCoupons.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          All your on-chain coupons have been used or expired. New campaigns
          will drop fresh coupons here.
        </p>
      );
    }

    return (
      <div className="space-y-3 max-h-44 overflow-y-auto pr-1">
        {availableCoupons.map((coupon) => {
          const discountPercent = coupon.discount_bps
            ? coupon.discount_bps / 100
            : 0;

          const maxDiscountSol = coupon.max_discount_lamports
            ? coupon.max_discount_lamports / LAMPORTS_PER_SOL
            : 0;

          const shortCoupon =
            coupon.address.length > 8
              ? `${coupon.address.slice(0, 5)}...${coupon.address.slice(-4)}`
              : coupon.address;

          const shortCampaign =
            coupon.campaign && coupon.campaign.length > 8
              ? `${coupon.campaign.slice(0, 5)}...${coupon.campaign.slice(
                  -4
                )}`
              : coupon.campaign || "—";

          const isSelected =
            !!selectedCoupon &&
            selectedCoupon.address === coupon.address;

          return (
            <button
              key={coupon.address}
              type="button"
              onClick={() => handleCouponClick(coupon)}
              className={[
                "flex flex-col rounded-md border p-3 text-sm w-full text-left transition-colors",
                "bg-muted/40 border-border",
                "hover:border-primary cursor-pointer",
                isSelected &&
                  "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <TicketPercent className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">
                    {discountPercent > 0
                      ? `${discountPercent.toFixed(1)}% off`
                      : "0% off"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {isSelected && (
                    <Badge
                      variant="outline"
                      className="border-primary text-primary"
                    >
                      Selected
                    </Badge>
                  )}
                  <Badge
                    variant="default"
                    className="bg-emerald-500/10 text-emerald-600"
                  >
                    Available
                  </Badge>
                </div>
              </div>

              {coupon.product_code !== undefined && (
                <p className="text-xs text-muted-foreground mb-1">
                  Product code:{" "}
                  <span className="font-mono">{coupon.product_code}</span>
                </p>
              )}

              {coupon.category_code !== undefined && (
                <p className="text-xs text-muted-foreground mb-1">
                  Category code:{" "}
                  <span className="font-mono">{coupon.category_code}</span>
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                Max discount:{" "}
                <span className="font-semibold text-foreground">
                  {maxDiscountSol.toFixed(4)} SOL
                </span>
              </p>

              <p className="mt-1 text-[11px] text-muted-foreground font-mono">
                Coupon: {shortCoupon} · Campaign: {shortCampaign}
              </p>

              {coupon.expiration_timestamp && coupon.expiration_timestamp > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Expires at:{" "}
                  <span className="font-mono">
                    {new Date(
                      coupon.expiration_timestamp * 1000
                    ).toLocaleString()}
                  </span>
                </p>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TicketPercent className="h-4 w-4 text-primary" />
          <span>Your On-chain Coupons</span>
        </CardTitle>
        <CardDescription className="text-xs">
          Coupons minted by the Promo Targeting program and linked to your
          wallet. Click a card to apply it to your order.
        </CardDescription>
      </CardHeader>
      <CardContent>{renderBody()}</CardContent>
    </Card>
  );
};

