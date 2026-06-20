import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  JobType,
  ModelRoute,
  ReplyStatus,
} from "@prisma/client";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import {
  getReplyDetail,
  rejectReplyDraft,
  requestReplyDraft,
  updateReplyDraft,
} from "@/server/replies/service";
import { approveHitlTask } from "@/server/sites/service";
import { getDashboardSummary } from "@/server/dashboard/service";

const prisma = getPrismaClient();

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createReplyFetchMock(options?: {
  localQwenAvailable?: boolean;
}) {
  const counters = {
    openai: 0,
    google: 0,
    localQwen: 0,
    localBge: 0,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;

    if (url.startsWith(process.env.OPENAI_BASE_URL!)) {
      counters.openai += 1;

      return jsonResponse({
        model: process.env.OPENAI_MODEL,
        choices: [
          {
            message: {
              content: "OpenAI fallback should not happen",
            },
          },
        ],
      });
    }

    if (url.startsWith(process.env.GOOGLE_TRANSLATE_BASE_URL!)) {
      counters.google += 1;

      return jsonResponse({
        data: {
          translations: [
            {
              translatedText: "Google fallback should not happen",
            },
          ],
        },
      });
    }

    if (url.startsWith(process.env.LOCAL_BGE_BASE_URL!)) {
      counters.localBge += 1;

      return jsonResponse({
        model: process.env.LOCAL_BGE_MODEL,
        data: [
          {
            embedding: Array.from({ length: 1024 }, (_, index) =>
              Number((((index % 17) + 1) / 100).toFixed(4)),
            ),
          },
        ],
        usage: {
          prompt_tokens: 9,
        },
      });
    }

    if (url.startsWith(process.env.LOCAL_QWEN_BASE_URL!)) {
      counters.localQwen += 1;

      if (options?.localQwenAvailable === false) {
        return jsonResponse(
          {
            error: {
              message: "local qwen unavailable",
            },
          },
          503,
        );
      }

      const isClassifierCall =
        typeof body === "object" &&
        body !== null &&
        "messages" in body &&
        Array.isArray(body.messages) &&
        typeof body.messages[0]?.content === "string" &&
        body.messages[0].content.includes("Classify whether");

      if (isClassifierCall) {
        return jsonResponse({
          model: process.env.LOCAL_QWEN_MODEL,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  containsPii: true,
                  reason: "reply_inquiry_contains_customer_context",
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 18,
            completion_tokens: 8,
          },
        });
      }

      const isTranslateCall =
        typeof body === "object" &&
        body !== null &&
        "messages" in body &&
        Array.isArray(body.messages) &&
        typeof body.messages[0]?.content === "string" &&
        body.messages[0].content.includes("Translate the text accurately");

      if (isTranslateCall) {
        return jsonResponse({
          model: process.env.LOCAL_QWEN_MODEL,
          choices: [
            {
              message: {
                content: "客户需要分销报价、MOQ 和交期，请先确认合作范围。",
              },
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 16,
          },
        });
      }

      return jsonResponse({
        model: process.env.LOCAL_QWEN_MODEL,
        choices: [
          {
            message: {
              content:
                "Thanks for your inquiry. We can share export documentation and next-step commercial details after confirming your requested distributor scope.",
            },
          },
        ],
        usage: {
          prompt_tokens: 30,
          completion_tokens: 22,
        },
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  return {
    counters,
    fetchMock,
  };
}

let salesContext: TenantContext;
let viewerContext: TenantContext;
let inquiryId = "";

beforeAll(async () => {
  process.env.OPENAI_BASE_URL = "https://mock.openai.test/v1";
  process.env.OPENAI_MODEL = "gpt-4.1-mini";
  process.env.GOOGLE_TRANSLATE_BASE_URL = "https://mock.google.test/v2";
  process.env.LOCAL_QWEN_BASE_URL = "https://mock.local-qwen.test/v1";
  process.env.LOCAL_QWEN_MODEL = "qwen-mock";
  process.env.LOCAL_BGE_BASE_URL = "https://mock.local-bge.test/v1";
  process.env.LOCAL_BGE_MODEL = "bge-mock";
  process.env.OPENAI_API_KEY = "openai-test-key";
  process.env.GOOGLE_TRANSLATE_KEY = "google-test-key";

  const [ownerMembership, salesMembership, inquiry] = await Promise.all([
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
    prisma.inquiry.findFirst({
      where: {
        tenant: {
          slug: "shenghai-machinery",
        },
        sourceType: "FORM",
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
      },
    }),
  ]);

  if (!ownerMembership || !salesMembership || !inquiry) {
    throw new Error(
      "Seed data missing. Run `npm run prisma:seed` before T5.1/T5.3 tests.",
    );
  }

  const viewerUser = await prisma.user.create({
    data: {
      email: `viewer-${Date.now()}@tradepilot.local`,
      name: "Viewer User",
      passwordHash: "viewer-seed-hash",
    },
    select: {
      id: true,
    },
  });
  const viewerMembership = await prisma.membership.create({
    data: {
      tenantId: ownerMembership.tenantId,
      userId: viewerUser.id,
      role: "VIEWER",
      status: "ACTIVE",
    },
    select: {
      tenantId: true,
      userId: true,
      role: true,
    },
  });

  salesContext = salesMembership;
  viewerContext = viewerMembership;
  inquiryId = inquiry.id;
});

describe("T5.1 replies + T5.3 dashboard", () => {
  it("uses local_qwen for reply draft, keeps reply unsent before approval, and updates dashboard after approval", async () => {
    const { counters, fetchMock } = createReplyFetchMock();

    const drafted = await requestReplyDraft({
      tenantContext: salesContext,
      requestedByUserId: salesContext.userId,
      input: {
        inquiryId,
      },
      fetchImpl: fetchMock,
    });

    expect(drafted.replyId).toBeTruthy();
    expect(drafted.hitlTaskId).toBeTruthy();
    expect(String(drafted.draftText)).toContain("Thanks for your inquiry");
    expect(Array.isArray(drafted.citations)).toBe(true);
    expect(counters.openai).toBe(0);
    expect(counters.google).toBe(0);
    expect(counters.localQwen).toBe(1);

    const reply = await prisma.reply.findUniqueOrThrow({
      where: {
        id: drafted.replyId,
      },
      select: {
        status: true,
        sentAt: true,
        route: true,
        modelInvocation: {
          select: {
            route: true,
          },
        },
      },
    });

    expect(reply.status).toBe("PENDING_APPROVAL");
    expect(reply.sentAt).toBeNull();
    expect(reply.route).toBe(ModelRoute.LOCAL_QWEN);
    expect(reply.modelInvocation?.route).toBe(ModelRoute.LOCAL_QWEN);

    const beforeApprove = await getDashboardSummary({
      tenantContext: viewerContext,
      range: "week",
    });
    const beforeReplySendPending =
      beforeApprove.pendingHitl.find((item) => item.type === "reply_send")?.count ?? 0;

    expect(
      beforeApprove.pendingHitl.some(
        (item) => item.type === "reply_send" && item.count >= 1,
      ),
    ).toBe(true);
    expect(
      beforeApprove.sourceAttribution.some(
        (item) => item.platform === "linkedin" && item.count >= 1,
      ),
    ).toBe(true);

    await approveHitlTask({
      tenantContext: salesContext,
      hitlTaskId: drafted.hitlTaskId,
      approvedByUserId: salesContext.userId,
    });

    const sentReply = await prisma.reply.findUniqueOrThrow({
      where: {
        id: drafted.replyId,
      },
      select: {
        status: true,
        sentAt: true,
        finalText: true,
      },
    });

    expect(sentReply.status).toBe("SENT");
    expect(sentReply.sentAt).toBeTruthy();
    expect(sentReply.finalText).toContain("Thanks for your inquiry");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        tenantId: salesContext.tenantId,
        action: "reply_sent",
        entityId: drafted.replyId,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
      },
    });

    expect(audit.id).toBeTruthy();

    const afterApprove = await getDashboardSummary({
      tenantContext: viewerContext,
      range: "week",
    });
    const afterReplySendPending =
      afterApprove.pendingHitl.find((item) => item.type === "reply_send")?.count ?? 0;

    expect(afterApprove.replyMedianMinutes).toBeGreaterThanOrEqual(0);
    expect(afterReplySendPending).toBe(beforeReplySendPending - 1);
  });

  it("returns LOCAL_MODEL_UNAVAILABLE, queues generate_reply, and never falls back", async () => {
    const { counters, fetchMock } = createReplyFetchMock({
      localQwenAvailable: false,
    });

    await expect(
      requestReplyDraft({
        tenantContext: salesContext,
        requestedByUserId: salesContext.userId,
        input: {
          inquiryId,
        },
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "LOCAL_MODEL_UNAVAILABLE",
    });

    expect(counters.openai).toBe(0);
    expect(counters.google).toBe(0);

    const queuedJob = await prisma.job.findFirstOrThrow({
      where: {
        tenantId: salesContext.tenantId,
        type: JobType.GENERATE_REPLY,
        input: {
          path: ["inquiryId"],
          equals: inquiryId,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        status: true,
      },
    });

    expect(queuedJob.status).toBe("QUEUED");
  });

  it("blocks viewer from approving reply HITL tasks", async () => {
    const { fetchMock } = createReplyFetchMock();
    const drafted = await requestReplyDraft({
      tenantContext: salesContext,
      requestedByUserId: salesContext.userId,
      input: {
        inquiryId,
      },
      fetchImpl: fetchMock,
    });

    await expect(
      approveHitlTask({
        tenantContext: viewerContext,
        hitlTaskId: drafted.hitlTaskId,
        approvedByUserId: viewerContext.userId,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("returns reply detail with translated inquiry and allows editing pending drafts", async () => {
    const { counters, fetchMock } = createReplyFetchMock();
    const drafted = await requestReplyDraft({
      tenantContext: salesContext,
      requestedByUserId: salesContext.userId,
      input: {
        inquiryId,
      },
      fetchImpl: fetchMock,
    });

    const detail = await getReplyDetail({
      tenantContext: salesContext,
      replyId: drafted.replyId,
      requestedByUserId: salesContext.userId,
      fetchImpl: fetchMock,
    });

    expect(detail.reply.id).toBe(drafted.replyId);
    expect(detail.reply.status).toBe("pending_approval");
    expect(detail.reply.hitlTaskId).toBe(drafted.hitlTaskId);
    expect(detail.reply.inquiry.translatedBody).toContain("客户需要分销报价");
    expect(counters.openai).toBe(0);
    expect(counters.google).toBe(0);
    expect(counters.localQwen).toBe(2);

    const updated = await updateReplyDraft({
      tenantContext: salesContext,
      replyId: drafted.replyId,
      requestedByUserId: salesContext.userId,
      input: {
        draftText: "Updated reply draft for manual review.",
      },
    });

    expect(updated.reply.draftText).toBe("Updated reply draft for manual review.");
    expect(updated.reply.inquiry.translatedBody).toBeNull();

    const hitlTask = await prisma.hitlTask.findUniqueOrThrow({
      where: {
        id: drafted.hitlTaskId,
      },
      select: {
        payload: true,
      },
    });

    expect(hitlTask.payload).toMatchObject({
      draftText: "Updated reply draft for manual review.",
    });
  });

  it("allows rejecting pending drafts and closes the pending HITL task", async () => {
    const { fetchMock } = createReplyFetchMock();
    const drafted = await requestReplyDraft({
      tenantContext: salesContext,
      requestedByUserId: salesContext.userId,
      input: {
        inquiryId,
      },
      fetchImpl: fetchMock,
    });

    await expect(
      rejectReplyDraft({
        tenantContext: viewerContext,
        replyId: drafted.replyId,
        rejectedByUserId: viewerContext.userId,
        input: {
          reason: "viewer cannot reject",
        },
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });

    const rejected = await rejectReplyDraft({
      tenantContext: salesContext,
      replyId: drafted.replyId,
      rejectedByUserId: salesContext.userId,
      input: {
        reason: "Need pricing confirmation first",
      },
    });

    expect(rejected).toEqual({
      replyId: drafted.replyId,
      status: "rejected",
    });

    const reply = await prisma.reply.findUniqueOrThrow({
      where: {
        id: drafted.replyId,
      },
      select: {
        status: true,
      },
    });
    expect(reply.status).toBe(ReplyStatus.REJECTED);

    const task = await prisma.hitlTask.findUniqueOrThrow({
      where: {
        id: drafted.hitlTaskId,
      },
      select: {
        status: true,
        reason: true,
        rejectedByUserId: true,
        resolvedAt: true,
      },
    });

    expect(task.status).toBe("REJECTED");
    expect(task.reason).toBe("Need pricing confirmation first");
    expect(task.rejectedByUserId).toBe(salesContext.userId);
    expect(task.resolvedAt).toBeTruthy();
  });
});
