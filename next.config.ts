import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude from server-side bundling to avoid multiple Konva instances (client-only)
  serverExternalPackages: ['konva'],
};

export default nextConfig;
