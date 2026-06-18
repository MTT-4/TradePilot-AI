import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { ApiError, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import {
  createKnowledgeDocumentFromUpload,
  createKnowledgeDocumentFromUrl,
  listKnowledgeDocuments,
} from "@/server/kb/service";

const createUrlDocumentSchema = z.object({
  sourceType: z.literal("url"),
  url: z.string().url(),
  sensitivity: z.string().optional(),
  locale: z.string().optional(),
  title: z.string().trim().min(1).max(240).optional(),
  product: z.string().trim().min(1).max(120).optional(),
  market: z.string().trim().min(1).max(120).optional(),
  sourceLabel: z.string().trim().min(1).max(240).optional(),
});

function getOptionalFormValue(
  formData: FormData,
  key: string,
): string | undefined {
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

    return Response.json(await listKnowledgeDocuments(context));
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
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const input = await parseJsonBody(request, createUrlDocumentSchema);
      const result = await createKnowledgeDocumentFromUrl({
        tenantContext: context,
        uploadedByUserId: userId,
        url: input.url,
        sensitivity: input.sensitivity,
        locale: input.locale,
        title: input.title,
        product: input.product,
        market: input.market,
        sourceLabel: input.sourceLabel,
      });

      return Response.json(result, { status: 202 });
    }

    const formData = await request.formData();
    const fileValue = formData.get("file");
    const urlValue = getOptionalFormValue(formData, "url");

    if (fileValue instanceof File) {
      const result = await createKnowledgeDocumentFromUpload({
        tenantContext: context,
        uploadedByUserId: userId,
        file: fileValue,
        sensitivity: getOptionalFormValue(formData, "sensitivity"),
        locale: getOptionalFormValue(formData, "locale"),
        title: getOptionalFormValue(formData, "title"),
        product: getOptionalFormValue(formData, "product"),
        market: getOptionalFormValue(formData, "market"),
        sourceLabel: getOptionalFormValue(formData, "sourceLabel"),
      });

      return Response.json(result, { status: 202 });
    }

    if (urlValue) {
      const result = await createKnowledgeDocumentFromUrl({
        tenantContext: context,
        uploadedByUserId: userId,
        url: urlValue,
        sensitivity: getOptionalFormValue(formData, "sensitivity"),
        locale: getOptionalFormValue(formData, "locale"),
        title: getOptionalFormValue(formData, "title"),
        product: getOptionalFormValue(formData, "product"),
        market: getOptionalFormValue(formData, "market"),
        sourceLabel: getOptionalFormValue(formData, "sourceLabel"),
      });

      return Response.json(result, { status: 202 });
    }

    throw new ApiError(
      400,
      "VALIDATION",
      "Request must include either a file upload or a source URL.",
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
