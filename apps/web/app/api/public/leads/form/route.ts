import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { publicLeadFormSchema, submitPublicLeadForm } from "@/server/leads/service";
import { consumePublicLeadRateLimit } from "@/server/leads/rate-limit";
import { getVisitorIp } from "@/server/tracking/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    consumePublicLeadRateLimit({
      ip: getVisitorIp(request.headers),
    });

    const input = await parseJsonBody(request, publicLeadFormSchema);
    const result = await submitPublicLeadForm({
      input,
      idempotencyKey: request.headers.get("idempotency-key"),
    });

    return Response.json(
      {
        leadId: result.leadId,
        inquiryId: result.inquiryId,
        reused: result.reused,
      },
      { status: 201 },
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
