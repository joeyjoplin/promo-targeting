import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DiscountToken } from "@/pages/Marketplace";
import { Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface DiscountCardProps {
  token: DiscountToken;
  onClaim: (token: DiscountToken) => void;
  walletConnected: boolean;
}

export const DiscountCard = ({
  token,
  onClaim,
  walletConnected,
}: DiscountCardProps) => {
  const totalSupply = token.totalSupply || 0;
  const supplyPercentage =
    totalSupply > 0 ? (token.supply / totalSupply) * 100 : 0;
  const soldOut =
    totalSupply > 0 ? token.supply >= totalSupply : false;

  const getLabelColor = (label?: string) => {
    switch (label) {
      case "New":
        return "bg-primary/10 text-primary border-primary/20";
      case "Trending":
        return "bg-warning/10 text-warning border-warning/20";
      case "Ending Soon":
        return "bg-destructive/10 text-destructive border-destructive/20";
      default:
        return "";
    }
  };

  const handleClaim = () => {
    onClaim(token);
    toast({
      title: "Token claimed!",
      description: `${token.title} has been added to your wallet.`,
    });
  };

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden hover:shadow-lg hover:border-primary/20 transition-all group">
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={token.image}
          alt={token.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        {token.label && (
          <Badge
            variant="outline"
            className={`absolute top-3 right-3 ${getLabelColor(token.label)}`}
          >
            {token.label}
          </Badge>
        )}
        <div className="absolute top-3 left-3 bg-background/90 backdrop-blur-sm rounded-full px-3 py-1.5">
          <span className="text-2xl font-bold text-primary">
            {token.discount}%
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        <div className="mb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            {token.merchant}
          </p>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {token.title}
          </h3>
          <Badge variant="secondary" className="text-xs">
            {token.category}
          </Badge>
        </div>

        {/* Supply */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">Supply</span>
            <span className="font-medium text-foreground">
              {token.supply.toLocaleString()} / {token.totalSupply.toLocaleString()}
            </span>
          </div>
          <Progress value={supplyPercentage} className="h-2" />
        </div>

        {/* Claim Button */}
        <Button
          onClick={handleClaim}
          className="w-full"
          disabled={soldOut}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {soldOut ? "Sold Out" : "Claim Token"}
        </Button>
      </div>
    </div>
  );
};
