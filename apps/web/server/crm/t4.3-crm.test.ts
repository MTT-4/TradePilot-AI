import { beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import { createTrackingLink } from "@/server/tracking/service";
import { ingestInboundEmail } from "@/server/inbound-email/service";
import { submitPublicLeadForm } from "@/server/leads/service";
import {
  createCrmActivity,
  getCrmLeadDetail,
  listCrmActivities,
  listCrmInquiries,
  listCrmLeads,
  listCrmOpportunities,
  updateCrmLead,
  updateOpportunityStage,
} from "@/server/crm/service";

const prisma = getPrismaClient();

let ownerContext: TenantContext;
let salesContext: TenantContext;
let contentPackId = "";

beforeAll(async () => {
  const [ownerMembership, salesMembership, contentPack] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        tenant: {
          slug: "shenghai-machinery",
        },
        user: {
          email: "owner-a@tradepilot.local",
        },
        status: "ACTIVE",
      },
      select: {
        tenantId: true,
        userId: true,
        role: true,
      },
    }),
    prisma.membership.findFirst({
      where: {
        tenant: {
          slug: "shenghai-machinery",
        },
        user: {
          email: "sales-a@tradepilot.local",
        },
        status: "ACTIVE",
      },
      select: {
        tenantId: true,
        userId: true,
        role: true,
      },
    }),
    prisma.contentPack.findFirst({
      where: {
        tenant: {
          slug: "shenghai-machinery",
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
      },
    }),
  ]);

  if (!ownerMembership || !salesMembership || !contentPack) {
    throw new Error(
      "Seed data missing. Run `npm run prisma:seed` before T4.3 CRM tests.",
    );
  }

  ownerContext = ownerMembership;
  salesContext = salesMembership;
  contentPackId = contentPack.id;
});

