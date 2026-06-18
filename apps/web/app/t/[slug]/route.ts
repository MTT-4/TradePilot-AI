import {
  getVisitorIp,
  recordClickEvent,
} from "@/server/tracking/service";
import { ApiError, routeErrorToResponse } from "@/server/api/errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;

    if (!slug) {
      throw new ApiError(404, "NOT_FOUND", "Tracking link not found.");
    }

    const url = new URL(request.url);
    const result = await recordClickEvent({
      slug,
      visitorIp: getVisitorIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      referer: request.headers.get("referer"),
      queryString: url.search ? url.search.slice(1) : null,
    });

    return Response.redirect(result.tracking.resolvedUrl, 302);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
