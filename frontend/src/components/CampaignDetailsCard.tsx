// src/components/CampaignDetailsCard.tsx
import { useEffect, useState } from "react";
import type { OnChainCampaign } from "./CampaignsTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

interface CampaignDetailsCardProps {
  selectedCampaign: OnChainCampaign | null;
  /**
   * Optional callback triggered after a successful mint.
   * The parent can use this to refresh the campaigns table.
   */
  onMintSuccess?: () => void;
}

/**
 * Minimal e-commerce context shared via localStorage.
 * This is written by the Ecommerce page and read here in the dashboard.
 */
interface EcommerceContext {
  productId: string;
  productPriceLamports: number;
  shopperWallet: string;
}

/**
 * Load e-commerce context from localStorage.
 * This allows the dashboard to:
 *  - auto-fill the recipient wallet when minting a coupon
 *  - show which shopper / product the current session is associated with
 */
function loadEcommerceContextFromStorage(): EcommerceContext | null {
  if (typeof window === "undefined") return null;

  try {
    const shopperWallet = window.localStorage.getItem(
      "promoTargeting:shopperWallet"
    );
    const productRaw = window.localStorage.getItem(
      "promoTargeting:primaryProduct"
    );

    if (!shopperWallet || !productRaw) return null;

    const parsed = JSON.parse(productRaw) as {
      productId?: string;
      priceLamports?: number;
      priceSol?: number;
    };

    if (!parsed.productId) return null;

    const priceLamports =
      typeof parsed.priceLamports === "number"
        ? parsed.priceLamports
        : Math.round((parsed.priceSol ?? 0) * 1_000_000_000);

    return {
      productId: parsed.productId,
      productPriceLamports: priceLamports,
      shopperWallet,
    };
  } catch (err) {
    console.error("[CampaignDetailsCard] Failed to load e-commerce context:", err);
    return null;
  }
}

/**
 * Helper to format lamports -> SOL in a human-friendly way.
 */
function formatSol(lamports: number): string {
  if (!lamports || lamports <= 0) return "0 SOL";
  const sol = lamports / 1_000_000_000;
  if (sol < 0.001) {
    return `${(sol * 1_000).toFixed(2)} mSOL`;
  }
  return `${sol.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} SOL`;
}

/**
 * Helper to shorten long addresses for UI.
 */
