import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { establishUserSession } from "@/server/auth/session";
import { verifyTwoFactorCode } from "@/server/auth/service";

const verifySchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().trim().regex(/^\d{6}$/),
});

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(request, verifySchema);
    const result = await verifyTwoFactorCode(input);

    await establishUserSession(result.userId, result.email);

    return NextResponse.json({ status: result.status });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
