import type { NextConfig } from "next";
import { validateEnv } from "./lib/env";

validateEnv(process.env);

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
