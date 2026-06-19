import { beforeAll, describe, expect, it } from "vitest";
import { POST as inboundEmailWebhookPOST } from "@/app/api/webhooks/inbound-email/route";
import { getPrismaClient } from "@/server/db/prisma";
import { signInboundEmailWebhookPayload } from "@/server/inbound-email/signature";

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
      "Seed data missing. Run `npm run prisma:seed` before T4.2 inbound email tests.",
    );
  }

  tenantSlug = tenant.slug;
});

describe("T4.2 inbound email webhook", () => {
  it("deduplicates webhook retries and creates only one inbound_email and lead", async () => {
    const fromEmail = `inbound-${Date.now()}@example.com`;
    const payload = JSON.stringify({
      tenantSlug,
      provider: "resend",
      externalMessageId: `msg-${Date.now()}`,
      fromEmail,
      fromName: "Mariam Noor",
      subject: "Need distributor quotation",
      body: "Please share MOQ, lead time, and EXW pricing for TS-75.",
    });
    const headers = {
      "content-type": "application/json",
      "x-webhook-signature": signInboundEmailWebhookPayload(payload),
      "idempotency-key": `email-${Date.now()}`,
    };

    const first = await inboundEmailWebhookPOST(
      new Request("http://localhost:3100/api/webhooks/inbound-email", {
        method: "POST",
        headers,
        body: payload,
      }),
    );
    const second = await inboundEmailWebhookPOST(
      new Request("http://localhost:3100/api/webhooks/inbound-email", {
        method: "POST",
        headers,
        body: payload,
      }),
    );
    const firstPayload = await first.json();
    const secondPayload = await second.json();

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(firstPayload.reused).toBe(false);
    expect(secondPayload.reused).toBe(true);
    expect(secondPayload.inboundEmailId).toBe(firstPayload.inboundEmailId);
    expect(secondPayload.leadId).toBe(firstPayload.leadId);

    const inboundEmailCount = await prisma.inboundEmail.count({
      where: {
        tenant: {
          slug: tenantSlug,
        },
        fromEmail,
        subject: "Need distributor quotation",
      },
    });
    const leadCount = await prisma.lead.count({
      where: {
        tenant: {
          slug: tenantSlug,
        },
        contact: {
          email: fromEmail,
        },
      },
    });
    const inquiryCount = await prisma.inquiry.count({
      where: {
        tenant: {
          slug: tenantSlug,
        },
        fromEmail,
        sourceType: "EMAIL",
      },
    });

    expect(inboundEmailCount).toBe(1);
    expect(leadCount).toBe(1);
    expect(inquiryCount).toBe(1);
  });

  it("reuses an existing lead for the same sender email", async () => {
    const fromEmail = `merge-${Date.now()}@example.com`;
    const formLead = await prisma.contact.create({
      data: {
        tenant: {
          connect: {
            slug: tenantSlug,
          },
        },
        email: fromEmail,
        name: "Existing Buyer",
      },
      select: {
        id: true,
        tenantId: true,
      },
    });
    const existingLead = await prisma.lead.create({
      data: {
        tenantId: formLead.tenantId,
        contactId: formLead.id,
        status: "NEW",
        preferredLocale: "EN",
      },
      select: {
        id: true,
      },
    });
    const payload = JSON.stringify({
      tenantSlug,
      provider: "resend",
      externalMessageId: `merge-${Date.now()}`,
      fromEmail,
      fromName: "Existing Buyer",
      subject: "Follow-up on previous quote",
      body: "Can you confirm June production slot and CIF Jebel Ali pricing?",
    });

    const response = await inboundEmailWebhookPOST(
      new Request("http://localhost:3100/api/webhooks/inbound-email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": signInboundEmailWebhookPayload(payload),
        },
        body: payload,
      }),
    );
    const responsePayload = await response.json();

    expect(response.status).toBe(202);
    expect(responsePayload.leadId).toBe(existingLead.id);

    const inboundEmail = await prisma.inboundEmail.findUniqueOrThrow({
      where: {
        id: responsePayload.inboundEmailId,
      },
      select: {
        leadId: true,
        status: true,
      },
    });

    expect(inboundEmail).toMatchObject({
      leadId: existingLead.id,
      status: "PROCESSED",
    });
  });

  it("marks spam inbound email and keeps it out of the lead pool", async () => {
    const fromEmail = `spam-${Date.now()}@example.com`;
    const payload = JSON.stringify({
      tenantSlug,
      provider: "resend",
      externalMessageId: `spam-${Date.now()}`,
      fromEmail,
      fromName: "Spam Sender",
      subject: "Free bitcoin SEO service",
      body: "Buy crypto investment traffic now. https://spam-a.test https://spam-b.test https://spam-c.test https://spam-d.test",
    });

    const response = await inboundEmailWebhookPOST(
      new Request("http://localhost:3100/api/webhooks/inbound-email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": signInboundEmailWebhookPayload(payload),
          "idempotency-key": `spam-${Date.now()}`,
        },
        body: payload,
      }),
    );
    const responsePayload = await response.json();

    expect(response.status).toBe(202);
    expect(responsePayload.status).toBe("spam");
    expect(responsePayload.leadId).toBeNull();

    const leadCount = await prisma.lead.count({
      where: {
        tenant: {
          slug: tenantSlug,
        },
        contact: {
          email: fromEmail,
        },
      },
    });
    const inquiryCount = await prisma.inquiry.count({
      where: {
        tenant: {
          slug: tenantSlug,
        },
        fromEmail,
      },
    });

    expect(leadCount).toBe(0);
    expect(inquiryCount).toBe(0);
  });
});
