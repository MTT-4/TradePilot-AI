import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const platformRules = [
  { platform: "LINKEDIN", displayName: "LinkedIn" },
  { platform: "FACEBOOK", displayName: "Facebook" },
  { platform: "INSTAGRAM", displayName: "Instagram" },
  { platform: "REELS", displayName: "Reels" },
  { platform: "TIKTOK", displayName: "TikTok" },
  { platform: "YOUTUBE", displayName: "YouTube" },
  { platform: "SHORTS", displayName: "Shorts" },
  { platform: "VK_CLIPS", displayName: "VK Clips" },
  { platform: "RUTUBE", displayName: "RuTube" },
] as const;

async function main() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "data_requests",
      "notifications",
      "hitl_tasks",
      "replies",
      "crm_activities",
      "opportunities",
      "inquiries",
      "inbound_emails",
      "leads",
      "contacts",
      "click_events",
      "tracking_links",
      "content_items",
      "content_packs",
      "campaigns",
      "site_locales",
      "site_pages",
      "site_versions",
      "site_projects",
      "knowledge_qa_pairs",
      "knowledge_reviews",
      "knowledge_chunks",
      "knowledge_documents",
      "credit_ledger",
      "model_invocations",
      "audit_logs",
      "jobs",
      "files",
      "brand_kits",
      "memberships",
      "platform_rules",
      "users",
      "tenants"
    CASCADE
  `);

  for (const rule of platformRules) {
    await prisma.platformRule.create({
      data: {
        platform: rule.platform,
        displayName: rule.displayName,
        rules: {
          ratio: "platform-specific",
          hookWindow: "first 150 chars",
          localeAware: true,
        },
      },
    });
  }

  const [tenantA, tenantB] = await Promise.all([
    prisma.tenant.create({
      data: {
        name: "晟海机械",
        slug: "shenghai-machinery",
        defaultLocale: "EN",
      },
    }),
    prisma.tenant.create({
      data: {
        name: "对照公司",
        slug: "control-company",
        defaultLocale: "EN",
      },
    }),
  ]);

  const [
    ownerA,
    salesA,
    ownerB,
    salesB,
  ] = await Promise.all([
    prisma.user.create({
      data: {
        email: "owner-a@tradepilot.local",
        name: "Shenghai Owner",
        // Password: TradePilot@2026
        passwordHash: "$2b$12$F7x1tBI1hvqDIZMeffaAGeoo7AeYqmZrWzWJzpeXutvD66iXigAJu",
      },
    }),
    prisma.user.create({
      data: {
        email: "sales-a@tradepilot.local",
        name: "Shenghai Sales",
        // Password: TradePilot@2026
        passwordHash: "$2b$12$F7x1tBI1hvqDIZMeffaAGeoo7AeYqmZrWzWJzpeXutvD66iXigAJu",
      },
    }),
    prisma.user.create({
      data: {
        email: "owner-b@tradepilot.local",
        name: "Control Owner",
        // Password: TradePilot@2026
        passwordHash: "$2b$12$F7x1tBI1hvqDIZMeffaAGeoo7AeYqmZrWzWJzpeXutvD66iXigAJu",
      },
    }),
    prisma.user.create({
      data: {
        email: "sales-b@tradepilot.local",
        name: "Control Sales",
        // Password: TradePilot@2026
        passwordHash: "$2b$12$F7x1tBI1hvqDIZMeffaAGeoo7AeYqmZrWzWJzpeXutvD66iXigAJu",
      },
    }),
  ]);

  await prisma.membership.createMany({
    data: [
      { tenantId: tenantA.id, userId: ownerA.id, role: "OWNER", status: "ACTIVE" },
      { tenantId: tenantA.id, userId: salesA.id, role: "SALES", status: "ACTIVE" },
      { tenantId: tenantB.id, userId: ownerB.id, role: "OWNER", status: "ACTIVE" },
      { tenantId: tenantB.id, userId: salesB.id, role: "SALES", status: "ACTIVE" },
    ],
  });

  await prisma.brandKit.create({
    data: {
      tenantId: tenantA.id,
      createdByUserId: ownerA.id,
      name: "Shenghai Core Brand",
      companyName: "晟海机械",
      primaryColor: "#0C5C56",
      secondaryColor: "#E9F4F2",
      metadata: {
        tone: "industrial and precise",
      },
    },
  });

  const [manualFile, quoteFile, certFile] = await Promise.all([
    prisma.file.create({
      data: {
        tenantId: tenantA.id,
        uploadedByUserId: ownerA.id,
        sourceType: "UPLOAD",
        kind: "DOCUMENT",
        originalName: "air-compressor-manual.pdf",
        mimeType: "application/pdf",
        sizeBytes: 102400,
        bucket: "tradepilot-local",
        objectKey: "tenants/shenghai/documents/air-compressor-manual.pdf",
      },
    }),
    prisma.file.create({
      data: {
        tenantId: tenantA.id,
        uploadedByUserId: ownerA.id,
        sourceType: "UPLOAD",
        kind: "DOCUMENT",
        originalName: "quote-internal.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 51200,
        bucket: "tradepilot-local",
        objectKey: "tenants/shenghai/documents/quote-internal.xlsx",
      },
    }),
    prisma.file.create({
      data: {
        tenantId: tenantA.id,
        uploadedByUserId: ownerA.id,
        sourceType: "UPLOAD",
        kind: "DOCUMENT",
        originalName: "ce-certification.pdf",
        mimeType: "application/pdf",
        sizeBytes: 40960,
        bucket: "tradepilot-local",
        objectKey: "tenants/shenghai/documents/ce-certification.pdf",
      },
    }),
  ]);

  const publicDoc = await prisma.knowledgeDocument.create({
    data: {
      tenantId: tenantA.id,
      fileId: manualFile.id,
      uploadedByUserId: ownerA.id,
      title: "Air Compressor Product Manual",
      sourceType: "UPLOAD",
      status: "READY",
      sensitivity: "PUBLIC",
      locale: "EN",
      product: "Screw Air Compressor",
      market: "Middle East",
      sourceLabel: "Product manual",
    },
  });

  const internalDoc = await prisma.knowledgeDocument.create({
    data: {
      tenantId: tenantA.id,
      fileId: quoteFile.id,
      uploadedByUserId: ownerA.id,
      title: "Internal Quotation Sheet",
      sourceType: "UPLOAD",
      status: "READY",
      sensitivity: "INTERNAL_ONLY",
      locale: "EN",
      product: "Screw Air Compressor",
      market: "Middle East",
      sourceLabel: "Internal pricing",
    },
  });

  const certDoc = await prisma.knowledgeDocument.create({
    data: {
      tenantId: tenantA.id,
      fileId: certFile.id,
      uploadedByUserId: ownerA.id,
      title: "CE Certification",
      sourceType: "UPLOAD",
      status: "READY",
      sensitivity: "PUBLIC",
      locale: "EN",
      product: "Screw Air Compressor",
      market: "Middle East",
      sourceLabel: "Certification",
    },
  });

  const [publicChunk, internalChunk, certChunk] = await Promise.all([
    prisma.knowledgeChunk.create({
      data: {
        tenantId: tenantA.id,
        documentId: publicDoc.id,
        chunkIndex: 0,
        namespace: `tenant:${tenantA.id}`,
        text: "The TS-75 screw air compressor delivers 7.5 bar pressure with 18.5kW motor power and is suitable for continuous industrial duty.",
        sourceCitation: "Product manual p.2",
        locale: "EN",
        product: "Screw Air Compressor",
        market: "Middle East",
        sensitivity: "PUBLIC",
      },
    }),
    prisma.knowledgeChunk.create({
      data: {
        tenantId: tenantA.id,
        documentId: internalDoc.id,
        chunkIndex: 0,
        namespace: `tenant:${tenantA.id}`,
        text: "Distributor floor price for TS-75 is confidential and only available to approved resellers.",
        sourceCitation: "Quote sheet line 4",
        locale: "EN",
        product: "Screw Air Compressor",
        market: "Middle East",
        sensitivity: "INTERNAL_ONLY",
      },
    }),
    prisma.knowledgeChunk.create({
      data: {
        tenantId: tenantA.id,
        documentId: certDoc.id,
        chunkIndex: 0,
        namespace: `tenant:${tenantA.id}`,
        text: "CE conformity has been verified for TS series air compressors with export-ready documentation.",
        sourceCitation: "Certification p.1",
        locale: "EN",
        product: "Screw Air Compressor",
        market: "Middle East",
        sensitivity: "PUBLIC",
      },
    }),
  ]);

  await prisma.knowledgeReview.createMany({
    data: [
      {
        tenantId: tenantA.id,
        documentId: publicDoc.id,
        chunkId: publicChunk.id,
        reviewedByUserId: ownerA.id,
        question: "What pressure does the TS-75 support?",
        answer: "7.5 bar pressure for continuous industrial duty.",
        sourceCitation: "Product manual p.2",
        sensitivity: "PUBLIC",
        status: "APPROVED",
      },
      {
        tenantId: tenantA.id,
        documentId: internalDoc.id,
        chunkId: internalChunk.id,
        reviewedByUserId: ownerA.id,
        question: "Is pricing public?",
        answer: "No. Pricing is internal only.",
        sourceCitation: "Quote sheet line 4",
        sensitivity: "INTERNAL_ONLY",
        status: "APPROVED",
      },
    ],
  });

  await prisma.knowledgeQaPair.create({
    data: {
      tenantId: tenantA.id,
      documentId: certDoc.id,
      createdByUserId: ownerA.id,
      question: "Does the product have CE documentation?",
      answer: "Yes. CE documentation is available for export review.",
      sensitivity: "PUBLIC",
      status: "APPROVED",
    },
  });

  const siteProject = await prisma.siteProject.create({
    data: {
      tenantId: tenantA.id,
      createdByUserId: ownerA.id,
      name: "Middle East Landing Site",
      slug: "middle-east-air-compressor",
      market: "Middle East",
      product: "Screw Air Compressor",
      style: "industrial clean",
      cta: "Request distributor pricing",
      defaultLocale: "EN",
      status: "DRAFT",
    },
  });

  const siteVersion = await prisma.siteVersion.create({
    data: {
      tenantId: tenantA.id,
      siteProjectId: siteProject.id,
      createdByUserId: ownerA.id,
      versionNumber: 1,
      snapshot: {
        headline: "Industrial Air Compressor for Middle East Buyers",
      },
      note: "Initial generated draft",
    },
  });

  await prisma.siteProject.update({
    where: { id: siteProject.id },
    data: { currentVersionId: siteVersion.id },
  });

  await prisma.sitePage.create({
    data: {
      tenantId: tenantA.id,
      siteProjectId: siteProject.id,
      pageType: "landing",
      title: "Screw Air Compressor",
      slug: "home",
      isHomepage: true,
      content: {
        sections: ["hero", "faq", "specs", "form"],
      },
    },
  });

  await prisma.siteLocale.createMany({
    data: [
      {
        tenantId: tenantA.id,
        siteProjectId: siteProject.id,
        locale: "EN",
        direction: "LTR",
        urlPath: "/sites/middle-east-air-compressor/en",
        translatedContent: { headline: "Industrial Air Compressor" },
        seoTitle: "Industrial Air Compressor | TradePilot",
        seoDescription: "Export-ready air compressor landing page.",
        publishStatus: "PENDING",
      },
      {
        tenantId: tenantA.id,
        siteProjectId: siteProject.id,
        locale: "AR",
        direction: "RTL",
        urlPath: "/sites/middle-east-air-compressor/ar",
        translatedContent: { headline: "ضاغط هواء صناعي" },
        seoTitle: "ضاغط هواء صناعي",
        seoDescription: "صفحة هبوط متعددة اللغات.",
        publishStatus: "PENDING",
      },
      {
        tenantId: tenantA.id,
        siteProjectId: siteProject.id,
        locale: "RU",
        direction: "LTR",
        urlPath: "/sites/middle-east-air-compressor/ru",
        translatedContent: { headline: "Промышленный воздушный компрессор" },
        seoTitle: "Промышленный воздушный компрессор",
        seoDescription: "Многоязычный лендинг для экспорта.",
        publishStatus: "PENDING",
      },
    ],
  });

  const campaign = await prisma.campaign.create({
    data: {
      tenantId: tenantA.id,
      name: "Middle East Distributor Push",
      topic: "Oil-free reliability and service support",
      market: "Middle East",
      status: "ACTIVE",
      budgetUsd: "5000",
    },
  });

  const contentPack = await prisma.contentPack.create({
    data: {
      tenantId: tenantA.id,
      campaignId: campaign.id,
      createdByUserId: ownerA.id,
      title: "Week 1 Distributor Campaign",
      topic: "Distributor lead generation",
      market: "Middle East",
      locales: ["en", "ar", "ru"],
      status: "READY",
    },
  });

  const platformSequence = [
    "LINKEDIN",
    "FACEBOOK",
    "INSTAGRAM",
    "REELS",
    "TIKTOK",
    "YOUTUBE",
    "SHORTS",
    "VK_CLIPS",
    "RUTUBE",
  ] as const;

  for (const [index, platform] of platformSequence.entries()) {
    const item = await prisma.contentItem.create({
      data: {
        tenantId: tenantA.id,
        contentPackId: contentPack.id,
        ownerUserId: salesA.id,
        platform,
        locale: "EN",
        mediaType:
          platform === "REELS" ||
          platform === "TIKTOK" ||
          platform === "YOUTUBE" ||
          platform === "SHORTS" ||
          platform === "VK_CLIPS" ||
          platform === "RUTUBE"
            ? "VIDEO_SCRIPT"
            : "IMAGE",
        title: `${platform.toLowerCase()} distributor content`,
        body: `Content item ${index + 1} for ${platform}.`,
        spec: {
          ratio: platform === "LINKEDIN" ? "1.91:1" : "9:16",
          exportChecklist: true,
        },
        publishStatus: "PENDING",
        plannedAt: new Date(Date.now() + index * 3600_000),
      },
    });

    await prisma.trackingLink.create({
      data: {
        tenantId: tenantA.id,
        campaignId: campaign.id,
        contentItemId: item.id,
        platform,
        slug: `sh-${platform.toLowerCase()}-${index + 1}`,
        targetUrl: `https://tradepilot.local/${siteProject.slug}`,
        utmSource: platform.toLowerCase(),
        utmMedium: "social",
        utmCampaign: "middle-east-distributor-push",
        utmContent: `item-${index + 1}`,
      },
    });
  }

  const contactForm = await prisma.contact.create({
    data: {
      tenantId: tenantA.id,
      companyName: "Al Noor Industrial Supplies",
      name: "Omar Hassan",
      email: "omar@alnoor.example",
      phone: "+971500000001",
      country: "AE",
      preferredLocale: "EN",
    },
  });

  const contactEmail = await prisma.contact.create({
    data: {
      tenantId: tenantA.id,
      companyName: "Volga Equip",
      name: "Irina Petrova",
      email: "irina@volga.example",
      phone: "+79990000002",
      country: "RU",
      preferredLocale: "RU",
    },
  });

  const firstTrackingLink = await prisma.trackingLink.findFirstOrThrow({
    where: { tenantId: tenantA.id },
    orderBy: { createdAt: "asc" },
  });

  const firstContentItem = await prisma.contentItem.findFirstOrThrow({
    where: { tenantId: tenantA.id },
    orderBy: { createdAt: "asc" },
  });

  const leadForm = await prisma.lead.create({
    data: {
      tenantId: tenantA.id,
      contactId: contactForm.id,
      ownerUserId: salesA.id,
      campaignId: campaign.id,
      sourceContentItemId: firstContentItem.id,
      trackingLinkId: firstTrackingLink.id,
      companyName: "Al Noor Industrial Supplies",
      country: "AE",
      preferredLocale: "EN",
      status: "NEW",
      score: "A",
      scoreReason: "Buyer left phone number and stated monthly volume.",
      dedupeHash: "lead-form-001",
      followUpDueAt: new Date(Date.now() + 86_400_000),
      formPayload: {
        monthlyVolume: "10 units",
        message: "Need distributor pricing for UAE.",
      },
    },
  });

  const inquiryForm = await prisma.inquiry.create({
    data: {
      tenantId: tenantA.id,
      leadId: leadForm.id,
      sourceType: "FORM",
      subject: "Distributor pricing request",
      body: "Need distributor pricing for UAE and lead time confirmation.",
      fromEmail: "omar@alnoor.example",
      fromName: "Omar Hassan",
      rawPayload: {
        source: "landing-form",
      },
    },
  });

  const leadEmail = await prisma.lead.create({
    data: {
      tenantId: tenantA.id,
      contactId: contactEmail.id,
      ownerUserId: salesA.id,
      companyName: "Volga Equip",
      country: "RU",
      preferredLocale: "RU",
      status: "CONTACTED",
      score: "B",
      scoreReason: "Detailed technical questions but no phone number.",
      dedupeHash: "lead-email-001",
      followUpDueAt: new Date(Date.now() + 172_800_000),
    },
  });

  const inboundEmail = await prisma.inboundEmail.create({
    data: {
      tenantId: tenantA.id,
      leadId: leadEmail.id,
      provider: "mock-webhook",
      externalMessageId: "msg-001",
      idempotencyKey: "email-001",
      dedupeHash: "email-001",
      fromEmail: "irina@volga.example",
      fromName: "Irina Petrova",
      subject: "Need CE documents and service support",
      body: "Please share CE documents and service support details.",
      status: "PROCESSED",
    },
  });

  const inquiryEmail = await prisma.inquiry.create({
    data: {
      tenantId: tenantA.id,
      leadId: leadEmail.id,
      inboundEmailId: inboundEmail.id,
      sourceType: "EMAIL",
      subject: "Need CE documents and service support",
      body: "Please share CE documents and service support details.",
      fromEmail: "irina@volga.example",
      fromName: "Irina Petrova",
    },
  });

  await prisma.opportunity.createMany({
    data: [
      {
        tenantId: tenantA.id,
        leadId: leadForm.id,
        ownerUserId: salesA.id,
        name: "Al Noor UAE distributor deal",
        stage: "NEW",
        valueAmount: "18000",
        currency: "USD",
        followUpDueAt: new Date(Date.now() + 86_400_000),
      },
      {
        tenantId: tenantA.id,
        leadId: leadEmail.id,
        ownerUserId: salesA.id,
        name: "Volga CE documentation follow-up",
        stage: "CONTACTED",
        valueAmount: "9500",
        currency: "USD",
        followUpDueAt: new Date(Date.now() + 172_800_000),
      },
    ],
  });

  await prisma.crmActivity.create({
    data: {
      tenantId: tenantA.id,
      leadId: leadForm.id,
      actorUserId: salesA.id,
      type: "NOTE",
      body: "Seeded follow-up activity for distributor pricing request.",
    },
  });

  const invocation = await prisma.modelInvocation.create({
    data: {
      tenantId: tenantA.id,
      userId: salesA.id,
      route: "LOCAL_QWEN",
      taskType: "GENERATE",
      modelName: "qwen2.5-vl-32b-instruct",
      containsPii: true,
      tokensInput: 620,
      tokensOutput: 180,
      latencyMs: 820,
      costUsd: "0.0000",
      reason: "privacy inquiry draft",
    },
  });

  await prisma.reply.create({
    data: {
      tenantId: tenantA.id,
      inquiryId: inquiryForm.id,
      createdByUserId: salesA.id,
      modelInvocationId: invocation.id,
      status: "DRAFT",
      route: "LOCAL_QWEN",
      draftText:
        "Thanks for your inquiry. We can share distributor pricing and lead times after confirming your target monthly volume.",
      citations: [
        { source: "Product manual p.2" },
        { source: "Certification p.1" },
      ],
    },
  });

  await prisma.notification.create({
    data: {
      tenantId: tenantA.id,
      userId: salesA.id,
      type: "LEAD_NEW",
      status: "UNREAD",
      title: "New form inquiry",
      body: "Al Noor Industrial Supplies submitted a distributor pricing request.",
      linkUrl: `/crm/leads/${leadForm.id}`,
    },
  });

  await prisma.hitlTask.create({
    data: {
      tenantId: tenantA.id,
      requestedByUserId: salesA.id,
      assigneeUserId: ownerA.id,
      type: "REPLY_SEND",
      status: "PENDING",
      entityType: "reply",
      entityId: inquiryEmail.id,
      payload: {
        inquiryId: inquiryEmail.id,
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        tenants: [tenantA.slug, tenantB.slug],
        users: 4,
        knowledgeDocuments: 3,
        contentPlatforms: platformRules.length,
        inquiries: 2,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
