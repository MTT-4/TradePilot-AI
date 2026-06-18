import { LocaleCode } from "@prisma/client";
import { auth } from "@/auth";
import {
  errorJson,
  parseJsonBody,
  routeErrorToResponse,
} from "@/server/api/errors";
import { createTenantForUser } from "@/server/auth/service";
import { z } from "zod";

const createTenantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  defaultLocale: z
    .enum(["en", "ar", "ru", "fr", "de", "pt", "zh"])
    .transform((value) => value.toUpperCase() as LocaleCode),
});

export const POST = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    const input = await parseJsonBody(request, createTenantSchema);
    const result = await createTenantForUser(
      userId,
      input.name,
      input.defaultLocale,
    );

    return Response.json(result, { status: 201 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
