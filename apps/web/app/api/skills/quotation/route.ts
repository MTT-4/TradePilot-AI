import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { buildQuotationDraft } from "@/server/quotation/service";

const requestSchema = z.object({
  inquiryId: z.string().min(1).optional(),
  product: z.string().optional(),
  quantity: z.string().optional(),
  baseUnitCost: z.number().positive().optional(),
  incoterm: z.enum(["FOB", "CIF", "EXW"]).optional(),
  currency: z.string().min(1).max(8).optional(),
  marginPercent: z.number().min(0).max(500).optional(),
});

export const POST = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return Response.json(
        {
          error: { code: "UNAUTHENTICATED", message: "Login required.", details: {} },
        },
        { status: 401 },
      );
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.SALES,
    );
    const input = await parseJsonBody(request, requestSchema);
    const result = await buildQuotationDraft({
      tenantContext: context,
      userId,
      input,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
