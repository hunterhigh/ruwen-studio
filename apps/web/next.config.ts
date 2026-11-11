import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  logging: false,
  serverExternalPackages: [
    "worker",
    "@ruwen/core",
    "@ruwen/agents",
    "@ruwen/db",
    "@ruwen/pipeline",
    "pg",
    "pg-boss",
  ],
  webpack(config, { isServer }) {
    if (isServer)
      config.externals.push(
        (
          { request, context }: { request?: string; context?: string },
          callback: (error: Error | null, result?: string) => void,
        ) => {
          if (
            request &&
            /\/config\/(?:settings|health|observability)\.ts$/.test(request) &&
            context
          )
            callback(null, `commonjs ${path.resolve(context, request)}`);
          else if (
            request &&
            (/^@ruwen\//.test(request) || request === "worker")
          )
            callback(null, `commonjs ${request}`);
          else callback(null);
        },
      );
    return config;
  },
  experimental: { cpus: 2 },
};
export default config;
