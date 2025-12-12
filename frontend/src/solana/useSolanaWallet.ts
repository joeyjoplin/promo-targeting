// src/solana/useSolanaWallet.ts
import { useContext, useState, useCallback } from "react";
import {
  SolanaWalletContext,
  SolanaWalletContextValue,
  UiWallet,
} from "./SolanaWalletProvider";

export const useSolanaWallet = (): SolanaWalletContextValue => {
  const ctx = useContext(SolanaWalletContext);
  if (!ctx) {
    throw new Error(
      "useSolanaWallet must be used within a <SolanaWalletProvider />"
    );
  }
  return ctx;
};

export const useSolana = useSolanaWallet;

export const useConnect = (
  wallet: UiWallet | null
): [boolean, () => Promise<WalletAccountResult[] | undefined>] => {
  const { setWalletAndAccount } = useSolanaWallet();
  const [pending, setPending] = useState(false);

  const connectFn = useCallback(async () => {
    if (!wallet) return;

    if (wallet.type === "standard") {
      const feature =
        wallet.standardWallet.features?.["standard:connect"];
      if (!feature?.connect) {
        throw new Error(`${wallet.name} does not support standard:connect`);
      }
      setPending(true);
      try {
        const result = await feature.connect();
        const accounts = result?.accounts ?? [];
        const account = accounts.length > 0 ? accounts[0] : null;
        await setWalletAndAccount(wallet, account);
        return accounts;
      } finally {
        setPending(false);
      }
    }

    setPending(true);
    try {
      await setWalletAndAccount(wallet, null);
      return [];
    } finally {
      setPending(false);
    }
  }, [wallet, setWalletAndAccount]);

  return [pending, connectFn];
};

export const useDisconnect = (
  wallet: UiWallet | null
): [boolean, () => Promise<void>] => {
  const { disconnectWallet } = useSolanaWallet();
  const [pending, setPending] = useState(false);

  const disconnectFn = useCallback(async () => {
    if (!wallet) return;

    if (wallet.type === "standard") {
      const feature =
        wallet.standardWallet.features?.["standard:disconnect"];
      setPending(true);
      try {
        await feature?.disconnect?.();
      } finally {
        setPending(false);
      }
    }
    await disconnectWallet();
  }, [wallet, disconnectWallet]);

  return [pending, disconnectFn];
};

export type WalletAccountResult = {
  address: string;
  publicKey?: Uint8Array | number[];
};
