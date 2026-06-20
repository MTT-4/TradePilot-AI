import {
  LocaleCode,
  MembershipRole,
  MembershipStatus,
} from "@prisma/client";
import { getPrismaClient } from "@/server/db/prisma";
import { ApiError } from "@/server/api/errors";
import {
  issueTwoFactorLoginChallenge,
  issueTwoFactorSetupChallenge,
  verifyTwoFactorChallenge,
} from "@/server/auth/challenge";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createTotpSetup, verifyTotpCode } from "@/server/auth/totp";
import { toApiRole } from "@/server/auth/rbac";

export const INVITED_PASSWORD_PLACEHOLDER = "!invited-account!";

type RegisterInput = {
  email: string;
  password: string;
  name: string;
};

type LoginInput = {
  email: string;
  password: string;
};

type TwoFactorInput = {
  challengeId: string;
  code: string;
};

type PasswordLoginResult =
  | {
      status: "ok";
      userId: string;
      email: string;
    }
  | {
      status: "2fa_required";
      challengeId: string;
    };

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function slugifyTenantName(name: string) {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return normalized || "tenant";
}

async function createUniqueTenantSlug(name: string) {
  const prisma = getPrismaClient();
  const baseSlug = slugifyTenantName(name);

  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
    const existing = await prisma.tenant.findUnique({
      where: {
        slug: candidate,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return candidate;
    }
  }

  throw new ApiError(409, "CONFLICT", "Unable to allocate a unique tenant slug.");
}

function toApiMembershipStatus(status: MembershipStatus) {
  return status.toLowerCase();
}

export async function registerUser({ email, password, name }: RegisterInput) {
  const prisma = getPrismaClient();
  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  const totpSetup = createTotpSetup(normalizedEmail);

  const existingUser = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
    select: {
      id: true,
      passwordHash: true,
      twoFactorEnabled: true,
    },
  });

  if (
    existingUser &&
    existingUser.passwordHash !== INVITED_PASSWORD_PLACEHOLDER
  ) {
    throw new ApiError(409, "CONFLICT", "An account with this email already exists.");
  }

  const user = existingUser
    ? await prisma.user.update({
        where: {
          id: existingUser.id,
        },
        data: {
          name,
          passwordHash,
          totpSecret: totpSetup.secret,
          twoFactorEnabled: false,
        },
        select: {
          id: true,
          email: true,
        },
      })
    : await prisma.user.create({
        data: {
          email: normalizedEmail,
          name,
          passwordHash,
          totpSecret: totpSetup.secret,
        },
        select: {
          id: true,
          email: true,
        },
      });

  return {
    userId: user.id,
    challengeId: issueTwoFactorSetupChallenge(user.id, user.email),
    totpSecret: totpSetup.secret,
    otpauthUrl: totpSetup.otpauthUrl,
  };
}

export async function beginLogin({
  email,
  password,
}: LoginInput): Promise<PasswordLoginResult> {
  const prisma = getPrismaClient();
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      twoFactorEnabled: true,
      totpSecret: true,
    },
  });

  if (!user || user.passwordHash === INVITED_PASSWORD_PLACEHOLDER) {
    throw new ApiError(401, "UNAUTHENTICATED", "Invalid email or password.");
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);

  if (!passwordMatches) {
    throw new ApiError(401, "UNAUTHENTICATED", "Invalid email or password.");
  }

  if (!user.twoFactorEnabled || !user.totpSecret) {
    return {
      status: "ok",
      userId: user.id,
      email: user.email,
    };
  }

  return {
    status: "2fa_required" as const,
    challengeId: issueTwoFactorLoginChallenge(user.id, user.email),
  };
}

export async function verifyTwoFactorCode({
  challengeId,
  code,
}: TwoFactorInput) {
  const prisma = getPrismaClient();
  const challenge = verifyTwoFactorChallenge(challengeId);
  const user = await prisma.user.findUnique({
    where: {
      id: challenge.userId,
    },
    select: {
      id: true,
      email: true,
      name: true,
      totpSecret: true,
      twoFactorEnabled: true,
    },
  });

  if (!user || !user.totpSecret || user.email !== challenge.email) {
    throw new ApiError(
      401,
      "UNAUTHENTICATED",
      "Invalid or expired authentication challenge.",
    );
  }

  if (!verifyTotpCode(user.totpSecret, code)) {
    throw new ApiError(401, "UNAUTHENTICATED", "Invalid two-factor code.");
  }

  if (challenge.type === "two_factor_setup") {
    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        twoFactorEnabled: true,
        emailVerifiedAt: new Date(),
      },
    });
  } else if (!user.twoFactorEnabled) {
    throw new ApiError(
      409,
      "UNPROCESSABLE",
      "Two-factor authentication is not configured for this account.",
    );
  }

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    status: "ok" as const,
  };
}

export async function listUserMemberships(userId: string) {
  const prisma = getPrismaClient();
  const memberships = await prisma.membership.findMany({
    where: {
      userId,
    },
    orderBy: [
      {
        status: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    select: {
      tenantId: true,
      role: true,
      status: true,
      tenant: {
        select: {
          name: true,
          slug: true,
          defaultLocale: true,
        },
      },
    },
  });

  return memberships.map((membership) => ({
    tenantId: membership.tenantId,
    role: toApiRole(membership.role),
    status: toApiMembershipStatus(membership.status),
    tenantName: membership.tenant.name,
    tenantSlug: membership.tenant.slug,
    defaultLocale: membership.tenant.defaultLocale.toLowerCase(),
  }));
}

export async function createTenantForUser(
  userId: string,
  name: string,
  defaultLocale: LocaleCode,
) {
  const prisma = getPrismaClient();
  const slug = await createUniqueTenantSlug(name);
  const tenant = await prisma.$transaction(async (tx) => {
    const createdTenant = await tx.tenant.create({
      data: {
        name,
        slug,
        defaultLocale,
      },
      select: {
        id: true,
      },
    });

    await tx.membership.create({
      data: {
        tenantId: createdTenant.id,
        userId,
        role: MembershipRole.OWNER,
        status: MembershipStatus.ACTIVE,
      },
    });

    return createdTenant;
  });

  return {
    tenantId: tenant.id,
  };
}
