"use client";

import { injected } from "wagmi/connectors";
import type { EIP1193Provider } from "viem";

declare global {
  interface Window {
    phantom?: { ethereum?: EIP1193Provider & { isPhantom?: true } };
  }
}

export const walletOptions = [
  { label: "MetaMask", connector: injected({ target: "metaMask" }) },
  {
    label: "Phantom EVM",
    connector: injected({
      target: () => {
        const provider = typeof window === "undefined" ? undefined : window.phantom?.ethereum;
        return provider ? { id: "phantom", name: "Phantom EVM", provider } : undefined;
      },
    }),
  },
] as const;
