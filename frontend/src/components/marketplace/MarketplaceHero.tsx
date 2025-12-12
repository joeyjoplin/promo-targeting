import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye } from "lucide-react";
import { WalletConnectButton } from "@/components/WalletConnectButton";

interface MarketplaceHeroProps {
  walletConnected: boolean;
  onViewWallet: () => void;
}

export const MarketplaceHero = ({
  walletConnected,
  onViewWallet,
}: MarketplaceHeroProps) => {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-accent/5 border-b border-border">
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
        <div className="mx-auto max-w-3xl text-center">
          {/* Status Badge */}
          {walletConnected && (
            <Badge
              variant="outline"
              className="mb-6 bg-success/10 text-success border-success/20"
            >
              <div className="h-2 w-2 rounded-full bg-success mr-2" />
              Wallet Connected
            </Badge>
          )}

          {/* Title */}
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground tracking-tight mb-6">
            Discover, Claim & Trade
            <br />
            <span className="text-primary">Discount Tokens</span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            Airdropped promotions from real merchants, powered by Web3.
            <br />
            Claim free tokens or trade on the secondary market.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            {!walletConnected && (
              <WalletConnectButton />
            )}
            {walletConnected && (
              <Button
                size="lg"
                variant="outline"
                onClick={onViewWallet}
                className="h-12 px-8 text-base font-medium"
              >
                <Eye className="mr-2 h-5 w-5" />
                View My Tokens
              </Button>
            )}
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-3 gap-8 max-w-xl mx-auto">
            <div>
              <div className="text-3xl font-bold text-foreground">12K+</div>
              <div className="text-sm text-muted-foreground mt-1">
                Tokens Claimed
              </div>
            </div>
            <div>
              <div className="text-3xl font-bold text-foreground">350+</div>
              <div className="text-sm text-muted-foreground mt-1">
                Merchants
              </div>
            </div>
            <div>
              <div className="text-3xl font-bold text-foreground">$2.4M</div>
              <div className="text-sm text-muted-foreground mt-1">
                Value Saved
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Decorative gradient orbs */}
      <div className="absolute top-1/4 -left-48 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 -right-48 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
    </section>
  );
};
