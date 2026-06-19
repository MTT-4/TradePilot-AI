import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { ApiError, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { getPrismaClient } from "@/server/db/prisma";
import { getTenantObjectBuffer } from "@/server/storage/object-store";

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
    const prisma = getPrismaClient();
    const file = await prisma.file.findFirst({
      where: {
        id: params.id,
        tenantId: context.tenantId,
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        objectKey: true,
      },
    });

    if (!file) {
      throw new ApiError(404, "NOT_FOUND", "File not found.");
    }

    const body = await getTenantObjectBuffer({
      tenantId: context.tenantId,
      objectKey: file.objectKey,
    });
    const disposition = new URL(request.url).searchParams.get("download")
      ? `attachment; filename=\"${file.originalName}\"`
      : `inline; filename=\"${file.originalName}\"`;

    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": file.mimeType,
        "content-disposition": disposition,
        "cache-control": "private, max-age=60",
      },
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
