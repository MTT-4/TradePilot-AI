import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import {
  emailTemplatesSchema,
  getEmailTemplates,
  updateEmailTemplates,
} from "@/server/templates/service";

function unauthenticated() {
  return Response.json(
    { error: { code: "UNAUTHENTICATED", message: "Login required.", details: {} } },
    { status: 401 },
  );
}

// 读取邮件模板（SALES 及以上）。
export const GET = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;
    if (!userId) return unauthenticated();

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.SALES,
    );
    const templates = await getEmailTemplates(context);
    return Response.json(templates, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});

// 更新邮件模板（ADMIN 及以上，写审计）。
export const PUT = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;
    if (!userId) return unauthenticated();

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );
    const input = await parseJsonBody(request, emailTemplatesSchema);
    const templates = await updateEmailTemplates({
      tenantContext: context,
      actorUserId: userId,
      input,
    });
    return Response.json(templates, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
