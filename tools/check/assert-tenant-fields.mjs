import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schemaPath = resolve(process.cwd(), "prisma/schema.prisma");
const schema = readFileSync(schemaPath, "utf8");

const globalModels = new Set(["Tenant", "User", "PlatformRule"]);
const modelBlocks = [...schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)];

if (modelBlocks.length === 0) {
  throw new Error("No Prisma models found in prisma/schema.prisma");
}

const failures = [];

for (const [, modelName, body] of modelBlocks) {
  if (globalModels.has(modelName)) {
    continue;
  }

  if (!/\btenantId\b/.test(body)) {
    failures.push(`${modelName}: missing tenantId field`);
  }

  if (!/@@index\(\[tenantId\]\)/.test(body)) {
    failures.push(`${modelName}: missing @@index([tenantId])`);
  }
}

if (failures.length > 0) {
  console.error("Tenant isolation schema assertions failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `tenantId assertions passed for ${modelBlocks.length - globalModels.size} tenant-scoped models.`,
);
