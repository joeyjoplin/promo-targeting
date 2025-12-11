// src/components/ecommerce/CartSummary.tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CartItem, CouponSummary } from "@/pages/Ecommerce";
import { Minus, Plus, X } from "lucide-react";

interface CartSummaryProps {
  cart: CartItem[];
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;

  // Pricing / discount values are computed in the parent (Ecommerce)
  subtotal: number;
  discountAmount: number;
  total: number;

  // On-chain coupon currently applied
  selectedCoupon?: CouponSummary | null;
  onClearCoupon?: () => void;
}

export const CartSummary = ({
  cart,
  onUpdateQuantity,
  onRemove,
  onCheckout,
  subtotal,
  discountAmount,
  total,
  selectedCoupon,
  onClearCoupon,
}: CartSummaryProps) => {
  const hasDiscount = !!selectedCoupon && discountAmount > 0;

  // Helper to format SOL amounts consistently
  const formatSol = (value: number) => `${value.toFixed(3)} SOL`;

  const effectiveDiscountPercent = selectedCoupon
    ? selectedCoupon.discount_bps / 100 // basis points -> percent
    : 0;

  const handleCheckoutClick = () => {
    console.log("[CartSummary] Checkout clicked with state:", {
      subtotal,
      discountAmount,
      total,
      hasDiscount,
      selectedCoupon: selectedCoupon
        ? {
            address: selectedCoupon.address,
            campaign: selectedCoupon.campaign,
            discount_bps: selectedCoupon.discount_bps,
            max_discount_lamports: selectedCoupon.max_discount_lamports,
            product_code: selectedCoupon.product_code,
            category_code: selectedCoupon.category_code,
          }
        : null,
      cartSnapshot: cart.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
    });

    onCheckout();
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6 sticky top-6">
      <h2 className="text-xl font-semibold text-foreground mb-6">
        Cart Summary
      </h2>

      {cart.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          Your cart is empty
        </p>
      ) : (
        <>
          <div className="space-y-4 mb-6">
            {cart.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 pb-4 border-b border-border last:border-0"
              >
                <img
                  src={item.image}
                  alt={item.name}
                  className="w-16 h-16 rounded object-cover"
                />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-foreground truncate">
                    {item.name}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {formatSol(item.price)}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        const nextQty = item.quantity - 1;
                        console.log(
                          "[CartSummary] Decrement quantity",
                          item.id,
                          "from",
                          item.quantity,
                          "to",
                          nextQty
                        );
                        onUpdateQuantity(item.id, nextQty);
                      }}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="text-sm font-medium w-8 text-center">
                      {item.quantity}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        const nextQty = item.quantity + 1;
                        console.log(
                          "[CartSummary] Increment quantity",
                          item.id,
                          "from",
                          item.quantity,
                          "to",
                          nextQty
                        );
                        onUpdateQuantity(item.id, nextQty);
                      }}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {
                    console.log("[CartSummary] Remove item from cart:", {
                      id: item.id,
                      name: item.name,
                    });
                    onRemove(item.id);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* On-chain coupon section */}
          <div className="space-y-4 mb-6">
            {selectedCoupon ? (
              <div className="flex items-center justify-between bg-success/10 border border-success/20 rounded-md p-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-success/20 text-success border-success/30">
                      On-chain coupon
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">
                      {selectedCoupon.address.slice(0, 4)}...
                      {selectedCoupon.address.slice(-4)}
                    </span>
                  </div>
                  <span className="text-sm text-success">
                    {effectiveDiscountPercent.toFixed(0)}% off (capped by vault
                    balance)
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    console.log(
                      "[CartSummary] Clear selected on-chain coupon",
                      selectedCoupon.address
                    );
                    onClearCoupon && onClearCoupon();
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Select an on-chain coupon from your wallet above to apply a
                discount to this order.
              </p>
            )}
          </div>

          {/* Totals */}
          <div className="space-y-2 mb-6 pb-6 border-b border-border">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-foreground">{formatSol(subtotal)}</span>
            </div>

            {hasDiscount && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span className="text-success">
                  -{formatSol(discountAmount)}
                </span>
              </div>
            )}

            <div className="flex justify-between text-lg font-semibold pt-2">
              <span className="text-foreground">Total</span>
              <span className="text-foreground">{formatSol(total)}</span>
            </div>
          </div>

          <Button
            className="w-full h-11 text-base font-medium"
            onClick={handleCheckoutClick}
            disabled={cart.length === 0 || total <= 0}
          >
            Pay with Solana Pay
          </Button>

          <p className="text-xs text-muted-foreground text-center mt-3">
            Secure Web3 payment via Solana blockchain (amount already includes
            on-chain coupon discounts)
          </p>
        </>
      )}
    </div>
  );
};
