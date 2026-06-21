import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";

/**
 * 新增 skill/tool 共享的 owner-scope 校验（与 replies/crm 现有逻辑一致）。
 * SALES 只能访问自己负责的线索；OWNER/ADMIN/OPERATOR/VIEWER 不受此限。
 * 用于在入口处对已加载的 lead.ownerUserId 做归属校验，避免同租户内越权。
 */
export function assertLeadOwnerScope(
  tenantContext: TenantContext,
  ownerUserId: string | null | undefined,
): void {
  if (
    tenantContext.role === "SALES" &&
    ownerUserId !== tenantContext.userId
  ) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Sales users can only access their own leads.",
    );
  }
}

/** 把 route 传入的 limit 规整为有效正整数；非法/缺省时回退到 fallback，并夹在 [1, max]。 */
export function normalizeLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  const n =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, 1), max);
}

/** 解析 route query 里的正整数参数；缺省返回 undefined，非法时抛 400。 */
export function parsePositiveIntegerParam(
  value: string | null,
  fieldName: string,
): number | undefined {
  if (value == null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(
      400,
      "VALIDATION",
      `${fieldName} must be a positive integer.`,
    );
  }

  return parsed;
}