describe("T4.3 CRM service", () => {
  it("supports form + email dedupe into one lead and surfaces source attribution in the lead pool", async () => {
    const email = `crm-${Date.now()}@example.com`;
    const contentItem = await prisma.contentItem.create({
      data: {
        tenantId: ownerContext.tenantId,
        contentPackId,
        ownerUserId: ownerContext.userId,
        platform: "LINKEDIN",
        locale: "EN",
        mediaType: "IMAGE",
        title: `CRM attribution ${Date.now()}`,
        body: "CRM attribution body",
        spec: {
          ratio: "1.91:1",
        },
        publishStatus: "PENDING",
      },
      select: {
        id: true,
      },
    });
    const trackingLink = await createTrackingLink(ownerContext, {
      contentItemId: contentItem.id,
      targetUrl: "https://example.com/crm",
      utmCampaign: `crm-${Date.now()}`,
      utmContent: "lead-pool",
    });
    const formResult = await submitPublicLeadForm({
      input: {
        tenantSlug: "shenghai-machinery",
        trackingSlug: trackingLink.slug,
        fields: {
          companyName: "Al Sama Trading",
          name: "Karim Hasan",
          email,
          phone: "+971501112233",
          subject: "Need distributor terms",
          message: "Please share distributor policy and factory lead time.",
        },
      },
      idempotencyKey: `form-${Date.now()}`,
    });

    const emailResult = await ingestInboundEmail({
      input: {
        tenantSlug: "shenghai-machinery",
        provider: "resend",
        externalMessageId: `crm-msg-${Date.now()}`,
        fromEmail: email,
        fromName: "Karim Hasan",
        subject: "Follow-up on distributor terms",
        body: "Also include CIF Dubai pricing and annual volume discount.",
      },
      idempotencyKey: `email-${Date.now()}`,
    });

    expect(emailResult.leadId).toBe(formResult.leadId);

    const assigned = await updateCrmLead({
      tenantContext: ownerContext,
      leadId: formResult.leadId,
      input: {
        ownerUserId: salesContext.userId,
        status: "contacted",
        followUpDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    expect(assigned.lead.ownerUserId).toBe(salesContext.userId);
    expect(assigned.lead.status).toBe("contacted");

    const salesList = await listCrmLeads({
      tenantContext: salesContext,
      filters: {
        status: "contacted",
      },
    });
    const targetLead = salesList.items.find((item) => item.id === formResult.leadId);

    expect(targetLead).toBeTruthy();
    expect(targetLead?.sourceAttribution.trackingLinkId).toBe(trackingLink.id);
    expect(targetLead?.sourceAttribution.contentItemId).toBe(contentItem.id);
    expect(targetLead?.sourceAttribution.platform).toBe("linkedin");
    expect(targetLead?.inquiryCount).toBeGreaterThanOrEqual(2);

    const detail = await getCrmLeadDetail({
      tenantContext: salesContext,
      leadId: formResult.leadId,
    });

    expect(detail.lead.inquiries.some((item) => item.sourceType === "form")).toBe(true);
    expect(detail.lead.inquiries.some((item) => item.sourceType === "email")).toBe(true);

    const inquiries = await listCrmInquiries({
      tenantContext: salesContext,
      filters: {
        leadId: formResult.leadId,
      },
    });

    expect(inquiries.items.length).toBeGreaterThanOrEqual(2);
    expect(inquiries.items.some((item) => item.sourceType === "form")).toBe(true);
    expect(inquiries.items.some((item) => item.sourceType === "email")).toBe(true);
  });

  it("returns 403 when sales tries to access another user's lead", async () => {
    const contact = await prisma.contact.create({
      data: {
        tenantId: ownerContext.tenantId,
        name: "Owner Lead Contact",
        email: `owner-lead-${Date.now()}@example.com`,
      },
      select: {
        id: true,
      },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId: ownerContext.tenantId,
        contactId: contact.id,
        ownerUserId: ownerContext.userId,
        status: "NEW",
        preferredLocale: "EN",
      },
      select: {
        id: true,
      },
    });

    await expect(
      getCrmLeadDetail({
        tenantContext: salesContext,
        leadId: lead.id,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("updates opportunity stage and writes crm activity", async () => {
    const contact = await prisma.contact.create({
      data: {
        tenantId: ownerContext.tenantId,
        name: "Opportunity Contact",
        email: `opportunity-${Date.now()}@example.com`,
      },
      select: {
        id: true,
      },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId: ownerContext.tenantId,
        contactId: contact.id,
        ownerUserId: salesContext.userId,
        status: "CONTACTED",
        preferredLocale: "EN",
      },
      select: {
        id: true,
      },
    });
    const opportunity = await prisma.opportunity.create({
      data: {
        tenantId: ownerContext.tenantId,
        leadId: lead.id,
        ownerUserId: salesContext.userId,
        name: "TS-75 UAE Distributor Deal",
        stage: "NEW",
        currency: "USD",
      },
      select: {
        id: true,
      },
    });

    const updated = await updateOpportunityStage({
      tenantContext: salesContext,
      opportunityId: opportunity.id,
      input: {
        stage: "quoted",
      },
    });

    expect(updated.opportunity.stage).toBe("quoted");

    const stageChange = await prisma.crmActivity.findFirstOrThrow({
      where: {
        tenantId: ownerContext.tenantId,
        opportunityId: opportunity.id,
        type: "STAGE_CHANGE",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        type: true,
        body: true,
      },
    });

    expect(stageChange.body).toContain("new to quoted");

    const note = await createCrmActivity({
      tenantContext: salesContext,
      input: {
        leadId: lead.id,
        opportunityId: opportunity.id,
        type: "note",
        body: "Customer requested updated CIF quotation for June shipment.",
      },
    });

    expect(note.activity.type).toBe("note");

    const activities = await listCrmActivities({
      tenantContext: salesContext,
      filters: {
        leadId: lead.id,
      },
    });

    expect(activities.items.some((item) => item.type === "stage_change")).toBe(true);
    expect(activities.items.some((item) => item.type === "note")).toBe(true);

    const opportunities = await listCrmOpportunities({
      tenantContext: salesContext,
      filters: {
        stage: "quoted",
      },
    });

    expect(opportunities.items.some((item) => item.id === opportunity.id)).toBe(true);
  });
});
