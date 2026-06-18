import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/_probe/leads/route";
import { getPrismaClient } from "@/server/db/prisma";
import { resolveTenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";

const prisma = getPrismaClient();

let tenantAId = "";
let tenantBId = "";
let leadAId = "";
const userEmailB = "sales-b@tradepilot.local";

async function ensureSeedState() {
  const tenants = await prisma.tenant.findMany({
    where: {
      slug: {
        in: ["shenghai-machinery", "control-company"],
      },
    },
    orderBy: { slug: "asc" },
  });

  if (tenants.length !== 2) {
    throw new Error(
      "Seed data missing. Run `npm run prisma:seed` before tenant isolation tests.",
    );
  }

  const lead = await prisma.lead.findFirst({
    where: {
      tenant: {
        slug: "shenghai-machinery",
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!lead) {
    throw new Error(
      "Seeded lead missing. Run `npm run prisma:seed` before tenant isolation tests.",
    );
  }

  tenantAId = tenants.find((tenant) => tenant.slug === "shenghai-machinery")!.id;
  tenantBId = tenants.find((tenant) => tenant.slug === "control-company")!.id;
  leadAId = lead.id;
}

beforeAll(async () => {
  await ensureSeedState();
});

describe("tenant isolation", () => {
  it("R1.1 rejects mismatched tenant header and writes audit log", async () => {
    const beforeCount = await prisma.auditLog.count({
      where: {
        tenantId: tenantAId,
        action: "tenant_access_denied",
      },
    });

    const request = new Request(
      `http://localhost:3100/api/_probe/leads`,
      {
        headers: {
          "x-tenant-id": tenantAId,
          "x-user-email": userEmailB,
        },
      },
    );

    const response = await GET(request as never);
    expect(response.status).toBe(403);

    const payload = await response.json();
    expect(payload.error.code).toBe("FORBIDDEN");

    const afterCount = await prisma.auditLog.count({
      where: {
        tenantId: tenantAId,
        action: "tenant_access_denied",
      },
    });

    expect(afterCount).toBe(beforeCount + 1);
  });

  it("R1.2 returns NOT_FOUND for another tenant's lead id", async () => {
    const request = new Request(
      `http://localhost:3100/api/_probe/leads?leadId=${leadAId}`,
      {
        headers: {
          "x-tenant-id": tenantBId,
          "x-user-email": userEmailB,
        },
      },
    );

    const response = await GET(request as never);
    expect(response.status).toBe(404);

    const payload = await response.json();
    expect(payload.error.code).toBe("NOT_FOUND");
  });

  it("R1.3 never returns another tenant's knowledge chunks", async () => {
    const context = await resolveTenantContext(
      new Headers({
        "x-tenant-id": tenantBId,
        "x-user-email": userEmailB,
      }),
    );

    const tenantPrisma = getTenantPrisma(context);
    const chunks = await tenantPrisma.knowledgeChunk.findMany({
      where: {
        text: {
          contains: "7.5 bar pressure",
        },
      },
      select: {
        id: true,
      },
    });

    expect(chunks).toEqual([]);
  });

  it("throws when tenant-scoped tables are queried without context", async () => {
    expect(() => getTenantPrisma(undefined)).toThrow(
      "Tenant-scoped Prisma access requires tenant context.",
    );
  });
});
