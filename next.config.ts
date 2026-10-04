import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Allow Cloudflare quick tunnels and local origins for Next.js HMR WebSocket
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "trycloudflare.com",
    "localhost:3000",
    "127.0.0.1:3000",
  ],

  // ── Security Headers (Phase 9 Hardened) ─────────────────────────────────
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent framing / clickjacking
          { key: "X-Frame-Options", value: "DENY" },

          // HTTP Strict Transport Security (HSTS) - production only (breaks dev HTTP localhost)
          ...(isProd
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains; preload",
                },
              ]
            : []),

          // Prevent MIME type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },

          // Strict referrer policy
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

          // Restrict browser features and APIs
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), usb=(), payment=(), display-capture=()",
          },

          // Cross-Origin isolation
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },

          // Content Security Policy
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Script sources: Allow 'unsafe-inline' and 'unsafe-eval' for Next.js and wagmi WASM
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              // Direct connect to Web3 RPCs, WalletConnect relay, S3/R2 storage, and Cloudflare tunnel WebSockets
              "connect-src 'self' https://*.walletconnect.com wss://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.org https://*.infura.io https://*.alchemyapi.io https://*.s3.amazonaws.com https://*.r2.cloudflarestorage.com https://*.r2.dev https://*.backblazeb2.com http://localhost:* ws://localhost:* wss://localhost:* https://*.trycloudflare.com wss://*.trycloudflare.com",
              "font-src 'self' data:",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              ...(isProd ? ["upgrade-insecure-requests"] : []),
            ].join("; "),
          },
        ],
      },
    ];
  },

  // ── Server-only packages ────────────────────────────────────────────────
  serverExternalPackages: ["pg", "@aws-sdk/client-s3", "@aws-sdk/lib-storage"],

  // ── Turbopack configuration ─────────────────────────────────────────────
  turbopack: {},

  // ── Webpack fallbacks for node built-ins ─────────────────────────────────
  webpack(config) {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      fs: false,
      dns: false,
    };
    return config;
  },
};

export default nextConfig;
