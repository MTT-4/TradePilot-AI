import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { ApiError, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import {
  inferPromotionCountry,
  recommendPromotionTiming,
  suggestNextPromotionTime,
} from "@/server/scheduling/promotion-timing";
import { getPromotionHolidaySettings } from "@/server/settings/service";

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

    const url = new URL(request.url);
    const countryParam = url.searchParams.get("country")?.trim() ?? "";
    const marketParam = url.searchParams.get("market")?.trim() ?? "";
    const inferredCountry = countryParam || inferPromotionCountry(marketParam) || "";

    if (!inferredCountry) {
      throw new ApiError(
        400,
        "VALIDATION",
        "country or market query parameter is required.",
      );
    }

    const holidaySettings = await getPromotionHolidaySettings(context);
    const timing = recommendPromotionTiming({
      country: inferredCountry,
      holidays: holidaySettings.items,
    });
    const nextRecommended = suggestNextPromotionTime({
      country: inferredCountry,
    });

    return Response.json({
      ...timing,
      inferredCountry,
      nextRecommendedAt: nextRecommended?.plannedAt.toISOString() ?? null,
      nextRecommendedWindow: nextRecommended?.windowLabel ?? null,
      nextRecommendedReason: nextRecommended?.reason ?? null,
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
