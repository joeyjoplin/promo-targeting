// src/pages/Ecommerce.tsx
import { useEffect, useState } from "react";
import { Navigation } from "@/components/Navigation";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { ProductCard } from "@/components/ecommerce/ProductCard";
import { CartSummary } from "@/components/ecommerce/CartSummary";
import { SolanaPayModal } from "@/components/ecommerce/SolanaPayModal";
import { Button } from "@/components/ui/button";
import { useSolanaWallet } from "@/solana/useSolanaWallet";
import { products } from "@/data/products";
import { CouponWalletCard } from "@/components/ecommerce/CouponWalletCard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export interface Product {
  id: string;
  name: string;
  price: number; // price in SOL (for MVP)
  image: string;
  description: string;
}

export interface CartItem extends Product {
  quantity: number;
}

// Mirrors what the /api/coupons endpoint returns for each coupon
export interface CouponSummary {
  address: string;
  campaign: string | null;
  recipient: string;

  discount_bps: number; // discount in basis points (e.g. 500 = 5%)
  max_discount_lamports: number; // cap per coupon in lamports
  expiration_timestamp: number;
  category_code: number;
  product_code: number;

  is_used: boolean;
  is_listed?: boolean;
}

/**
 * Map product.id from the UI to numeric product_code used on-chain.
 * For the MVP:
 *  1 => coffee
 *  2 => chocolate
 *  3 => t-shirt
 */
const PRODUCT_ID_TO_CODE: Record<string, number> = {
  "1": 1,
  "2": 2,
  "3": 3,
};

/**
 * Compute subtotal only for products that are eligible for the given coupon.
 */
function getEligibleSubtotal(
  coupon: CouponSummary | null,
  cart: CartItem[]
): number {
  if (!coupon || cart.length === 0) return 0;

  const subtotal = cart.reduce((sum, item) => {
    const code = PRODUCT_ID_TO_CODE[item.id];
    if (code !== undefined && code === coupon.product_code) {
      return sum + item.price * item.quantity;
    }
    return sum;
  }, 0);

  return subtotal;
}

/**
 * Check if a given coupon applies to at least one product in the cart.
 * Uses the same logic as the discount calculation (eligibleSubtotal > 0).
 */
function isCouponApplicable(
  coupon: CouponSummary | null,
  cart: CartItem[]
): boolean {
  const eligibleSubtotal = getEligibleSubtotal(coupon, cart);
  return eligibleSubtotal > 0;
}

/**
 * Key used in localStorage to persist the shopper context.
 * This will be consumed later by the dashboard / AI Copilot.
 */
const SHOPPER_CONTEXT_KEY = "promo-targeting:shopper-context";

/**
 * Base URL for the AI server API.
 * Shared with the e-commerce frontend to talk to the Node server.
 */
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL || "http://localhost:8787").replace(
    /\/$/,
    ""
  );

interface ShopperContextSnapshot {
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

/**
 * Build a shopper context snapshot from current cart + wallet.
 */
function buildShopperContext(
  cart: CartItem[],
  walletAddress: string | null
): ShopperContextSnapshot {
  const hasCart = cart.length > 0;
  const primaryItem = hasCart ? cart[cart.length - 1] : null;

  return {
    productId: primaryItem ? primaryItem.id : null,
    productPriceSol: primaryItem ? primaryItem.price : null,
    walletAddress: walletAddress ?? null,
    cartSnapshot: cart.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      price: item.price,
    })),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Safely persist a shopper context snapshot to localStorage.
 * - If both cart and wallet are empty, we clear the context.
 * - Otherwise, we store the last (most recently modified) cart item
 *   as the "primary product" for the marketing engine.
 */
