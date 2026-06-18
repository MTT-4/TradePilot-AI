import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { registerUser } from "@/server/auth/service";

const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(10)
    .regex(/[A-Za-z]/, "Password must contain letters.")
    .regex(/\d/, "Password must contain numbers."),
  name: z.string().trim().min(1).max(80),
});

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(request, registerSchema);
    const result = await registerUser(input);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
