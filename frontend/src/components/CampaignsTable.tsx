// src/components/CampaignsTable.tsx
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

export interface OnChainCampaign {
  address: string;
  merchant: string | null;
  campaign_id: number;
  created_at?: number | null;
  discount_bps: number;
  service_fee_bps: number;
  resale_bps: number;
  expiration_timestamp: number;
  total_coupons: number;
  used_coupons: number;
  minted_coupons: number;
  mint_cost_lamports: number;
  max_discount_lamports: number;
  category_code: number;
  product_code: number;
  campaign_name: string;
  requires_wallet: boolean;
  target_wallet: string | null;
}

type CampaignStatus = "active" | "scheduled" | "ended";

interface CampaignsTableProps {
  refreshKey: number;
  /**
   * Optional callback used by the parent to know which campaign
   * was clicked in the table.
   */
  onSelectCampaign?: (campaign: OnChainCampaign) => void;
  /**
   * Optional callback whenever the internal campaigns list is refreshed.
   * Enables parent dashboards to reuse the same data for analytics.
   */
  onCampaignsLoaded?: (campaigns: OnChainCampaign[]) => void;
}

export const CampaignsTable: React.FC<CampaignsTableProps> = ({
  refreshKey,
  onSelectCampaign,
  onCampaignsLoaded,
}) => {
  const [campaigns, setCampaigns] = useState<OnChainCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCampaigns = async () => {
    setIsLoading(true);
    setError(null);

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

      setCampaigns(data.campaigns);
      onCampaignsLoaded?.(data.campaigns);
    } catch (err: any) {
      console.error("[CampaignsTable] Failed to fetch campaigns:", err);
      setError(err.message || "Failed to load on-chain campaigns.");
      onCampaignsLoaded?.([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const formatUsd = (value: number) =>
    `$${value.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;

  const formatDiscount = (bps: number) =>
    `${(bps / 100).toFixed(1).replace(/\.0$/, "")}%`;

  const formatPeriod = (expirationTimestamp: number) => {
    if (!expirationTimestamp) return "—";
    const date = new Date(expirationTimestamp * 1000);
    return `Until ${date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })}`;
  };

  const deriveStatus = (c: OnChainCampaign): CampaignStatus => {
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

  const getStatusColor = (status: CampaignStatus) => {
    switch (status) {
      case "active":
        return "bg-success/10 text-success border-success/20";
      case "scheduled":
        return "bg-primary/10 text-primary border-primary/20";
      case "ended":
        return "bg-muted text-muted-foreground border-border";
    }
  };

  const deriveRedeemRate = (c: OnChainCampaign): string => {
    const denominator = c.minted_coupons || c.total_coupons || 0;
    if (!denominator) return "—";
    const rate = (c.used_coupons / denominator) * 100;
    return `${rate.toFixed(0)}%`;
  };

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden w-full">
      <div className="overflow-x-auto">
        {isLoading && (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading on-chain campaigns from Solana devnet…</span>
          </div>
        )}

        {error && !isLoading && (
          <div className="p-4 text-sm text-destructive">
            Failed to load campaigns: {error}
          </div>
        )}

        {!isLoading && !error && campaigns.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No on-chain campaigns found yet. Use{" "}
            <span className="font-semibold">“Create Demo Campaign”</span> in the
            AI Copilot to bootstrap your first campaign on devnet.
          </div>
        )}

        {!isLoading && !error && campaigns.length > 0 && (
          /**
           * Limit visible rows to ~4 and enable vertical scrolling
           * while keeping horizontal scrolling for narrow screens.
           */
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full">
              <thead className="bg-table-header border-b border-border">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Campaign Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Audience
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Discount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Period
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Supply (Minted / Total)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Redeemed
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Redeem Rate
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Purchase Volume
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Secondary Trades
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {campaigns
                  .slice()
                  .sort((a, b) => {
                    const statusOrder = { active: 0, scheduled: 1, ended: 2 };
                    const statusA = statusOrder[deriveStatus(a)] ?? 3;
                    const statusB = statusOrder[deriveStatus(b)] ?? 3;
                    if (statusA !== statusB) return statusA - statusB;

                    if (a.campaign_id && b.campaign_id) {
                      return b.campaign_id - a.campaign_id;
                    }

                    const aCreated = Number(a.campaign_id || 0);
                    const bCreated = Number(b.campaign_id || 0);
                    return bCreated - aCreated;
                  })
                  .map((c) => {
                  const status = deriveStatus(c);
                  return (
                    <tr
                      key={c.address}
                      className="hover:bg-table-row-hover transition-colors cursor-pointer"
                      onClick={() => onSelectCampaign?.(c)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-foreground">
                          {c.campaign_name || "(unnamed campaign)"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {c.address}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-muted-foreground">
                          {c.requires_wallet
                            ? "Requires wallet (targeted)"
                            : "All users (open)"}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-foreground">
                          {formatDiscount(c.discount_bps)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-muted-foreground">
                          {formatPeriod(c.expiration_timestamp)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-foreground">
                          {c.minted_coupons} / {c.total_coupons}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-foreground">
                          {c.used_coupons}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-foreground">
                          {deriveRedeemRate(c)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {/* For now we do not have on-chain purchase volume. Mock as 0. */}
                        <div className="text-sm font-medium text-foreground">
                          {formatUsd(0)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {/* For now we do not count secondary trades. Mock as 0. */}
                        <div className="text-sm font-medium text-foreground">
                          0
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className={getStatusColor(status)}
                        >
                          {status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
