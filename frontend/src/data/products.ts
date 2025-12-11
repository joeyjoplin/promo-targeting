// src/data/products.ts
// Shared product catalog used by both Ecommerce page and Marketplace.
// Product IDs should stay in sync with on-chain product_code values.

export interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
  description: string;
}

export const products: Product[] = [
  {
    id: "1",
    name: "Premium Coffee",
    price: 0.24,
    image:
      "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=400&h=400&fit=crop",
    description: "Single-origin arabica beans, medium roast",
  },
  {
    id: "2",
    name: "Artisan Chocolate Bar",
    price: 0.12,
    image:
      "https://images.unsplash.com/photo-1511381939415-e44015466834?w=400&h=400&fit=crop",
    description: "70% dark chocolate with sea salt",
  },
  {
    id: "3",
    name: "Minimalist T-Shirt",
    price: 0.34,
    image:
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=400&fit=crop",
    description: "100% organic cotton, classic fit",
  },
];

// Helper function to find a product by on-chain product_code
export function findProductByCode(productCode: number): Product | undefined {
  const id = String(productCode);
  return products.find((p) => p.id === id);
}
