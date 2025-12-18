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

type StandardWallet = {
  name: string;
  icon?: string | null;
  accounts: readonly any[];
  features: Record<string, any>;
};

type LegacyProvider = {
  isPhantom?: boolean;
  isBackpack?: boolean;
  publicKey?: { toString(): string };
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{
    publicKey: { toString(): string };
  }>;
  disconnect: () => Promise<void>;
  on: (event: string, handler: (...args: any[]) => void) => void;
  off: (event: string, handler: (...args: any[]) => void) => void;
  request?: (args: { method: string; params?: any }) => Promise<any>;
};

declare global {
  interface Window {
    solana?: LegacyProvider;
    phantom?: { solana?: LegacyProvider };
    backpack?: { solana?: LegacyProvider };
  }

  interface Navigator {
    wallets?: {
      wallets: readonly StandardWallet[];
      addEventListener?: (
        event: string,
        handler: (...args: any[]) => void
      ) => void;
      removeEventListener?: (
        event: string,
        handler: (...args: any[]) => void
      ) => void;
      on?: (event: string, handler: (...args: any[]) => void) => void;
      off?: (event: string, handler: (...args: any[]) => void) => void;
    };
  }
}

export type UiWallet =
  | {
      id: string;
      type: "standard";
      name: string;
      icon: string | null;
      standardWallet: StandardWallet;
    }
  | {
      id: string;
      type: "legacy";
      name: string;
      icon: string | null;
      provider: LegacyProvider;
    };

type WalletAccount = {
  address: string;
  publicKey?: Uint8Array | number[];
};

export interface SolanaWalletContextValue {
  connection: Connection;
  publicKey: PublicKey | null;
  walletAddress: string | null;
  connecting: boolean;
  connected: boolean;
  connectWallet: (walletIdOrName?: string) => Promise<void>;
  disconnectWallet: () => Promise<void>;
  wallets: UiWallet[];
  selectedWallet: UiWallet | null;
  selectedAccount: { address: string } | null;
  isConnected: boolean;
  setWalletAndAccount: (
    wallet: UiWallet | null,
    account: WalletAccount | null
  ) => Promise<void>;
}

export const SolanaWalletContext =
  createContext<SolanaWalletContextValue | undefined>(undefined);

interface SolanaWalletProviderProps {
  children: ReactNode;
}

const getWalletStandardApi = () => {
  if (typeof navigator === "undefined") return null;
  return navigator.wallets ?? null;
};

const ensureLegacyProviderAliases = () => {
  if (typeof window === "undefined") return;
  if (window.phantom?.solana && !window.solana) {
    window.solana = window.phantom.solana;
  }
  if (window.backpack?.solana && !window.solana) {
    window.solana = window.backpack.solana;
  }
};

const LEGACY_WALLET_NAMES: Record<string, string> = {
  Phantom: "Phantom",
  Backpack: "Backpack",
};

const sanitizeWalletIcon = (icon?: string | null): string | null => {
  if (!icon) return null;
  return icon.startsWith("data:") ? icon : null;
};

