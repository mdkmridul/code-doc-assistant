import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// One .env for the whole repo: load the root one (Next only reads apps/web/.env*).
// Variables already set in the environment win. NEXT_PUBLIC_* values loaded here
// are inlined into the browser bundle when `next dev` / `next build` runs.
const rootEnv = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")].find(
  (file) => existsSync(file),
);
if (rootEnv) process.loadEnvFile(rootEnv);

if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error(
    "NEXT_PUBLIC_API_URL is missing. Copy .env.example to .env at the repo root.",
  );
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
