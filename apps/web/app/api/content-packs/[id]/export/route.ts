import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { ApiError, routeErrorToResponse } from "@/server/api/errors";
import { exportContentPack } from "@/server/content-packs/service";
import { requireTenantAccess } from "@/server/auth/access";

export const GET = auth(async (request, routeContext) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Login required.");
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.VIEWER,
    );
    const params = await routeContext.params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("fmt") ?? "csv";
    const exported = await exportContentPack({
      tenantContext: context,
      packId: params.id,
      format: format as "csv" | "md" | "zip",
    });

    return new Response(exported.body, {
      status: 200,
      headers: {
        "Content-Type": exported.contentType,
        "Content-Disposition": `attachment; filename=\"${exported.fileName}\"`,
      },
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
