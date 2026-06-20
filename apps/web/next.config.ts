import type { NextConfig } from "next";
import { validateEnv } from "./lib/env";

validateEnv(process.env);

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  reactStrictMode: true,
};

export default nextConfig;
