import { Client as PostgresClient } from "pg";
import { createClient as createRedisClient } from "redis";
import { getEnv } from "@/lib/env";

export type ServiceHealth = "up" | "down";

export type HealthStatus = {
  status: "ok" | "degraded";
  db: ServiceHealth;
  redis: ServiceHealth;
};

async function checkDatabase(connectionString: string): Promise<ServiceHealth> {
  const client = new PostgresClient({ connectionString });

  try {
    await client.connect();
    await client.query("select 1");
    return "up";
  } catch {
    return "down";
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkRedis(redisUrl: string): Promise<ServiceHealth> {
  const client = createRedisClient({ url: redisUrl });

  try {
    await client.connect();
    await client.ping();
    return "up";
  } catch {
    return "down";
  } finally {
    if (client.isOpen) {
      await client.quit().catch(() => undefined);
    }
  }
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const env = getEnv();
  const [db, redis] = await Promise.all([
    checkDatabase(env.DATABASE_URL),
    checkRedis(env.REDIS_URL),
  ]);

  return {
    status: db === "up" && redis === "up" ? "ok" : "degraded",
    db,
    redis,
  };
}
