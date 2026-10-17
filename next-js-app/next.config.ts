import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: false, // Cloudflare 및 SSE 스트리밍 시 응답 버퍼링 방지
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        // Use BACKEND_URL from docker, or default to localhost for local run
        destination: `${process.env.BACKEND_URL || 'http://localhost:8080'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;