export const SolanaWalletProvider: React.FC<SolanaWalletProviderProps> = ({
  children,
}) => {
  const rpcUrl =
    import.meta.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";

  const [connection] = useState(() => new Connection(rpcUrl, "confirmed"));
  const [wallets, setWallets] = useState<UiWallet[]>([]);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<UiWallet | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<{
    address: string;
  } | null>(null);

  const detectWallets = useCallback((): UiWallet[] => {
    if (typeof window === "undefined") return [];
    ensureLegacyProviderAliases();
    const detected: UiWallet[] = [];

    const standardApi = getWalletStandardApi();
    const standardWallets = standardApi?.wallets ?? [];
    standardWallets.forEach((wallet, index) => {
      detected.push({
        id: `standard-${wallet.name}-${index}`,
        type: "standard",
        name: wallet.name,
        icon: sanitizeWalletIcon(wallet.icon || null),
        standardWallet: wallet,
      });
    });

    const legacyProviders: LegacyProvider[] = [];
    if (window.phantom?.solana) legacyProviders.push(window.phantom.solana);
    if (window.backpack?.solana) legacyProviders.push(window.backpack.solana);
    if (window.solana && !legacyProviders.includes(window.solana)) {
      legacyProviders.push(window.solana);
    }

    legacyProviders.forEach((provider, index) => {
      let name = "Solana Wallet";
      if (provider.isPhantom) name = LEGACY_WALLET_NAMES.Phantom;
      else if (provider.isBackpack) name = LEGACY_WALLET_NAMES.Backpack;

      detected.push({
        id: `legacy-${name}-${index}`,
        type: "legacy",
        name,
        icon: null,
        provider,
      });
    });

    return detected;
  }, []);

  useEffect(() => {
    setWallets(detectWallets());
  }, [detectWallets]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => {
      ensureLegacyProviderAliases();
      setWallets(detectWallets());
    };
    window.addEventListener("phantom#initialized", refresh, { once: true });
    window.addEventListener("load", refresh);
    return () => {
      window.removeEventListener("phantom#initialized", refresh);
      window.removeEventListener("load", refresh);
    };
  }, [detectWallets]);

  useEffect(() => {
    const api = getWalletStandardApi();
    if (!api) return;

    const refresh = () => setWallets(detectWallets());
    const add =
      api.addEventListener?.bind(api) ||
      api.on?.bind(api) ||
      (() => undefined);
    const remove =
      api.removeEventListener?.bind(api) ||
      api.off?.bind(api) ||
      (() => undefined);

    add("register", refresh);
    add("unregister", refresh);
    return () => {
      remove("register", refresh);
      remove("unregister", refresh);
    };
  }, [detectWallets]);

  const applyStandardAccount = useCallback(
    (wallet: Extract<UiWallet, { type: "standard" }>, account: WalletAccount) => {
      setSelectedWallet(wallet);
      setSelectedAccount({ address: account.address });
      if (account.publicKey) {
        try {
          setPublicKey(new PublicKey(account.publicKey));
          return;
        } catch {
          /* ignore */
        }
      }
      setPublicKey(null);
    },
    []
  );

  const connectWithLegacyProvider = useCallback(
    async (wallet: Extract<UiWallet, { type: "legacy" }>) => {
      const provider = wallet.provider;
      let response: { publicKey: { toString(): string } };
      try {
        response = await provider.connect({ onlyIfTrusted: false });
      } catch (primaryErr: any) {
        const code = primaryErr?.code ?? primaryErr?.error?.code;
        const message: string = primaryErr?.message || "";
        const looksUnexpected = message.toLowerCase().includes("unexpected");
        if (provider.request && (code === -32002 || looksUnexpected)) {
          response = await provider.request({
            method: "connect",
            params: { onlyIfTrusted: false },
          });
        } else {
          throw primaryErr;
        }
      }
      const pk = new PublicKey(response.publicKey.toString());
      setPublicKey(pk);
      setSelectedWallet(wallet);
      setSelectedAccount({ address: pk.toBase58() });
    },
    []
  );

  const connectStandardWallet = useCallback(
    async (wallet: Extract<UiWallet, { type: "standard" }>) => {
      const feature = wallet.standardWallet.features?.["standard:connect"];
      if (!feature?.connect) {
        throw new Error(`${wallet.name} does not support standard:connect`);
      }
      const result = await feature.connect();
      const account = result?.accounts?.[0];
      if (!account) {
        throw new Error("No accounts returned by wallet.");
      }
      applyStandardAccount(wallet, account);
      return result.accounts;
    },
    [applyStandardAccount]
  );

  const connectWallet = useCallback(
    async (walletIdOrName?: string) => {
      if (connecting) return;
      try {
        setConnecting(true);
        const list = wallets.length ? wallets : detectWallets();
        if (!wallets.length && list.length) {
          setWallets(list);
        }
        if (list.length === 0) {
          alert("No Solana wallets detected. Please install a compatible wallet.");
          return;
        }
        const target =
          (walletIdOrName &&
            (list.find((w) => w.id === walletIdOrName) ||
              list.find((w) => w.name === walletIdOrName))) ||
          selectedWallet ||
          list[0];
        if (!target) return;

        if (target.type === "standard") {
          await connectStandardWallet(target);
        } else {
          await connectWithLegacyProvider(target);
        }
      } catch (err) {
        console.error("Failed to connect wallet:", err);
        let message = "Unexpected wallet error. Check the extension.";
        const code = (err as any)?.code ?? (err as any)?.error?.code;
        if (code === 4001) {
          message = "Connection request was rejected.";
        } else if (code === -32002) {
          message =
            "Connection request already pending in your wallet. Please confirm it there.";
        } else if ((err as any)?.message) {
          message = (err as any).message;
        }
        alert(message);
      } finally {
        setConnecting(false);
      }
    },
    [
      connecting,
      detectWallets,
      wallets,
      selectedWallet,
      connectStandardWallet,
      connectWithLegacyProvider,
    ]
  );

  const disconnectWallet = useCallback(async () => {
    if (!selectedWallet) return;
    try {
      if (selectedWallet.type === "standard") {
        const disconnectFeature =
          selectedWallet.standardWallet.features?.["standard:disconnect"];
        await disconnectFeature?.disconnect?.();
      } else {
        await selectedWallet.provider.disconnect();
      }
    } catch (err) {
      console.error("Failed to disconnect wallet:", err);
    } finally {
      setPublicKey(null);
      setSelectedWallet(null);
      setSelectedAccount(null);
    }
  }, [selectedWallet]);

  useEffect(() => {
    const provider =
      selectedWallet && selectedWallet.type === "legacy"
        ? selectedWallet.provider
        : null;
    if (!provider) return;

    const handleConnect = (pubkey: { toString(): string }) => {
      try {
        const pk = new PublicKey(pubkey.toString());
        setPublicKey(pk);
        setSelectedAccount({ address: pk.toBase58() });
      } catch (err) {
        console.error("Error parsing public key on connect event:", err);
      }
    };

    const handleDisconnect = () => {
      setPublicKey(null);
      setSelectedAccount(null);
    };

    provider.on("connect", handleConnect);
    provider.on("disconnect", handleDisconnect);

    provider.connect({ onlyIfTrusted: true }).catch(() => {
      /* ignore */
    });

    return () => {
      provider.off("connect", handleConnect);
      provider.off("disconnect", handleDisconnect);
    };
  }, [selectedWallet]);

  const setWalletAndAccount = useCallback(
    async (wallet: UiWallet | null, account: WalletAccount | null) => {
      if (!wallet) {
        await disconnectWallet();
        return;
      }
      if (wallet.type === "standard") {
        if (account) {
          applyStandardAccount(wallet, account);
        } else {
          await connectStandardWallet(wallet);
        }
      } else {
        await connectWithLegacyProvider(wallet);
      }
    },
    [
      disconnectWallet,
      applyStandardAccount,
      connectStandardWallet,
      connectWithLegacyProvider,
    ]
  );

  const walletAddress = useMemo(
    () => (publicKey ? publicKey.toBase58() : null),
    [publicKey]
  );

  const value: SolanaWalletContextValue = {
    connection,
    publicKey,
    walletAddress,
    connecting,
    connected: !!publicKey,
    connectWallet,
    disconnectWallet,
    wallets,
    selectedWallet,
    selectedAccount,
    isConnected: !!publicKey,
    setWalletAndAccount,
  };

  return (
    <SolanaWalletContext.Provider value={value}>
      {children}
    </SolanaWalletContext.Provider>
  );
};
