// src/components/AICampaignAssistant.tsx
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Sparkles, Rocket } from "lucide-react";
import { findProductByCode } from "@/data/products";

type Role = "user" | "assistant";

interface AIAssistantMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: string;
}

interface CampaignProposal {
  name: string;
  audience: string | null;
  period_label: string | null;

  discount_bps: number;
  service_fee_bps: number;
  resale_bps: number;

  expiration_timestamp: number;

  total_coupons: number;
  minted_coupons: number;
  used_coupons: number;

  mint_cost_lamports: number;
  max_discount_lamports: number;
  deposit_amount_lamports: number;

  category_code: number;
  product_code: number;

  requires_wallet: boolean;
  target_wallet: string | null;
}

/**
 * Shopper context coming from the Ecommerce page.
 * This is stored in localStorage and read by the dashboard.
 * The AI backend will use it to propose targeted campaigns for
 * the currently logged shopper (wallet + product intent).
 */
export interface ShopperContext {
  productId: string | null;
  productPriceSol: number | null;
  walletAddress: string | null;
  cartSnapshot: Array<{
    id: string;
    quantity: number;
    price: number;
  }>;
  updatedAt: string;
}

interface AICampaignAssistantProps {
  totalActiveCampaigns?: number;
  totalBudgetUsd?: number;
  avgDiscountPercent?: number;
  overallConversion?: number;
  onCampaignCreated?: (campaignAddress?: string | null) => void;
  /**
   * Optional shopper context from the e-commerce frontend.
   * If present, the AI engine can:
   * - map productId → category_code / product_code
   * - compute max_discount_lamports from productPriceSol
   * - enforce requires_wallet / target_wallet when needed
   */
  shopperContext?: ShopperContext | null;
}

const API_BASE_URL =
  import.meta.env.VITE_AI_API_BASE_URL ?? "http://localhost:8787";

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
 * Helper to format bps -> %.
 */
function formatBps(bps: number): string {
  if (!bps || bps <= 0) return "0%";
  const pct = bps / 100;
  return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
}

/**
 * Helper to format a unix timestamp (seconds) into a short human-readable date.
 */
