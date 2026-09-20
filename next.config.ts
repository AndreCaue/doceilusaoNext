import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React 19 uses the automatic JSX runtime (no need for `React` in scope), but
  // Next's build-time ESLint still enforces `react/react-in-jsx-scope` with no
  // eslint config installed, producing false-positive errors. TypeScript (`tsc`)
  // is the type gate for this port; ESLint config is deferred.
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.s3.sa-east-1.amazonaws.com",
        pathname: "/products/**",
      },
    ],
  },
};

export default nextConfig;
