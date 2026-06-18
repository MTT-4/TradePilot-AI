import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { auth } from "@/auth";
import {
  createTrackingLink,
  resolveTrackingAttributionBySlug,
} from "@/server/tracking/service";

const createTrackingLinkSchema = z.object({
  contentItemId: z.string().min(1),
  campaignId: z.string().min(1).optional(),
  targetUrl: z.string().url(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmContent: z.string().optional().nullable(),
  botFilterEnabled: z.boolean().optional(),
});

export const GET = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return Response.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Login required.",
            details: {},
          },
        },
        { status: 401 },
      );
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.VIEWER,
    );
    const slug = new URL(request.url).searchParams.get("slug");

    if (!slug) {
      return Response.json(
        {
          error: {
            code: "VALIDATION",
            message: "Missing slug query parameter.",
            details: {},
          },
        },
        { status: 400 },
      );
    }

    const attribution = await resolveTrackingAttributionBySlug(slug);

    if (attribution.tenantId !== context.tenantId) {
      return Response.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Tracking link not found.",
            details: {},
          },
        },
        { status: 404 },
      );
    }

    return Response.json({ attribution });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});

export const POST = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return Response.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Login required.",
            details: {},
          },
        },
        { status: 401 },
      );
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.OPERATOR,
    );
    const input = await parseJsonBody(request, createTrackingLinkSchema);
    const trackingLink = await createTrackingLink(context, input);

    return Response.json(trackingLink, { status: 201 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
