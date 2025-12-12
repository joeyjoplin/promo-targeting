// src/components/ecommerce/SolanaPayModal.tsx
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ExternalLink, Loader2, QrCode } from "lucide-react";
import { createQR } from "@solana/pay";

/**
 * IMPORTANT:
 * - The server is responsible for creating a Solana Pay URL + reference.
 * - The frontend only renders the QR and polls /status/:reference.
 * - We NEVER move to "confirming"/"confirmed" by timeouts alone.
 */

// Lightweight type for the selected coupon (as passed from Ecommerce)
type SelectedCoupon = {
  address: string;
  discount_bps?: number;
  max_discount_lamports?: number;
  product_code?: number;
};

interface SolanaPayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalAmount: number; // in SOL, already discounted by coupons
  walletAddress?: string;
  networkLabel?: string;
  // Optional: extra info to send to the backend when starting the session
  orderItems?: Array<{
    id: string;
    name?: string;
    quantity: number;
    price: number;
  }>;
  // Currently selected coupon (if any)
  selectedCoupon?: SelectedCoupon;
  // Integration mode with the backend:
  // - "transfer-request": classic Solana Pay flow (recipient+amount+reference)
  // - "transaction-request": wallets fetch an unsigned tx from the backend
  integrationMode?: "transfer-request" | "transaction-request";
  // Called when payment is confirmed by the backend (after QR is scanned)
  onPaymentConfirmed?: () => void;
}

type PaymentStatus = "scanning" | "confirming" | "confirmed";

const API_BASE_URL =
  import.meta.env.VITE_AI_SERVER_URL || "http://localhost:8787";