function persistShopperContext(
  cart: CartItem[],
  walletAddress: string | null
) {
  if (typeof window === "undefined") return;

  const hasCart = cart.length > 0;
  const hasWallet = !!walletAddress;

  // If there is no meaningful context, clear the storage
  if (!hasCart && !hasWallet) {
    console.log(
      "[Ecommerce] Clearing shopper context (empty cart + no wallet)."
    );
    window.localStorage.removeItem(SHOPPER_CONTEXT_KEY);
    return;
  }

  const snapshot = buildShopperContext(cart, walletAddress);

  console.log(
    "[Ecommerce] Persisting shopper context to localStorage:",
    snapshot
  );

  window.localStorage.setItem(SHOPPER_CONTEXT_KEY, JSON.stringify(snapshot));
}

const Ecommerce = () => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showSolanaModal, setShowSolanaModal] = useState(false);

  // Currently selected on-chain coupon for this order
  const [selectedCoupon, setSelectedCoupon] = useState<CouponSummary | null>(
    null
  );
  const [couponError, setCouponError] = useState<string | null>(null);

  // Abandoned cart offer (UI + logic)
  const [showAbandonedCartOffer, setShowAbandonedCartOffer] = useState(false);
  const [hasShownAbandonedOffer, setHasShownAbandonedOffer] = useState(false);
  const [isAbandonedOfferLoading, setIsAbandonedOfferLoading] =
    useState(false);
  const [abandonedOfferError, setAbandonedOfferError] = useState<string | null>(
    null
  );

  // Customer wallet (persona: shopper)
  // `walletAddress` is a base58 string, `connected` is a boolean
  const {
    walletAddress,
    connected,
    connecting,
    connectWallet,
    disconnectWallet,
  } = useSolanaWallet();

  // Debug: log wallet connect / disconnect status
  useEffect(() => {
    if (walletAddress && connected) {
      console.log("[Ecommerce] Wallet connected:", walletAddress);
    } else if (!walletAddress && !connected) {
      console.log("[Ecommerce] Wallet disconnected.");
    }
  }, [walletAddress, connected]);

  // When wallet disconnects, clear coupon and abandoned-offer UI state
  useEffect(() => {
    if (!walletAddress) {
      setSelectedCoupon(null);
      setCouponError(null);
      setShowAbandonedCartOffer(false);
      setHasShownAbandonedOffer(false);
      setAbandonedOfferError(null);
    }
  }, [walletAddress]);

  /**
   * Add a product to the cart and update the shopper context.
   */
  const addToCart = (product: Product) => {
    setCart((prevCart) => {
      const existingItem = prevCart.find((item) => item.id === product.id);
      let nextCart: CartItem[];

      if (existingItem) {
        nextCart = prevCart.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        nextCart = [...prevCart, { ...product, quantity: 1 }];
      }

      console.log("[Ecommerce] Add to cart:", {
        productId: product.id,
        name: product.name,
        newCart: nextCart.map((i) => ({
          id: i.id,
          qty: i.quantity,
        })),
      });

      // Persist updated cart + current wallet to the shopper context
      persistShopperContext(nextCart, walletAddress ?? null);

      // Whenever the cart changes, we consider user "active" again
      setHasShownAbandonedOffer(false);
      setShowAbandonedCartOffer(false);
      setAbandonedOfferError(null);

      return nextCart;
    });
  };

  /**
   * Remove a product entirely from the cart and update the shopper context.
   */
  const removeFromCart = (productId: string) => {
    setCart((prevCart) => {
      const nextCart = prevCart.filter((item) => item.id !== productId);
      console.log("[Ecommerce] Remove from cart:", {
        productId,
        newCart: nextCart.map((i) => ({
          id: i.id,
          qty: i.quantity,
        })),
      });
      persistShopperContext(nextCart, walletAddress ?? null);

      // Reset abandoned cart state when cart changes
      if (nextCart.length === 0) {
        setHasShownAbandonedOffer(false);
        setShowAbandonedCartOffer(false);
        setAbandonedOfferError(null);
      }

      return nextCart;
    });
  };

  /**
   * Update quantity for a given product and update the shopper context.
   * If quantity drops to zero, the product is removed from the cart.
   */
  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity === 0) {
      removeFromCart(productId);
      return;
    }

    setCart((prevCart) => {
      const nextCart = prevCart.map((item) =>
        item.id === productId ? { ...item, quantity } : item
      );
      console.log("[Ecommerce] Update quantity:", {
        productId,
        quantity,
        newCart: nextCart.map((i) => ({
          id: i.id,
          qty: i.quantity,
        })),
      });
      persistShopperContext(nextCart, walletAddress ?? null);

      // User interacted again, so we consider them "active"
      setHasShownAbandonedOffer(false);
      setShowAbandonedCartOffer(false);
      setAbandonedOfferError(null);

      return nextCart;
    });
  };

  /**
   * Base subtotal in SOL (sum of price * quantity for all items).
   */
  const subtotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  /**
   * Compute coupon discount, constrained by:
   *  - coupon.discount_bps (percentage in basis points)
   *  - coupon.max_discount_lamports (absolute cap from vault, per coupon)
   *  - products in the cart that match the coupon.product_code
   */
  

  let discountAmount = 0;

  if (selectedCoupon && subtotal > 0) {
    // Sum only items that match the coupon's product_code
    const eligibleSubtotal = cart.reduce((sum, item) => {
      const code = PRODUCT_ID_TO_CODE[item.id] ?? 0;
      if (code === selectedCoupon.product_code) {
        return sum + item.price * item.quantity;
      }
      return sum;
    }, 0);

    if (eligibleSubtotal > 0) {
      // Discount is always applied over the eligible product(s) price
      // discount_bps is a percentage in basis points (5000 = 50%)
      const discountPercent = selectedCoupon.discount_bps / 10_000;

      discountAmount = eligibleSubtotal * discountPercent;

      console.log("[Ecommerce] Calculated coupon discount (no cap):", {
        subtotal,
        eligibleSubtotal,
        discount_bps: selectedCoupon.discount_bps,
        discountPercent,
        discountAmount,
        coupon: {
          address: selectedCoupon.address,
          campaign: selectedCoupon.campaign,
          product_code: selectedCoupon.product_code,
          category_code: selectedCoupon.category_code,
        },
        // For future use: max_discount_lamports is meant for secondary market pricing,
        // not to cap the discount applied at checkout.
        onChainMaxDiscountLamports:
          selectedCoupon.max_discount_lamports ?? null,
      });
    } else {
      console.log(
        "[Ecommerce] Selected coupon does not match any product in the cart.",
        {
          coupon_product_code: selectedCoupon.product_code,
          cartItems: cart.map((item) => ({
            id: item.id,
            mappedCode: PRODUCT_ID_TO_CODE[item.id] ?? 0,
          })),
        }
      );
    }
  }
  const total = Math.max(0, subtotal - discountAmount);

  /**
   * Auto-clear coupon if cart changes and it no longer applies.
   */
  useEffect(() => {
    if (selectedCoupon && !isCouponApplicable(selectedCoupon, cart)) {
      console.log(
        "[Ecommerce] Selected coupon no longer matches current cart. Clearing it."
      );
      setSelectedCoupon(null);
      setCouponError(
        "Your coupon no longer applies to the current cart items. It has been removed."
      );
    }
  }, [cart, selectedCoupon]);

  // Shortened address for UI
  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
    : null;

  /**
   * Keep shopper context in sync whenever:
   * - the wallet connects/disconnects
   * - the cart contents change
   *
   * This ensures the dashboard / AI Copilot always sees a fresh view
   * of what the shopper is doing in the e-commerce frontend.
   */
  useEffect(() => {
    persistShopperContext(cart, walletAddress ?? null);
  }, [cart, walletAddress]);

  /**
   * Abandoned cart detector (Step 1 + 2)
   * - If cart has items
   * - Wallet is connected
   * - No coupon already selected
   * - No offer shown yet for the current "session"
   * -> After 60 seconds of inactivity, show a pop-up offer.
   */
  useEffect(() => {
    if (!walletAddress || cart.length === 0) {
      setShowAbandonedCartOffer(false);
      setHasShownAbandonedOffer(false);
      setAbandonedOfferError(null);
      return;
    }

    if (selectedCoupon) {
      // If a coupon is already applied, we don't show the abandoned cart offer.
      setShowAbandonedCartOffer(false);
      return;
    }

    if (hasShownAbandonedOffer) {
      // We already showed the offer for this cart state.
      return;
    }

    let timeoutId: number | undefined;

    timeoutId = window.setTimeout(() => {
      console.log("[Ecommerce] Triggering abandoned cart discount offer popup.");
      setShowAbandonedCartOffer(true);
      setHasShownAbandonedOffer(true);
    }, 60_000); // 60 seconds

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [cart, walletAddress, selectedCoupon, hasShownAbandonedOffer]);


    /**
   * Called when user clicks "Pay with Solana Pay" in the cart.
   * This only opens the modal; actual confirmation happens
   * inside the SolanaPayModal when backend reports "confirmed".
   */
  const handleCheckout = () => {
    // Hard block: if there is a coupon error, do not allow checkout
    if (couponError) {
      console.warn(
        "[Ecommerce] Checkout blocked because of couponError:",
        couponError
      );
      // Optional UX: show an alert so the user understands what to fix
      window.alert(
        "There is a problem with your coupon. Please fix it or clear the coupon before checking out."
      );
      return;
    }

    // Additional safety: if a coupon is selected but does not apply anymore
    if (selectedCoupon && !isCouponApplicable(selectedCoupon, cart)) {
      console.warn(
        "[Ecommerce] Checkout blocked: selected coupon does not match current cart."
      );
      setCouponError(
        "Your coupon does not apply to this cart. Please update your items or clear the coupon."
      );
      return;
    }

    console.log("[Ecommerce] Opening Solana Pay modal with state:", {
      subtotal,
      discountAmount,
      total,
      selectedCoupon: selectedCoupon
        ? {
            address: selectedCoupon.address,
            campaign: selectedCoupon.campaign,
            product_code: selectedCoupon.product_code,
            category_code: selectedCoupon.category_code,
            discount_bps: selectedCoupon.discount_bps,
            max_discount_lamports: selectedCoupon.max_discount_lamports,
          }
        : null,
      cartSnapshot: cart.map((item) => ({
        id: item.id,
        name: item.name,
        qty: item.quantity,
        price: item.price,
      })),
    });

    setShowSolanaModal(true);
  };


  /**
   * Called by the SolanaPayModal when status becomes "confirmed".
   * Here we:
   *  - optimistically mark the coupon as used in the backend (local memory)
   *  - emit a global event so CouponWalletCard refreshes from the server
   *  - clear cart and selected coupon
   */
  const handlePaymentConfirmed = async () => {
    console.log(
      "[Ecommerce] Payment confirmed via Solana Pay. Clearing cart and burning coupon (server-local)."
    );

    const couponToMark = selectedCoupon;

    if (couponToMark) {
      try {
        console.log("[Ecommerce] Marking coupon as used on server:", {
          couponAddress: couponToMark.address,
        });

        await fetch(`${API_BASE}/api/mark-coupon-used`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            couponAddress: couponToMark.address,
          }),
        });

        // Notify all listeners (CouponWalletCard) that coupon state has changed
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("promo-targeting:coupon-updated")
          );
        }
      } catch (err) {
        console.error(
          "[Ecommerce] Failed to mark coupon as used on server:",
          err
        );
      }
    }

    setCart([]);
    setSelectedCoupon(null);
    setCouponError(null);
    setShowSolanaModal(false);
    setHasShownAbandonedOffer(false);
    setShowAbandonedCartOffer(false);
    setAbandonedOfferError(null);

    // Persist the post-purchase state (empty cart, same wallet)
    persistShopperContext([], walletAddress ?? null);
  };

  /**
   * Handle coupon selection from CouponWalletCard with validation.
   * This is where we block applying a coupon that doesn't match any item.
   */
  const handleSelectCoupon = (coupon: CouponSummary | null) => {
    if (!coupon) {
      console.log("[Ecommerce] Coupon cleared by user.");
      setSelectedCoupon(null);
      setCouponError(null);
      return;
    }

    const applicable = isCouponApplicable(coupon, cart);

    if (!applicable) {
      console.warn(
        "[Ecommerce] User tried to select a coupon that does not match any cart item.",
        {
          coupon_product_code: coupon.product_code,
          cartItems: cart.map((item) => ({
            id: item.id,
            mappedCode: PRODUCT_ID_TO_CODE[item.id],
          })),
        }
      );
      setSelectedCoupon(null);
      setCouponError(
        "This coupon does not apply to any item in your cart. Add the eligible product or pick another coupon."
      );
      return;
    }

    console.log("[Ecommerce] Coupon selected and applied to cart:", {
      couponAddress: coupon.address,
      product_code: coupon.product_code,
    });
    setCouponError(null);
    setSelectedCoupon(coupon);
  };

  const handleClearCoupon = () => {
    console.log("[Ecommerce] Clearing selectedCoupon from parent.");
    setSelectedCoupon(null);
    setCouponError(null);
  };

  /**
   * Abandoned cart pop-up actions.
   * Here we implement the full logic:
   *  - Create a 10% campaign (valid until end of day) targeting the current product
   *  - Mint one coupon to the logged-in wallet
   *  - Fetch coupons for this wallet and auto-apply the new one
   */
  const handleAbandonedOfferAccept = async () => {
    console.log(
      "[Ecommerce] User accepted abandoned cart discount offer. Creating campaign + minting coupon..."
    );

    setAbandonedOfferError(null);

    if (!walletAddress) {
      console.warn(
        "[Ecommerce] Abandoned offer accept clicked but no wallet connected."
      );
      setAbandonedOfferError("Please connect your wallet to receive the coupon.");
      return;
    }

    if (cart.length === 0) {
      console.warn(
        "[Ecommerce] Abandoned offer accept clicked but cart is empty."
      );
      setAbandonedOfferError("Your cart is empty. Add an item and try again.");
      return;
    }

    setIsAbandonedOfferLoading(true);

    try {
      // Primary product for this abandoned cart (last item in the cart)
      const primaryItem = cart[cart.length - 1];
      const productCode =
        PRODUCT_ID_TO_CODE[primaryItem.id] ?? PRODUCT_ID_TO_CODE["1"];

      // Shopper context snapshot to send to backend
      const shopperContext = buildShopperContext(cart, walletAddress);

      // Expiration: valid only for the current day (until 23:59:59 local time)
      const now = new Date();
      const endOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        59,
        59,
        0
      );
      const expirationTimestamp = Math.floor(endOfDay.getTime() / 1000);

      // 10% discount = 1000 bps
      const discountBps = 1000;

      // Basic lamport parameters (demo values; protocol will enforce caps anyway)
      const M = 1_000_000; // convenience
      const mintCostLamports = 1 * M; // 0.001 SOL
      const maxDiscountLamports = 10 * M; // 0.01 SOL cap per coupon
      const depositAmountLamports = 100 * M; // 0.1 SOL deposit in the vault

      const proposal = {
        name: "Abandoned Cart Solana Pay Offer",
        audience: "Single shopper abandoned cart",
        period_label: "Today only",
        discount_bps: discountBps,
        service_fee_bps: 500,
        resale_bps: 5000,
        // Use computed expiration timestamp (end of day)
        expiration_timestamp: expirationTimestamp,
        total_coupons: 1,
        mint_cost_lamports: mintCostLamports,
        max_discount_lamports: maxDiscountLamports,
        deposit_amount_lamports: depositAmountLamports,
        category_code: 1,
        product_code: productCode,
        requires_wallet: true,
        target_wallet: walletAddress,
        minted_coupons: 0,
        used_coupons: 0,
      };

      console.log("[Ecommerce] Creating on-chain campaign for abandoned cart:", {
        walletAddress,
        proposal,
        shopperContext,
      });

      const createRes = await fetch(`${API_BASE}/api/create-campaign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          walletAddress,
          proposal,
          shopper_context: shopperContext,
        }),
      });

      if (!createRes.ok) {
        const text = await createRes.text();
        console.error(
          "[Ecommerce] Failed to create abandoned-cart campaign:",
          text
        );
        throw new Error(`Failed to create campaign: ${text.slice(0, 200)}`);
      }

      const createData = await createRes.json();

      const campaignAddress: string =
        createData.campaignPda ||
        createData.campaignAddress ||
        createData.campaign ||
        "";

      if (!campaignAddress) {
        console.error(
          "[Ecommerce] create-campaign response missing campaign address:",
          createData
        );
        throw new Error(
          "Campaign created but campaign address was not returned by the server."
        );
      }

      console.log(
        "[Ecommerce] Abandoned-cart campaign created on-chain:",
        campaignAddress
      );

      // Mint the coupon for this wallet
      console.log(
        "[Ecommerce] Minting coupon for abandoned-cart campaign to wallet:",
        walletAddress
      );

      const mintRes = await fetch(`${API_BASE}/api/mint-coupon`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaignAddress,
          customerWallet: walletAddress,
        }),
      });

      if (!mintRes.ok) {
        const text = await mintRes.text();
        console.error(
          "[Ecommerce] Failed to mint abandoned-cart coupon:",
          text
        );
        throw new Error(`Failed to mint coupon: ${text.slice(0, 200)}`);
      }

      const mintData = await mintRes.json();
      const mintedCouponAddress: string = mintData.couponAddress;

      console.log("[Ecommerce] Abandoned-cart coupon minted:", {
        couponAddress: mintedCouponAddress,
        mintData,
      });

      // Notify other components that coupons changed
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("promo-targeting:coupon-updated")
        );
      }

      // Fetch coupons for this wallet and auto-apply the newly minted one
      console.log(
        "[Ecommerce] Fetching coupons to auto-apply abandoned-cart coupon."
      );

      const couponsRes = await fetch(
        `${API_BASE}/api/coupons/${encodeURIComponent(walletAddress)}`
      );

      if (!couponsRes.ok) {
        const text = await couponsRes.text();
        console.error(
          "[Ecommerce] Failed to fetch coupons for auto-apply:",
          text
        );
        throw new Error(`Failed to fetch coupons: ${text.slice(0, 200)}`);
      }

      const couponsData = await couponsRes.json();
      const coupons: CouponSummary[] = Array.isArray(couponsData?.coupons)
        ? couponsData.coupons
        : [];

      const availableCoupons = coupons.filter(
        (c) => !c.is_used && !c.is_listed
      );

      const newlyMinted =
        availableCoupons.find((c) => c.address === mintedCouponAddress) ||
        null;

      if (!newlyMinted) {
        console.warn(
          "[Ecommerce] Newly minted coupon not found in /api/coupons response. Falling back to first available 10% coupon for this product."
        );

        const fallbackCoupon =
          availableCoupons.find(
            (c) =>
              c.discount_bps === discountBps &&
              c.product_code === productCode
          ) || null;

        if (!fallbackCoupon) {
          throw new Error(
            "Coupon minted but could not be located via /api/coupons."
          );
        }

        setSelectedCoupon(fallbackCoupon);
      } else {
        setSelectedCoupon(newlyMinted);
      }

      console.log(
        "[Ecommerce] Abandoned-cart coupon auto-applied to cart successfully."
      );

      // Close pop-up
      setShowAbandonedCartOffer(false);
      setAbandonedOfferError(null);
    } catch (err: any) {
      console.error(
        "[Ecommerce] Error while creating/minting/applying abandoned-cart coupon:",
        err
      );
      setAbandonedOfferError(
        err?.message ||
          "Failed to generate your discount. Please try again or proceed without the coupon."
      );
    } finally {
      setIsAbandonedOfferLoading(false);
    }
  };

  const handleAbandonedOfferDismiss = () => {
    console.log(
      "[Ecommerce] User dismissed abandoned cart discount offer pop-up."
    );
    setShowAbandonedCartOffer(false);
    setAbandonedOfferError(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground mb-1">
              Shop Products
            </h1>
            <p className="text-muted-foreground">
              Browse our curated selection of premium items
            </p>
          </div>

          {/* Customer wallet connect area (customer persona) */}
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
            {shortAddress && (
              <div className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground font-mono flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>Wallet: {shortAddress}</span>
              </div>
            )}

            <WalletConnectButton />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Product List */}
          <div className="lg:col-span-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAddToCart={addToCart}
                />
              ))}
            </div>
          </div>

          {/* Right column: coupons + cart summary */}
          <div className="lg:col-span-1 space-y-4">
            <CouponWalletCard
              walletAddress={walletAddress ?? undefined}
              selectedCoupon={selectedCoupon}
              onSelectCoupon={handleSelectCoupon}
            />

            {couponError && (
              <p className="text-xs text-red-500 mt-1">{couponError}</p>
            )}

            <CartSummary
              cart={cart}
              onUpdateQuantity={updateQuantity}
              onRemove={removeFromCart}
              onCheckout={handleCheckout}
              subtotal={subtotal}
              discountAmount={discountAmount}
              total={total}
              selectedCoupon={selectedCoupon}
              onClearCoupon={handleClearCoupon}
            />
          </div>
        </div>
      </main>

      <SolanaPayModal
        open={showSolanaModal}
        onOpenChange={setShowSolanaModal}
        totalAmount={total}
        walletAddress={walletAddress ?? undefined}
        networkLabel="Solana Devnet"
        onPaymentConfirmed={handlePaymentConfirmed}
        orderItems={cart.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          price: item.price,
        }))}
        selectedCoupon={selectedCoupon ?? undefined}
      />

      {/* Abandoned cart discount pop-up */}
      <Dialog
        open={showAbandonedCartOffer}
        onOpenChange={(open) => {
          if (!open) {
            handleAbandonedOfferDismiss();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">
              Special Solana Pay discount
            </DialogTitle>
            <DialogDescription className="text-center text-sm">
              We have a special discount for you if you complete your shopping
              using Solana Pay.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-sm text-muted-foreground text-center max-w-xs">
              Click <span className="font-semibold">Yes</span> to get{" "}
              <span className="font-semibold">10% off</span> your order when you
              pay with Solana Pay.
            </p>

            {abandonedOfferError && (
              <p className="text-xs text-red-500 text-center max-w-xs">
                {abandonedOfferError}
              </p>
            )}

            <div className="flex items-center justify-center gap-3 w-full mt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleAbandonedOfferDismiss}
                disabled={isAbandonedOfferLoading}
              >
                No, thanks
              </Button>
              <Button
                className="flex-1"
                onClick={handleAbandonedOfferAccept}
                disabled={isAbandonedOfferLoading}
              >
                {isAbandonedOfferLoading
                  ? "Generating coupon..."
                  : "Yes, I want 10% off"}
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground text-center mt-1">
              This is a time-limited offer and will be applied only to this cart
              when you finalize with Solana Pay.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Ecommerce;
