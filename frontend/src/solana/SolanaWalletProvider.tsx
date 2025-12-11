// src/solana/SolanaWalletProvider.tsx
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { Connection, PublicKey } from "@solana/web3.js";

// Minimal typing for window.solana (Phantom or compatible wallets)
interface SolanaProvider {
  isPhantom?: boolean;
  publicKey?: {
    toString(): string;
  };
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  disconnect: () => Promise<void>;
  on: (event: string, handler: (...args: any[]) => void) => void;
  off: (event: string, handler: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    solana?: SolanaProvider;
  }
}

// Shape of the wallet context used across the app
export interface SolanaWalletContextValue {
  connection: Connection;
  publicKey: PublicKey | null;
  walletAddress: string | null;
  connecting: boolean;
  connected: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
}

// ✅ Export the context so useSolanaWallet.ts can import it
export const SolanaWalletContext =
  createContext<SolanaWalletContextValue | undefined>(undefined);

interface SolanaWalletProviderProps {
  children: ReactNode;
}

export const SolanaWalletProvider: React.FC<SolanaWalletProviderProps> = ({
  children,
}) => {
  // Use RPC URL from env if available, otherwise fall back to devnet
  const rpcUrl =
    import.meta.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";

  const [connection] = useState(() => new Connection(rpcUrl, "confirmed"));
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Derive some convenience flags
  const walletAddress = useMemo(
    () => (publicKey ? publicKey.toBase58() : null),
    [publicKey]
  );
  const connected = !!publicKey;

  // Connect to Phantom (or compatible) wallet
  const connectWallet = useCallback(async () => {
    if (connecting) return;

    try {
      setConnecting(true);

      if (!window.solana || !window.solana.isPhantom) {
        alert("No Solana wallet found. Please install Phantom or a compatible wallet.");
        return;
      }

      const response = await window.solana.connect();
      const pk = new PublicKey(response.publicKey.toString());
      setPublicKey(pk);
    } catch (err) {
      console.error("Failed to connect wallet:", err);
    } finally {
      setConnecting(false);
    }
  }, [connecting]);

  // Disconnect from wallet
  const disconnectWallet = useCallback(async () => {
    try {
      if (window.solana && window.solana.disconnect) {
        await window.solana.disconnect();
      }
    } catch (err) {
      console.error("Failed to disconnect wallet:", err);
    } finally {
      setPublicKey(null);
    }
  }, []);

  // Optional: auto-connect if wallet is already trusted
  useEffect(() => {
    const provider = window.solana;
    if (!provider) return;

    const handleConnect = (pubkey: { toString(): string }) => {
      try {
        const pk = new PublicKey(pubkey.toString());
        setPublicKey(pk);
      } catch (e) {
        console.error("Error parsing public key on connect event:", e);
      }
    };

    const handleDisconnect = () => {
      setPublicKey(null);
    };

    provider.on("connect", handleConnect);
    provider.on("disconnect", handleDisconnect);

    // If Phantom is already connected (trusted), you could eager-connect here

    return () => {
      provider.off("connect", handleConnect);
      provider.off("disconnect", handleDisconnect);
    };
  }, []);

  const value: SolanaWalletContextValue = {
    connection,
    publicKey,
    walletAddress,
    connecting,
    connected,
    connectWallet,
    disconnectWallet,
  };

  return (
    <SolanaWalletContext.Provider value={value}>
      {children}
    </SolanaWalletContext.Provider>
  );
};
