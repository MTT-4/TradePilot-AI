import { NextResponse } from "next/server";
import { isTenantContextError } from "@/server/db/errors";
import { resolveTenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const tenantContext = await resolveTenantContext(request.headers);
    const prisma = getTenantPrisma(tenantContext);
    const leadId = new URL(request.url).searchParams.get("leadId");

    if (leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: leadId },
        select: {
          id: true,
          companyName: true,
          status: true,
          score: true,
        },
      });

      if (!lead) {
        return NextResponse.json(
          {
            error: {
              code: "NOT_FOUND",
              message: "Lead not found.",
              details: {},
            },
          },
          { status: 404 },
        );
      }

      return NextResponse.json({ lead });
    }

    const leads = await prisma.lead.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        companyName: true,
        status: true,
        score: true,
      },
    });

    return NextResponse.json({ items: leads });
  } catch (error) {
    if (isTenantContextError(error)) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            details: {},
          },
        },
        { status: error.status },
      );
    }

    throw error;
  }
}
