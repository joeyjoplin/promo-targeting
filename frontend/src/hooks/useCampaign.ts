// src/hooks/useCampaign.ts
import { useCallback, useEffect, useState } from "react";

// Reuse the same base URL used by AICampaignAssistant
const API_BASE_URL =
  import.meta.env.VITE_AI_API_BASE_URL ?? "http://localhost:8787";

export type CampaignAccount = {
  pubkey: string;
  lamports: number;
  data: {
    merchant: string;
    campaign_id: string; // BN serialized as string
    discount_bps: number;
    service_fee_bps: number;
    resale_bps: number;
    expiration_timestamp: string; // BN serialized as string
    total_coupons: number;
    used_coupons: number;
    minted_coupons: number;
    mint_cost_lamports: string; // BN serialized as string
    max_discount_lamports: string; // BN serialized as string
    category_code: number;
    product_code: number;
    campaign_name: string;
    requires_wallet: boolean;
    target_wallet: string;
  };
};

export interface UseCampaignResult {
  campaign: CampaignAccount | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * React hook to fetch and keep a single Campaign account in state.
 *
 * - Calls the backend endpoint: GET /api/campaign/:address
 * - The backend decodes the Anchor account using the IDL and returns JSON.
 * - This hook is read-only and safe to use in any dashboard component.
 */
export function useCampaign(
  campaignAddress: string | null | undefined
): UseCampaignResult {
  const [campaign, setCampaign] = useState<CampaignAccount | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCampaign = useCallback(async () => {
    if (!campaignAddress) {
      setCampaign(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/campaign/${campaignAddress}`
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Backend error (${res.status}): ${
            text || "Failed to fetch campaign"
          }`
        );
      }

      const data = (await res.json()) as CampaignAccount;
      setCampaign(data);
    } catch (err: any) {
      console.error("[useCampaign] Failed to fetch campaign:", err);
      setError(err?.message ?? "Unknown error while fetching campaign");
      setCampaign(null);
    } finally {
      setLoading(false);
    }
  }, [campaignAddress]);

  useEffect(() => {
    void fetchCampaign();
  }, [fetchCampaign]);

  return {
    campaign,
    loading,
    error,
    refetch: fetchCampaign,
  };
}
