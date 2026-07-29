import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output keeps the production Docker image small — Next traces only
  // the files actually reachable at runtime.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // better-sqlite3 is a native addon; it must stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
