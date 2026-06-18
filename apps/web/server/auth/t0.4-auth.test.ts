import * as OTPAuth from "otpauth";
import { beforeAll, describe, expect, it } from "vitest";
import { MembershipRole, MembershipStatus } from "@prisma/client";
import { getPrismaClient } from "@/server/db/prisma";
import { hashPassword } from "@/server/auth/password";
import { requireTenantAccess } from "@/server/auth/access";
import {
  beginLogin,
  registerUser,
  verifyTwoFactorCode,
} from "@/server/auth/service";
import { updateTenantMembership } from "@/server/auth/member-admin";

const prisma = getPrismaClient();

let tenantAId = "";
let ownerAId = "";

function getCurrentTotpCode(secret: string) {
  const totp = new OTPAuth.TOTP({
    issuer: "TradePilot AI",
    label: "test-user",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  return totp.generate();
}

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "shenghai-machinery",
    },
    select: {
      id: true,
    },
  });
  const owner = await prisma.user.findUnique({
    where: {
      email: "owner-a@tradepilot.local",
    },
    select: {
      id: true,
    },
  });

  if (!tenant || !owner) {
    throw new Error(
      "Seed data missing. Run `npm run prisma:seed` before T0.4 auth tests.",
    );
  }

  tenantAId = tenant.id;
  ownerAId = owner.id;
});

describe("T0.4 auth and RBAC", () => {
  it("supports register -> 2FA bind -> login requires TOTP", async () => {
    const email = `t0-4-auth-${Date.now()}@tradepilot.local`;
    const password = "TradePilot123";
    const registration = await registerUser({
      email,
      password,
      name: "T0.4 Auth Tester",
    });

    const setupVerification = await verifyTwoFactorCode({
      challengeId: registration.challengeId,
      code: getCurrentTotpCode(registration.totpSecret),
    });

    expect(setupVerification.userId).toBe(registration.userId);

    const userAfterSetup = await prisma.user.findUniqueOrThrow({
      where: {
        id: registration.userId,
      },
      select: {
        twoFactorEnabled: true,
      },
    });

    expect(userAfterSetup.twoFactorEnabled).toBe(true);

    const login = await beginLogin({
      email,
      password,
    });

    expect(login.status).toBe("2fa_required");

    const loginVerification = await verifyTwoFactorCode({
      challengeId: login.challengeId,
      code: getCurrentTotpCode(registration.totpSecret),
    });

    expect(loginVerification.status).toBe("ok");
    expect(loginVerification.userId).toBe(registration.userId);
  });

  it("returns 403 when a viewer accesses an admin+ tenant route", async () => {
    const viewerEmail = `viewer-${Date.now()}@tradepilot.local`;
    const viewer = await prisma.user.create({
      data: {
        email: viewerEmail,
        name: "Viewer User",
        passwordHash: await hashPassword("ViewerPass123"),
        twoFactorEnabled: true,
        totpSecret: "JBSWY3DPEHPK3PXP",
      },
      select: {
        id: true,
      },
    });

    await prisma.membership.create({
      data: {
        tenantId: tenantAId,
        userId: viewer.id,
        role: MembershipRole.VIEWER,
        status: MembershipStatus.ACTIVE,
      },
    });

    await expect(
      requireTenantAccess(
        new Headers({
          "x-tenant-id": tenantAId,
        }),
        viewer.id,
        MembershipRole.ADMIN,
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("writes audit_log when a member role changes", async () => {
    const memberEmail = `member-${Date.now()}@tradepilot.local`;
    const member = await prisma.user.create({
      data: {
        email: memberEmail,
        name: "Role Target",
        passwordHash: await hashPassword("MemberPass123"),
        twoFactorEnabled: true,
        totpSecret: "JBSWY3DPEHPK3PXP",
      },
      select: {
        id: true,
      },
    });

    const membership = await prisma.membership.create({
      data: {
        tenantId: tenantAId,
        userId: member.id,
        role: MembershipRole.VIEWER,
        status: MembershipStatus.ACTIVE,
      },
      select: {
        id: true,
      },
    });

    const { context } = await requireTenantAccess(
      new Headers({
        "x-tenant-id": tenantAId,
      }),
      ownerAId,
      MembershipRole.ADMIN,
    );

    const beforeCount = await prisma.auditLog.count({
      where: {
        tenantId: tenantAId,
        action: "membership_role_updated",
        entityId: membership.id,
      },
    });

    const updatedMembership = await updateTenantMembership({
      tenantContext: context,
      actorUserId: ownerAId,
      memberId: membership.id,
      role: MembershipRole.OPERATOR,
    });

    expect(updatedMembership.role).toBe("operator");

    const afterCount = await prisma.auditLog.count({
      where: {
        tenantId: tenantAId,
        action: "membership_role_updated",
        entityId: membership.id,
      },
    });

    expect(afterCount).toBe(beforeCount + 1);

    const latestAuditLog = await prisma.auditLog.findFirstOrThrow({
      where: {
        tenantId: tenantAId,
        action: "membership_role_updated",
        entityId: membership.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        metadata: true,
      },
    });

    expect(latestAuditLog.metadata).toMatchObject({
      before: {
        role: "viewer",
      },
      after: {
        role: "operator",
      },
    });
  });
});
