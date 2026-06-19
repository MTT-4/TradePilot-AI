import { beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import {
  createDataRequest,
  listDataRequests,
  resolveDataRequest,
} from "@/server/data-requests/service";

const prisma = getPrismaClient();

let ownerContext: TenantContext;
let salesContext: TenantContext;

beforeAll(async () => {
  const [ownerMembership, salesMembership] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        tenant: {
          slug: "shenghai-machinery",
        },
        user: {
          email: "owner-a@tradepilot.local",
        },
        status: "ACTIVE",
      },
      select: {
        tenantId: true,
        userId: true,
        role: true,
      },
    }),
    prisma.membership.findFirst({
      where: {
        tenant: {
          slug: "shenghai-machinery",
        },
        user: {
          email: "sales-a@tradepilot.local",
        },
        status: "ACTIVE",
      },
      select: {
        tenantId: true,
        userId: true,
        role: true,
      },
    }),
  ]);

  if (!ownerMembership || !salesMembership) {
    throw new Error(
      "Seed data missing. Run `npm run prisma:seed` before T7.2 hardening tests.",
    );
  }

  ownerContext = ownerMembership;
  salesContext = salesMembership;
});

describe("T7.2 data requests hardening kickoff", () => {
  it("creates and lists GDPR/PIPL export or delete requests with audit logs", async () => {
    const created = await createDataRequest({
      tenantContext: ownerContext,
      requestedByUserId: ownerContext.userId,
      input: {
        type: "export",
        scope: {
          channel: "gdpr",
          subjectEmail: `export-${Date.now()}@example.com`,
        },
      },
    });

    expect(created.type).toBe("export");
    expect(created.status).toBe("pending");
    expect(created.scope).toMatchObject({
      channel: "gdpr",
    });

    const listed = await listDataRequests({
      tenantContext: ownerContext,
      status: "pending",
    });
    const matched = listed.items.find((item) => item.id === created.id);

    expect(matched).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({
      where: {
        tenantId: ownerContext.tenantId,
        entityType: "data_request",
        entityId: created.id,
        action: "data_request_created",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        actorUserId: true,
        metadata: true,
      },
    });

    expect(audit?.actorUserId).toBe(ownerContext.userId);
    expect(audit?.metadata).toMatchObject({
      type: "export",
    });
  });

  it("resolves delete requests and keeps a full audit trail", async () => {
    const created = await createDataRequest({
      tenantContext: ownerContext,
      requestedByUserId: ownerContext.userId,
      input: {
        type: "delete",
        scope: {
          channel: "pipl",
          tenantSlug: "shenghai-machinery",
        },
      },
    });

    const resolved = await resolveDataRequest({
      tenantContext: ownerContext,
      requestId: created.id,
      resolvedByUserId: ownerContext.userId,
      input: {
        status: "completed",
      },
    });

    expect(resolved.status).toBe("completed");
    expect(resolved.completedAt).toEqual(expect.any(String));

    const audit = await prisma.auditLog.findFirst({
      where: {
        tenantId: ownerContext.tenantId,
        entityType: "data_request",
        entityId: created.id,
        action: "data_request_resolved",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        actorUserId: true,
        metadata: true,
      },
    });

    expect(audit?.actorUserId).toBe(ownerContext.userId);
    expect(audit?.metadata).toMatchObject({
      status: "completed",
      type: "delete",
    });
  });

  it("blocks sales from creating compliance requests", async () => {
    await expect(
      createDataRequest({
        tenantContext: salesContext,
        requestedByUserId: salesContext.userId,
        input: {
          type: "export",
          scope: {
            channel: "gdpr",
          },
        },
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });
});
