"use client";

/**
 * components/Providers.tsx
 *
 * Client-side provider tree: wagmi (wallet) + React Query.
 * Wrap the app layout in this component so all pages can use
 * useAccount(), useQuery(), etc.
 */

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  // Create the QueryClient inside a useState so it's stable per session
  // and not re-created on every render.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000, // 1 minute default
          },
        },
      })
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
