import { Button } from "@/components/ui/button";
import { Product } from "@/pages/Ecommerce";
import { ShoppingCart } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface ProductCardProps {
  product: Product;
  onAddToCart: (product: Product) => void;
}

export const ProductCard = ({ product, onAddToCart }: ProductCardProps) => {
  const handleAddToCart = () => {
    onAddToCart(product);
    toast({
      title: "Added to cart",
      description: `${product.name} has been added to your cart.`,
    });
  };

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden hover:shadow-md transition-shadow group">
      <div className="aspect-square overflow-hidden bg-muted">
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      </div>
      <div className="p-5">
        <h3 className="text-lg font-semibold text-foreground mb-1">
          {product.name}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          {product.description}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-2xl font-semibold text-foreground">
            ${product.price.toFixed(2)}
          </span>
          <Button onClick={handleAddToCart} size="default">
            <ShoppingCart className="mr-2 h-4 w-4" />
            Add to Cart
          </Button>
        </div>
      </div>
    </div>
  );
};
