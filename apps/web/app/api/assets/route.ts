import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { ApiError, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import {
  createContentAsset,
  listContentAssets,
} from "@/server/assets/service";

function getOptionalFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export const GET = auth(async (request) => {
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
    const limitParam = new URL(request.url).searchParams.get("limit");
    const limit =
      limitParam && Number.isFinite(Number(limitParam))
        ? Number(limitParam)
        : undefined;

    return Response.json(
      await listContentAssets({
        tenantContext: context,
        limit,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});

export const POST = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Login required.");
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.OPERATOR,
    );
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new ApiError(400, "VALIDATION", "Request must include a file.");
    }

    return Response.json(
      await createContentAsset({
        tenantContext: context,
        createdByUserId: userId,
        file,
        kind: getOptionalFormValue(formData, "kind"),
      }),
      { status: 201 },
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
