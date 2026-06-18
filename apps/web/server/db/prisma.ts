import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as {
  __tradepilotPrisma?: PrismaClient;
};

export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.__tradepilotPrisma) {
    globalForPrisma.__tradepilotPrisma = new PrismaClient();
  }

  return globalForPrisma.__tradepilotPrisma;
}
