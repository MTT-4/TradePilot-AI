import { ApiError } from "@/server/api/errors";
import { getEnv } from "@/lib/env";

export type RedisConnectionOptions = {
  host: string;
  port: number;
  db?: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
  maxRetriesPerRequest: null;
};

export function getRedisConnectionOptions(): RedisConnectionOptions {
  const env = getEnv();
  let parsed: URL;

  try {
    parsed = new URL(env.REDIS_URL);
  } catch {
    throw new ApiError(500, "INTERNAL", "REDIS_URL is invalid.");
  }

  const port = parsed.port ? Number(parsed.port) : 6379;

  if (!Number.isFinite(port)) {
    throw new ApiError(500, "INTERNAL", "REDIS_URL port is invalid.");
  }

  return {
    host: parsed.hostname,
    port,
    db:
      parsed.pathname && parsed.pathname !== "/"
        ? Number(parsed.pathname.slice(1))
        : undefined,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
