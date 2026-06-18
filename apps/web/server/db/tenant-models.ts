import { Prisma } from "@prisma/client";

const globalModels = new Set<Prisma.ModelName>([
  "Tenant",
  "User",
  "PlatformRule",
]);

export const tenantScopedModels = new Set<Prisma.ModelName>(
  Object.values(Prisma.ModelName).filter((model) => !globalModels.has(model)),
);

export function isTenantScopedModel(
  model: string | undefined,
): model is Prisma.ModelName {
  return !!model && tenantScopedModels.has(model as Prisma.ModelName);
}

export function getDelegateName(model: Prisma.ModelName): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}
