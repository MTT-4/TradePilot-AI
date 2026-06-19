import { ApiError, routeErrorToResponse } from "@/server/api/errors";
import { ingestInboundEmail } from "@/server/inbound-email/service";
import { verifyInboundEmailWebhookSignature } from "@/server/inbound-email/signature";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    let payload: unknown;

    verifyInboundEmailWebhookSignature(
      rawBody,
      request.headers.get("x-webhook-signature"),
    );

    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new ApiError(400, "VALIDATION", "Request body must be valid JSON.");
    }

    const result = await ingestInboundEmail({
      input: payload,
      idempotencyKey: request.headers.get("idempotency-key"),
    });

    return Response.json(result, { status: 202 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
