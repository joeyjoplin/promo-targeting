// src/solana/useSolanaWallet.ts
import { useContext } from "react";
import {
  SolanaWalletContext,
  SolanaWalletContextValue,
} from "./SolanaWalletProvider";

// Simple hook to consume the wallet context
export const useSolanaWallet = (): SolanaWalletContextValue => {
  const ctx = useContext(SolanaWalletContext);

  if (!ctx) {
    throw new Error(
      "useSolanaWallet must be used within a <SolanaWalletProvider />"
    );
  }

  return ctx;
};

