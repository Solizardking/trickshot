import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Served at musebook.trade/trickshot through the Musebook reverse proxy.
  basePath: "/trickshot",
  turbopack: {
    // Pin the workspace root — there is an unrelated bun.lock in the home
    // directory that Turbopack otherwise tries to infer a root from.
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
