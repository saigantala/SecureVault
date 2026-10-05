// lib/wagmi.ts
// wagmi config — wallet connection setup
// Restricted specifically to MetaMask (browser extension) and WalletConnect (mobile QR).

import { http, createConfig } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_ID ?? "3fcc6bba2d1de962d911bb5b5c3dba68";

export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia],
  connectors: [
    injected({ target: "metaMask" }),
    injected(),
    walletConnect({ projectId: WALLETCONNECT_PROJECT_ID }),
  ],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: true, // required for Next.js App Router
});

// Augment the wagmi module so TypeScript infers the correct config type
declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
