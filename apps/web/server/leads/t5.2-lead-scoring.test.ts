import { beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/server/db/prisma";
import { ingestInboundEmail } from "@/server/inbound-email/service";
import { submitPublicLeadForm } from "@/server/leads/service";

const prisma = getPrismaClient();

let tenantSlug = "";

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "shenghai-machinery",
    },
    select: {
      slug: true,
    },
  });

  if (!tenant) {
    throw new Error(
      "Seed data missing. Run `npm run prisma:seed` before T5.2 scoring tests.",
    );
  }

  tenantSlug = tenant.slug;
});

describe("T5.2 lead scoring", () => {
  it("scores a detailed high-intent form lead as A with an explainable reason", async () => {
    const email = `score-a-${Date.now()}@example.com`;
    const result = await submitPublicLeadForm({
      input: {
        tenantSlug,
        fields: {
          companyName: "Desert Flow Equipment",
          name: "Yousef Khalid",
          email,
          phone: "+971501234567",
          country: "UAE",
          subject: "Need TS-75 distributor quotation",
          message:
            "We need distributor pricing, MOQ, CIF Dubai delivery, and monthly volume support for 20 units per month.",
        },
      },
      idempotencyKey: `score-a-${Date.now()}`,
    });
    const lead = await prisma.lead.findUniqueOrThrow({
      where: {
        id: result.leadId,
      },
      select: {
        score: true,
        scoreReason: true,
      },
    });

    expect(lead.score).toBe("A");
    expect(lead.scoreReason).toContain("priority country");
    expect(lead.scoreReason).toContain("phone or WhatsApp");
    expect(lead.scoreReason).toContain("volume");
  });

  it("keeps a vague inbound email lead in the lower score bands with a reason", async () => {
    const email = `score-c-${Date.now()}@example.com`;
    const result = await ingestInboundEmail({
      input: {
        tenantSlug,
        provider: "resend",
        externalMessageId: `score-c-${Date.now()}`,
        fromEmail: email,
        fromName: "Low Intent Buyer",
        subject: "hello",
        body: "Please send catalog.",
      },
      idempotencyKey: `score-c-${Date.now()}`,
    });
    const lead = await prisma.lead.findUniqueOrThrow({
      where: {
        id: String(result.leadId),
      },
      select: {
        score: true,
        scoreReason: true,
      },
    });

    expect(["B", "C"]).toContain(String(lead.score));
    expect(lead.scoreReason).toBeTruthy();
  });
});
