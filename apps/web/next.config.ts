import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    // Enable React 19 features
  },
  // API proxying is handled by /app/api/v1/[...path]/route.ts
  // which provides proper timeout handling and error messages
};

export default nextConfig;
