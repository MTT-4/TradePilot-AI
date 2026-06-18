import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

const rootDir = path.resolve(process.cwd(), "../..");
const envPath = existsSync(path.join(rootDir, ".env"))
  ? path.join(rootDir, ".env")
  : path.join(rootDir, ".env.example");

config({ path: envPath });