export const SolanaPayModal = ({
  open,
  onOpenChange,
  totalAmount,
  walletAddress,
  networkLabel = "Solana Devnet",
  orderItems = [],
  selectedCoupon,
  integrationMode = "transaction-request", // default to transaction-request for the new flow
  onPaymentConfirmed,
}: SolanaPayModalProps) => {
  const [status, setStatus] = useState<PaymentStatus>("scanning");
  const [paymentURL, setPaymentURL] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [isError, setIsError] = useState<string | null>(null);

  const qrRef = useRef<HTMLDivElement | null>(null);

  // ---------------------------------------------------------------------------
  // Effect 1: when modal opens, create a Solana Pay session on the server
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const resetState = () => {
      setStatus("scanning");
      setPaymentURL(null);
      setReference(null);
      setIsError(null);
      if (qrRef.current) {
        qrRef.current.innerHTML = "";
      }
    };

    if (!open) {
      // Modal is closed: reset everything
      resetState();
      return;
    }

    // We intentionally create a session ONCE per open().
    // Even if cart / wallet / coupon props change while the modal is open,
    // we do NOT want to recreate the QR (this is what was causing flicker).
    const createSession = async () => {
      // If totalAmount is 0 or negative, we do not create a session
      if (!totalAmount || totalAmount <= 0) {
        console.warn(
          "[SolanaPayModal] totalAmount is <= 0, skipping session creation."
        );
        setIsError("Invalid payment amount.");
        return;
      }

      try {
        const couponAddress = selectedCoupon ? selectedCoupon.address : null;

        console.log("[SolanaPayModal] Creating Solana Pay session:", {
          amountSol: totalAmount,
          payerWallet: walletAddress || null,
          orderItems,
          couponAddress,
          mode: integrationMode,
        });

        const res = await fetch(
          `${API_BASE_URL}/api/solana-pay/create-session`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              amountSol: totalAmount,
              payerWallet: walletAddress || null,
              hasOrderItems: !!orderItems.length,
              orderItems,
              // IMPORTANT: pass selected coupon address through to backend
              couponAddress,
              mode: integrationMode, // tell the backend which flow to use
            }),
          }
        );

        if (!res.ok) {
          const errText = await res.text();
          console.error(
            "[SolanaPayModal] Failed to create Solana Pay session:",
            errText
          );
          if (!cancelled) {
            setIsError("Failed to create Solana Pay session.");
          }
          return;
        }

        const data = await res.json();
        const urlStr: string = data.url;
        const ref: string = data.reference;

        console.log("[SolanaPayModal] Session created:", {
          reference: ref,
          url: urlStr,
          recipient: data.recipient,
          amountSol: data.amountSol,
          mode: data.mode,
        });

        if (cancelled) return;

        setPaymentURL(urlStr);
        setReference(ref);
        setStatus("scanning");

        // Render QR code exactly once for this session
        if (qrRef.current) {
          try {
            qrRef.current.innerHTML = "";
            const url = new URL(urlStr);
            const qr = createQR(url, 256, "transparent");
            qr.append(qrRef.current);
          } catch (qrErr) {
            console.error(
              "[SolanaPayModal] Failed to render QR code:",
              qrErr
            );
            setIsError("Failed to render QR code.");
          }
        }
      } catch (err: any) {
        console.error("[SolanaPayModal] Error creating session:", err);
        if (!cancelled) {
          setIsError("Unexpected error while creating payment session.");
        }
      }
    };

    createSession();

    return () => {
      cancelled = true;
    };
    // ⬇️ VERY IMPORTANT: only depend on "open"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---------------------------------------------------------------------------
  // Effect 2: poll the server for payment status when a reference exists
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!open || !reference) {
      return;
    }

    let intervalId: number | undefined;
    let confirmTimeoutId: number | undefined;
    let stopped = false;

    const pollStatus = async () => {
      if (stopped) return;

      try {
        const res = await fetch(
          `${API_BASE_URL}/api/solana-pay/status/${reference}`
        );

        if (!res.ok) {
          const errText = await res.text();
          console.error(
            "[SolanaPayModal] Status polling failed:",
            res.status,
            errText
          );
          // We do not change UI status to "error" here to avoid breaking UX;
          // the next poll may succeed.
          return;
        }

        const data = await res.json();

        if (data.status === "pending") {
          // Do nothing – keep "scanning" and keep QR visible.
          console.log(
            "[SolanaPayModal] Payment still pending for reference:",
            reference
          );
          return;
        }

        if (data.status === "confirmed") {
          console.log(
            "[SolanaPayModal] Payment confirmed by backend:",
            data
          );
          // Small UX touch: briefly show "confirming" spinner, then "confirmed"
          setStatus("confirming");

          if (confirmTimeoutId !== undefined) {
            window.clearTimeout(confirmTimeoutId);
          }

          confirmTimeoutId = window.setTimeout(() => {
            if (!stopped) {
              setStatus("confirmed");
              // Notify parent so it can clear cart, coupon, etc.
              if (onPaymentConfirmed) {
                onPaymentConfirmed();
              }
            }
          }, 1500);

          // Once confirmed, we can stop polling
          if (intervalId !== undefined) {
            window.clearInterval(intervalId);
          }
          return;
        }

        if (data.status === "error") {
          console.error("[SolanaPayModal] Backend reported error:", data);
          // Optional: surface a visible error message
          setIsError(data.error || "Payment verification error.");
        }
      } catch (err: any) {
        console.error("[SolanaPayModal] Error polling payment status:", err);
        // Do not break the loop – next poll may succeed
      }
    };

    // Start polling every 3 seconds
    intervalId = window.setInterval(pollStatus, 3000) as unknown as number;

    // Kick off first poll immediately
    pollStatus();

    return () => {
      stopped = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
      if (confirmTimeoutId !== undefined) {
        window.clearTimeout(confirmTimeoutId);
      }
    };
  }, [open, reference, onPaymentConfirmed]);

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  const getStatusInfo = () => {
    if (isError) {
      return {
        icon: <QrCode className="h-12 w-12 text-destructive" />,
        title: "Error",
        description: isError,
        badge: "Error",
        badgeVariant: "outline" as const,
      };
    }

    switch (status) {
      case "scanning":
        return {
          icon: <QrCode className="h-12 w-12 text-primary" />,
          title: "Scan to Pay",
          description:
            "Open your Solana wallet (mobile or browser) and scan the QR code to approve the payment.",
          badge: "Awaiting scan",
          badgeVariant: "default" as const,
        };
      case "confirming":
        return {
          icon: <Loader2 className="h-12 w-12 text-warning animate-spin" />,
          title: "Confirming Transaction",
          description:
            "We detected your payment. Waiting for it to be confirmed on-chain.",
          badge: "Confirming...",
          badgeVariant: "outline" as const,
        };
      case "confirmed":
        return {
          icon: <CheckCircle2 className="h-12 w-12 text-success" />,
          title: "Payment Confirmed!",
          description: "Your order has been successfully placed.",
          badge: "Transaction complete",
          badgeVariant: "default" as const,
        };
    }
  };

  const statusInfo = getStatusInfo();

  const formatSol = (value: number) => `${value.toFixed(3)} SOL`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">
            Solana Pay Checkout
          </DialogTitle>
          <DialogDescription className="text-center">
            Amount: {formatSol(totalAmount)} · {networkLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center py-8 space-y-6">
          {/* Icon */}
          <div>{statusInfo.icon}</div>

          {/* QR Code area */}
          {/* We keep the QR visible while payment is not fully confirmed and no fatal error occurred */}
          {!isError && status !== "confirmed" && (
            <div className="w-64 h-64 bg-muted rounded-lg flex items-center justify-center border-2 border-border">
              <div
                ref={qrRef}
                className="w-full h-full flex items-center justify-center"
              />
            </div>
          )}

          {/* Status text */}
          <div className="text-center space-y-3">
            <h3 className="text-lg font-semibold text-foreground">
              {statusInfo.title}
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              {statusInfo.description}
            </p>
            <Badge variant={statusInfo.badgeVariant} className="mt-2">
              {statusInfo.badge}
            </Badge>
          </div>

          {/* Deep link (optional) */}
          {paymentURL && !isError && status === "scanning" && (
            <a
              href={paymentURL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs text-primary underline"
            >
              Open in compatible wallet
              <ExternalLink className="h-3 w-3" />
            </a>
          )}

          {/* Transaction details (demo / simulated-ish summary) */}
          {status === "confirmed" && (
            <div className="w-full bg-accent rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Payment URL:</span>
                <span className="text-foreground font-mono text-[10px] truncate max-w-[160px]">
                  {paymentURL ? paymentURL.slice(0, 22) + "..." : "N/A"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Network:</span>
                <span className="text-foreground">{networkLabel}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status:</span>
                <span className="text-foreground">On-chain confirmed</span>
              </div>
              {reference && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Reference:</span>
                  <span className="text-foreground font-mono text-[10px] truncate max-w-[160px]">
                    {reference}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

