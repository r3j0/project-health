import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  async rewrites() {
    const backend = (
      process.env.BACKEND_API_URL ?? "http://127.0.0.1:3001"
    ).replace(/\/$/, "");
    return [
      { source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default nextConfig;
