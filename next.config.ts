import type { NextConfig } from "next";

const isStaticExport =
  process.env.GITHUB_PAGES === "true" ||
  process.env.STATIC_EXPORT === "true";

const nextConfig: NextConfig = isStaticExport
  ? {
      output: "export",
      trailingSlash: true,
    }
  : {};

export default nextConfig;
