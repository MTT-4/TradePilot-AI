import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const envFile = path.join(root, ".env");
const envMap = new Map();

if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/u);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    envMap.set(key, value);
  }
}

function readValue(key) {
  return process.env[key] ?? envMap.get(key) ?? "";
}

function isPlaceholder(value) {
  return (
    value.length === 0 ||
    value.startsWith("replace-with-") ||
    value.startsWith("example-") ||
    value === "changeme" ||
    value === "your-secret-here"
  );
}

const requiredSecrets = [
  "AUTH_SECRET",
  "OPENAI_API_KEY",
  "GOOGLE_TRANSLATE_KEY",
  "S3_SECRET_KEY",
];

const optionalSecrets = ["INBOUND_EMAIL_WEBHOOK_SECRET"];
const failures = [];

for (const key of requiredSecrets) {
  const value = readValue(key);

  if (isPlaceholder(value)) {
    failures.push(`${key} is missing or still uses a placeholder value.`);
  }
}

for (const key of optionalSecrets) {
  const value = readValue(key);

  if (value && isPlaceholder(value)) {
    failures.push(`${key} is configured but still uses a placeholder value.`);
  }
}

if (failures.length > 0) {
  console.error("Secret source check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Secret source check passed for ${requiredSecrets.length} required secrets.`,
);
