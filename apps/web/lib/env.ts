import { z } from "zod";

const envSchema = z.object({
  APP_URL: z.string().url(),
  TRACKING_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  GOOGLE_TRANSLATE_BASE_URL: z
    .string()
    .url()
    .default("https://translation.googleapis.com/language/translate/v2"),
  GOOGLE_TRANSLATE_KEY: z.string().min(1),
  LOCAL_QWEN_BASE_URL: z.string().url(),
  LOCAL_QWEN_MODEL: z.string().min(1),
  LOCAL_BGE_BASE_URL: z.string().url(),
  LOCAL_BGE_MODEL: z.string().min(1),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(
  source: Record<string, string | undefined>,
): AppEnv {
  return envSchema.parse(source);
}

export function getEnv(): AppEnv {
  return validateEnv(process.env);
}
