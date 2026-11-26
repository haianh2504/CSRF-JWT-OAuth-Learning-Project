import type { NextConfig } from "next";

const backendUrl = (process.env.BACKEND_URL ?? "http://localhost:8080").replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
      { source: "/oauth2/:path*", destination: `${backendUrl}/oauth2/:path*` },
      { source: "/login/oauth2/code/:provider", destination: `${backendUrl}/login/oauth2/code/:provider` }
    ];
  }
};

export default nextConfig;
