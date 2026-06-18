import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { beginLogin } from "@/server/auth/service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(request, loginSchema);
    const result = await beginLogin(input);

    return NextResponse.json(result);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
