import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { ApiError, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import {
  generateContentItemImageAssets,
  storeContentItemReferenceImage,
} from "@/server/content-packs/service";

const requestSchema = z.object({
  mode: z
    .enum(["text_to_image", "image_to_image", "background_swap"])
    .default("text_to_image"),
  backgroundStyle: z.string().trim().min(1).max(120).optional(),
  referenceLabel: z.string().trim().min(1).max(120).optional(),
});

export const POST = auth(async (request, routeContext) => {
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
    let input: z.infer<typeof requestSchema> = {
      mode: "text_to_image",
    };
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const fileValue = formData.get("referenceFile");
      const storedReference =
        fileValue instanceof File
          ? await storeContentItemReferenceImage({
              tenantContext: context,
              uploadedByUserId: userId,
              file: fileValue,
            })
          : null;

      input = requestSchema.parse({
        mode: typeof formData.get("mode") === "string" ? formData.get("mode") : undefined,
        backgroundStyle:
          typeof formData.get("backgroundStyle") === "string"
            ? formData.get("backgroundStyle")
            : undefined,
        referenceLabel:
          typeof formData.get("referenceLabel") === "string"
            ? formData.get("referenceLabel")
            : undefined,
        referenceFileId: storedReference?.id,
      });
    } else {
      const rawBody = await request.text();
      input = requestSchema.parse(rawBody ? JSON.parse(rawBody) : {});
    }
    const params = await routeContext.params;

    return Response.json(
      await generateContentItemImageAssets({
        tenantContext: context,
        itemId: params.id,
        requestedByUserId: userId,
        input,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
