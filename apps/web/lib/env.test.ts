import { describe, expect, it } from "vitest";
import { validateEnv } from "./env";

const validEnv = {
  APP_URL: "http://localhost:3100",
  TRACKING_BASE_URL: "http://localhost:3100/t",
  DATABASE_URL: "postgresql://tradepilot:tradepilot@localhost:5432/tradepilot",
  REDIS_URL: "redis://localhost:6379",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "tradepilot-local",
  S3_ACCESS_KEY: "tradepilot",
  S3_SECRET_KEY: "tradepilot-local-secret",
  AUTH_SECRET: "super-secret",
  OPENAI_API_KEY: "openai-placeholder",
  GOOGLE_TRANSLATE_KEY: "google-placeholder",
  LOCAL_QWEN_BASE_URL: "http://localhost:8080/v1",
  LOCAL_QWEN_MODEL: "qwen2.5-vl-32b-instruct",
  LOCAL_BGE_BASE_URL: "http://localhost:8082/v1",
  LOCAL_BGE_MODEL: "bge-m3",
};

describe("validateEnv", () => {
  it("accepts a complete environment map", () => {
    expect(validateEnv(validEnv)).toMatchObject(validEnv);
  });

  it("throws when a required variable is missing", () => {
    expect(() => {
      validateEnv({
        ...validEnv,
        DATABASE_URL: "",
      });
    }).toThrow();
  });
});
