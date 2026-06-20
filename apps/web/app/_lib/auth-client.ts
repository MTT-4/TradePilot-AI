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

const PREFERRED_TENANT_KEY = "tp.tenantId";

export function getPreferredTenantId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(PREFERRED_TENANT_KEY);
  } catch {
    return null;
  }
}

export function setPreferredTenantId(tenantId: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(PREFERRED_TENANT_KEY, tenantId);
  } catch {
    // localStorage 不可用时忽略，回退到服务端默认租户
  }
}

export async function fetchCurrentMe() {
  const preferred = getPreferredTenantId();
  const response = await fetch("/api/me", {
    headers: preferred ? { "X-Tenant-Id": preferred } : undefined,
  });

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
