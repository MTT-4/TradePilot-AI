"use client";

export type Membership = {
  tenantId: string;
  role: string;
  status: string;
  tenantName: string;
  tenantSlug: string;
  defaultLocale: string;
};

export type MeResponse = {
  user: {
    id: string;
    email: string;
    name: string;
    twoFactorEnabled: boolean;
  };
  memberships: Membership[];
  currentTenant: Membership | null;
};

export class LoginRequiredError extends Error {
  constructor() {
    super("请先登录并完成 2FA。");
    this.name = "LoginRequiredError";
  }
}

export async function fetchCurrentMe() {
  const response = await fetch("/api/me");

  if (response.status === 401) {
    throw new LoginRequiredError();
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载用户失败。");
  }

  return (await response.json()) as MeResponse;
}

export function buildLoginHref(nextPath?: string) {
  const params = new URLSearchParams();
  const normalizedNext =
    nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : null;

  if (normalizedNext && normalizedNext !== "/login") {
    params.set("next", normalizedNext);
  }

  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

export function redirectToLogin(nextPath?: string) {
  if (typeof window === "undefined") {
    return;
  }

  const fallbackNext = `${window.location.pathname}${window.location.search}`;
  window.location.assign(buildLoginHref(nextPath ?? fallbackNext));
}