function shortenAddress(addr: string): string {
  if (!addr || addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export const CampaignDetailsCard: React.FC<CampaignDetailsCardProps> = ({
  selectedCampaign,
  onMintSuccess,
}) => {
  const [walletInput, setWalletInput] = useState("");
  const [isMinting, setIsMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintSignature, setMintSignature] = useState<string | null>(null);

  const [ecommerceContext, setEcommerceContext] =
    useState<EcommerceContext | null>(null);

  // Load e-commerce context once (per mount)
  useEffect(() => {
    const ctx = loadEcommerceContextFromStorage();
    setEcommerceContext(ctx);
  }, []);

  // Whenever the selected campaign changes (or we get e-commerce context),
  // auto-fill the wallet input:
  //  - for targeted campaigns: use the campaign's target_wallet
  //  - otherwise: use the shopper wallet if present
  useEffect(() => {
    if (!selectedCampaign) {
      setWalletInput("");
      setMintError(null);
      setMintSignature(null);
      return;
    }

    setMintError(null);
    setMintSignature(null);

    if (selectedCampaign.requires_wallet && selectedCampaign.target_wallet) {
      setWalletInput(selectedCampaign.target_wallet);
    } else if (ecommerceContext?.shopperWallet) {
      setWalletInput(ecommerceContext.shopperWallet);
    } else {
      setWalletInput("");
    }
  }, [selectedCampaign, ecommerceContext]);

  if (!selectedCampaign) {
    return (
      <div className="bg-card border border-dashed border-border rounded-lg p-6 h-full flex items-center justify-center text-sm text-muted-foreground">
        No campaign selected yet. Click on a row in the table to see details
        and mint a test coupon.
      </div>
    );
  }

  const formatDiscount = (bps: number) =>
    `${(bps / 100).toFixed(1).replace(/\.0$/, "")}%`;

  const formatPeriod = (expirationTimestamp: number) => {
    if (!expirationTimestamp) return "—";
    const date = new Date(expirationTimestamp * 1000);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const deriveStatus = (): "active" | "scheduled" | "ended" => {
    const now = Math.floor(Date.now() / 1000);
    if (
      selectedCampaign.expiration_timestamp <= now ||
      selectedCampaign.used_coupons >= selectedCampaign.total_coupons
    ) {
      return "ended";
    }
    if (
      selectedCampaign.minted_coupons === 0 &&
      selectedCampaign.used_coupons === 0
    ) {
      return "scheduled";
    }
    return "active";
  };

  const getStatusLabel = (status: "active" | "scheduled" | "ended") => {
    switch (status) {
      case "active":
        return "Active";
      case "scheduled":
        return "Scheduled";
      case "ended":
        return "Ended";
    }
  };

  const getStatusColor = (status: "active" | "scheduled" | "ended") => {
    switch (status) {
      case "active":
        return "bg-success/10 text-success border-success/20";
      case "scheduled":
        return "bg-primary/10 text-primary border-primary/20";
      case "ended":
        return "bg-muted text-muted-foreground border-border";
    }
  };

  const handleMint = async () => {
    if (!selectedCampaign) return;

    const trimmed = walletInput.trim();
    if (!trimmed) {
      setMintError("Please enter a Solana wallet address to receive the coupon.");
      return;
    }

    // For targeted campaigns, enforce that the recipient wallet matches
    // the configured target_wallet to mirror the on-chain rule.
    if (
      selectedCampaign.requires_wallet &&
      selectedCampaign.target_wallet &&
      trimmed !== selectedCampaign.target_wallet
    ) {
      setMintError(
        "This is a targeted campaign. The recipient wallet must match the campaign target wallet."
      );
      return;
    }

    setIsMinting(true);
    setMintError(null);
    setMintSignature(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/mint-coupon`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaignAddress: selectedCampaign.address,
          customerWallet: trimmed,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        const msg =
          data?.details ||
          data?.error ||
          `Mint failed with status ${res.status}`;
        throw new Error(msg);
      }

      setMintSignature(data.signature || null);

      if (onMintSuccess) {
        onMintSuccess();
      }
    } catch (err: any) {
      console.error("[CampaignDetailsCard] Mint failed:", err);
      setMintError(err.message || "Failed to mint coupon.");
    } finally {
      setIsMinting(false);
    }
  };

  const status = deriveStatus();

  return (
    <div className="bg-card border border-border rounded-lg p-6 flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {selectedCampaign.campaign_name || "(unnamed campaign)"}
          </h2>
          <p className="text-xs text-muted-foreground break-all">
            {selectedCampaign.address}
          </p>
        </div>
        <Badge variant="outline" className={getStatusColor(status)}>
          {getStatusLabel(status)}
        </Badge>
      </div>

      {/* Main metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Discount</p>
          <p className="font-semibold">
            {formatDiscount(selectedCampaign.discount_bps)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">
            Service fee (over discount)
          </p>
          <p className="font-semibold">
            {formatDiscount(selectedCampaign.service_fee_bps)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Resale share</p>
          <p className="font-semibold">
            {formatDiscount(selectedCampaign.resale_bps)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Expiration</p>
          <p className="font-semibold">
            {formatPeriod(selectedCampaign.expiration_timestamp)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">
            Supply (minted / total)
          </p>
          <p className="font-semibold">
            {selectedCampaign.minted_coupons} /{" "}
            {selectedCampaign.total_coupons}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Redeemed coupons</p>
          <p className="font-semibold">{selectedCampaign.used_coupons}</p>
        </div>
      </div>

      {/* Targeting info */}
      <div className="border-t border-border pt-4 mt-2 text-sm space-y-1">
        <p className="text-xs font-semibold text-muted-foreground mb-1">
          Targeting
        </p>
        <p className="text-sm">
          {selectedCampaign.requires_wallet
            ? "Targeted campaign (requires matching wallet)."
            : "Open campaign (any wallet can receive coupons)."}
        </p>
        {selectedCampaign.requires_wallet && selectedCampaign.target_wallet && (
          <p className="text-xs text-muted-foreground mt-1 break-all">
            Target wallet: {selectedCampaign.target_wallet} (
            {shortenAddress(selectedCampaign.target_wallet)})
          </p>
        )}

        {ecommerceContext && (
          <p className="text-[11px] text-muted-foreground mt-1">
            E-commerce context: shopper wallet{" "}
            <span className="font-mono">
              {shortenAddress(ecommerceContext.shopperWallet)}
            </span>
            , product ID{" "}
            <span className="font-mono">{ecommerceContext.productId}</span>, price ~{" "}
            {formatSol(ecommerceContext.productPriceLamports)}.
          </p>
        )}
      </div>

      {/* Mint test coupon section */}
      <div className="border-t border-border pt-4 mt-2 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">
            Mint test coupon
          </p>
          <p className="text-xs text-muted-foreground">
            Uses devnet and the campaign&apos;s on-chain budget.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground">
            Recipient wallet (Solana address)
          </label>
          <Input
            placeholder="Enter a devnet wallet address"
            value={walletInput}
            onChange={(e) => setWalletInput(e.target.value)}
            className="text-sm"
          />
          {selectedCampaign.requires_wallet &&
            selectedCampaign.target_wallet && (
              <p className="text-[11px] text-muted-foreground">
                This campaign is targeted. The recipient must be{" "}
                <span className="font-mono">
                  {shortenAddress(selectedCampaign.target_wallet)}
                </span>
                .
              </p>
            )}
        </div>

        {mintError && (
          <div className="text-xs text-destructive bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2">
            {mintError}
          </div>
        )}

        {mintSignature && (
          <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2 break-all">
            Mint transaction:{" "}
            <a
              href={`https://explorer.solana.com/tx/${mintSignature}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {mintSignature}
            </a>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleMint}
            disabled={isMinting || deriveStatus() === "ended"}
          >
            {isMinting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {deriveStatus() === "ended" ? "Campaign ended" : "Mint test coupon"}
          </Button>
        </div>
      </div>
    </div>
  );
};

// Support both named and default import styles
export default CampaignDetailsCard;
