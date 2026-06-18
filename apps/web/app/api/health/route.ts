import { NextResponse } from "next/server";
import { getHealthStatus } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getHealthStatus();

  return NextResponse.json(payload, {
    status: payload.status === "ok" ? 200 : 503,
  });
}