function formatTimestamp(ts: number | null | undefined): string {
  if (!ts || ts <= 0) return "—";
  const date = new Date(ts * 1000);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Helper to shorten a base58 address for UI.
 */
function shortenAddress(addr: string, size = 4): string {
  if (!addr || addr.length <= size * 2) return addr;
  return `${addr.slice(0, size)}...${addr.slice(-size)}`;
}

export const AICampaignAssistant: React.FC<AICampaignAssistantProps> = ({
  totalActiveCampaigns,
  totalBudgetUsd,
  avgDiscountPercent,
  overallConversion,
  onCampaignCreated,
  shopperContext,
}) => {
  const [messages, setMessages] = useState<AIAssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  const [proposal, setProposal] = useState<CampaignProposal | null>(null);

  /**
   * Send a natural-language request to the AI advisor backend and get
   * a structured proposal back.
   */
  const handleAskAI = async () => {
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;

    const userMessage: AIAssistantMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsThinking(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/ai-campaign-advisor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmed,
          metrics: {
            active_campaigns: totalActiveCampaigns ?? 0,
            avg_redeem_rate: overallConversion ?? 0,
            est_roi: 3.2,
          },
          profile: {
            risk_tolerance: "medium",
            vertical: "ecommerce",
            avg_discount_percent: avgDiscountPercent ?? 0,
            total_budget_usd: totalBudgetUsd ?? 0,
          },
          campaigns: [],
          // Pass shopper context so the AI can:
          // - personalize parameters based on cart + wallet
          shopper_context: shopperContext ?? null,
        }),
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`API error: ${response.status} - ${text}`);
      }

      const data = JSON.parse(text) as {
        reply?: string;
        proposal?: CampaignProposal | null;
      };

      const assistantText =
        data.reply ??
        "I could not generate a proposal right now. Please try again in a few seconds.";

      const assistantMessage: AIAssistantMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: assistantText,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setProposal(normalizeProposal(data.proposal ?? null, shopperContext));

      console.log("[AICampaignAssistant] Received AI proposal:", data.proposal);
    } catch (err: any) {
      console.error("[AICampaignAssistant] Error calling AI API:", err);
      const errorMessage: AIAssistantMessage = {
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        content:
          "Sorry, something went wrong while talking to the AI service. Please try again in a moment.",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      setProposal(null);
    } finally {
      setIsThinking(false);
    }
  };

  /**
   * Allow "Enter" to send the message and "Shift+Enter" to insert a new line.
   */
  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAskAI();
    }
  };

  /**
   * Create an on-chain campaign using the current AI proposal.
   * If we have shopperContext, we prefer the actual shopper wallet
   * instead of the DEMO_CUSTOMER_WALLET placeholder.
   */
  const handleCreateDemoCampaign = async () => {
    if (creatingCampaign || !proposal) return;
    setCreatingCampaign(true);

    const effectiveWallet =
      shopperContext?.walletAddress && shopperContext.walletAddress.length > 0
        ? shopperContext.walletAddress
        : "DEMO_CUSTOMER_WALLET";

    try {
      const response = await fetch(`${API_BASE_URL}/api/create-campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: effectiveWallet,
          proposal,
          // Pass shopper context again so the backend can map productId -> codes, etc.
          shopper_context: shopperContext ?? null,
        }),
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`API error: ${response.status} - ${text}`);
      }

      const data = JSON.parse(text);

      const assistantMessage: AIAssistantMessage = {
        id: `assistant-create-${Date.now()}`,
        role: "assistant",
        content:
          "Your campaign has been created on Solana devnet.\n\n" +
          `- Merchant (server): \`${data.merchantAddress}\`\n` +
          `- Campaign PDA: \`${data.campaignPda}\`\n` +
          `- Vault PDA: \`${data.vaultPda}\`\n` +
          `- Tx signature: \`${data.signature}\`\n\n` +
          "You can inspect it in Solana Explorer. The dashboard will now include this campaign in the Active Campaigns table.",
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (onCampaignCreated) {
        onCampaignCreated(data.campaignPda as string);
      }
    } catch (err: any) {
      console.error("Error creating on-chain campaign:", err);
      const assistantMessage: AIAssistantMessage = {
        id: `assistant-create-error-${Date.now()}`,
        role: "assistant",
        content:
          "I could not create the on-chain campaign. Please check the `ai-server` (RPC, IDL, PROGRAM_ID) and try again.",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setCreatingCampaign(false);
    }
  };

  const hasShopperContext =
    !!shopperContext &&
    (!!shopperContext.walletAddress ||
      !!shopperContext.productId ||
      (shopperContext.cartSnapshot?.length ?? 0) > 0);

  // Derived label for the audience field in the proposal summary
  const getAudienceLabel = (p: CampaignProposal | null): string => {
    if (!p) return "—";
    if (p.requires_wallet || p.target_wallet) {
      if (p.target_wallet) {
        return `Targeted wallet (${shortenAddress(p.target_wallet)})`;
      }
      return "Requires wallet (targeted)";
    }
    return "All users (open)";
  };

  return (
    <Card className="border border-border bg-card/80 backdrop-blur-sm">
      {/* Chat area */}
      <ScrollArea className="h-64 p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-line ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground border border-border"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isThinking && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Thinking about the best campaign parameters…</span>
          </div>
        )}
      </ScrollArea>

      {/* Input + actions + AI proposal preview */}
      <div className="border-t border-border p-4 space-y-4">
        <div className="flex gap-3">
          <Textarea
            placeholder='Example: "Create a campaign for all users with 10% discount for the product in the cart."'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[52px] resize-none text-sm"
          />
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleAskAI}
              disabled={isThinking || !input.trim()}
              className="h-10 px-4 flex items-center gap-2"
            >
              {isThinking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Asking AI…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Ask AI
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleCreateDemoCampaign}
              disabled={creatingCampaign || !proposal}
              className="h-9 px-3 text-xs flex items-center gap-2"
            >
              {creatingCampaign ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Creating on-chain campaign…
                </>
              ) : (
                <>
                  <Rocket className="h-3 w-3" />
                  Create Demo Campaign
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Proposed campaign summary (off-chain, from AI) */}
        <div className="mt-2">
          {proposal ? (
            <Card className="border border-dashed border-border bg-muted/40 p-3 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">
                  Proposed campaign parameters
                </span>
                <span className="text-[10px] uppercase text-muted-foreground">
                  Review before creating on-chain
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                <div>
                  <div className="text-[11px] text-muted-foreground">Name</div>
                  <div className="text-xs font-medium">
                    {proposal.name || "Untitled campaign"}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground">
                    Audience
                  </div>
                  <div className="text-xs font-medium">
                    {getAudienceLabel(proposal)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground">
                    Discount
                  </div>
                  <div className="text-xs font-medium">
                    {formatBps(proposal.discount_bps)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground">
                    Service Fee
                  </div>
                  <div className="text-xs font-medium">
                    {formatBps(proposal.service_fee_bps)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground">
                    Resale Fee
                  </div>
                  <div className="text-xs font-medium">
                    {formatBps(proposal.resale_bps)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground">
                    Expires At
                  </div>
                  <div className="text-xs font-medium">
                    {proposal.period_label
                      ? proposal.period_label
                      : formatTimestamp(proposal.expiration_timestamp)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground">
                    Total Coupons
                  </div>
                  <div className="text-xs font-medium">
                    {proposal.total_coupons}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground">
                    Mint Cost / Coupon
                  </div>
                  <div className="text-xs font-medium">
                    {formatSol(proposal.mint_cost_lamports)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground">
                    Max Discount / Coupon
                  </div>
                  <div className="text-xs font-medium">
                    {formatSol(proposal.max_discount_lamports)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground">
                    Vault Budget (Deposit)
                  </div>
                  <div className="text-xs font-medium">
                    {formatSol(proposal.deposit_amount_lamports)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground">
                    Category / Product
                  </div>
                  <div className="text-xs font-medium">
                    {proposal.category_code} / {proposal.product_code}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground">
                    Target Wallet
                  </div>
                  <div className="text-xs font-medium">
                    {proposal.target_wallet
                      ? shortenAddress(proposal.target_wallet)
                      : "Not specified (open campaign)"}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground pt-1">
                If this looks good, click{" "}
                <span className="font-semibold">“Create Demo Campaign”</span>{" "}
                to deploy it on Solana devnet. If not, adjust your natural
                language prompt and click{" "}
                <span className="font-semibold">“Ask AI”</span> again.
              </div>

              {hasShopperContext && !proposal.requires_wallet && (
                <div className="text-[11px] text-emerald-700 dark:text-emerald-400 pt-1">
                  Note: a shopper is currently connected, but this proposal is
                  configured as an{" "}
                  <span className="font-semibold">open campaign</span> for all
                  users. If you want a targeted campaign for the logged wallet,
                  mention it explicitly in your prompt (for example: “for the
                  logged customer only”).
                </div>
              )}
            </Card>
          ) : (
            <div className="text-[11px] text-muted-foreground">
              No proposal yet. Describe the campaign you want (for example:
              “Create a Christmas campaign for all users with a 0.1 SOL
              budget”) and click{" "}
              <span className="font-semibold">“Ask AI”</span>.
            </div>
          )}
        </div>

        {/* Shopper context debug / visibility */}
        <div className="text-[11px] text-muted-foreground pt-1">
          {hasShopperContext ? (
            <div className="mt-2 border border-dashed border-border rounded-md px-3 py-2 bg-muted/30">
              <div className="font-semibold mb-1">
                Shopper context detected (from Ecommerce)
              </div>
              {shopperContext?.walletAddress && (
                <div>
                  Wallet:{" "}
                  <span className="font-mono">
                    {shortenAddress(shopperContext.walletAddress)}
                  </span>
                </div>
              )}
              {shopperContext?.productId && (
                <div>
                  Primary product id:{" "}
                    <span className="font-mono">
                      {shopperContext.productId}
                    </span>{" "}
                  {typeof shopperContext.productPriceSol === "number" && (
                    <>({shopperContext.productPriceSol} SOL)</>
                  )}
                </div>
              )}
              {shopperContext?.cartSnapshot?.length ? (
                <div>
                  Cart items: {shopperContext.cartSnapshot.length} (snapshot at{" "}
                  {new Date(shopperContext.updatedAt).toLocaleTimeString()})
                </div>
              ) : null}
              <div className="mt-1">
                You can ask things like{" "}
                <span className="italic">
                  “Create a campaign for the product in the cart” or “Create a
                  campaign for the logged customer”.
                </span>
              </div>
            </div>
          ) : (
            <span>
              No shopper context detected. Open the Ecommerce page, connect a
              wallet, add a product to the cart and then return here to create a
              targeted campaign.
            </span>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground pt-1">
          After the campaign is created on-chain, it will appear in the{" "}
          <span className="font-semibold">Active Campaigns</span> table above,
          where you can inspect its parameters and mint test coupons from the
          dashboard.
        </div>
      </div>
    </Card>
  );
};
const LAMPORTS_PER_SOL = 1_000_000_000;
const normalizeProposal = (
  proposal: CampaignProposal | null,
  shopperContext?: ShopperContext | null
): CampaignProposal | null => {
  if (!proposal) return null;

  const discountBps = Number(proposal.discount_bps || 0);
  const serviceFeeBps =
    Number(proposal.service_fee_bps || 0) || 1000;
  const totalCoupons = Number(proposal.total_coupons || 0) || 0;

  let mintCostLamports = Number(proposal.mint_cost_lamports || 0);
  if (mintCostLamports <= 0) {
    mintCostLamports = 1_000_000;
  }

  let productPriceSol: number | null = null;
  if (
    shopperContext &&
    typeof shopperContext.productPriceSol === "number" &&
    shopperContext.productPriceSol > 0
  ) {
    productPriceSol = shopperContext.productPriceSol;
  } else if (
    typeof proposal.product_code === "number" &&
    proposal.product_code > 0
  ) {
    const product = findProductByCode(proposal.product_code);
    if (product?.price) {
      productPriceSol = product.price;
    }
  }

  let maxDiscountLamports = Number(
    typeof proposal.max_discount_lamports === "number"
      ? proposal.max_discount_lamports
      : 0
  );

  if (productPriceSol && discountBps > 0) {
    const discountSol = productPriceSol * (discountBps / 10_000);
    maxDiscountLamports = Math.max(
      1,
      Math.round(discountSol * LAMPORTS_PER_SOL)
    );
  }

  const feeLamportsPerCoupon = Math.floor(
    maxDiscountLamports * (serviceFeeBps / 10_000)
  );
  const perCouponVaultRequirement =
    mintCostLamports + feeLamportsPerCoupon;

  let depositAmountLamports =
    perCouponVaultRequirement * (totalCoupons || 0);
  if (depositAmountLamports <= 0) {
    depositAmountLamports =
      perCouponVaultRequirement || mintCostLamports;
  }

  return {
    ...proposal,
    service_fee_bps: serviceFeeBps,
    mint_cost_lamports: mintCostLamports,
    max_discount_lamports: maxDiscountLamports,
    deposit_amount_lamports: depositAmountLamports,
  };
};
