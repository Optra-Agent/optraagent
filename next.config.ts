import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.OPTRA_E2E_DIST_DIR ?? ".next",
  poweredByHeader: false,
  // Browsers opened on 127.0.0.1 are a different origin from localhost. Without this, Next blocks the dev HMR socket and
  // the page never hydrates (the wallet session check stays on "Checking wallet session…").
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
