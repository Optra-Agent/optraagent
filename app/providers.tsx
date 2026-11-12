"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http, WagmiProvider } from "wagmi";
import { robinhoodMainnet } from "../lib/chain/robinhood";
import { walletOptions } from "../lib/chain/wallets";
import { AuthSessionProvider } from "../components/app/AuthSessionProvider";

const config = createConfig({
  chains: [robinhoodMainnet],
  connectors: walletOptions.map((option) => option.connector),
  transports: { [robinhoodMainnet.id]: http(robinhoodMainnet.rpcUrls.default.http[0]) },
  ssr: true,
  multiInjectedProviderDiscovery: false,
});

const queryClient = new QueryClient();

export function AppProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
