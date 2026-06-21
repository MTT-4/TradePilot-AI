import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { assertLeadOwnerScope } from "@/server/skills/access";
import { logSkillEvent } from "@/server/observability/basic-log";

/**
 * Skill: order_delivery_communication（订单与交期沟通）
 * 契约见 docs/skills/order_delivery_communication/。纯本地、纯新增。
 *
 * 硬约束：禁止 AI/系统承诺交期或金额。所有日期/金额均为 {{token}} 占位，
 * 人工未提供则渲染为 [待确认]；模板本身从不断言具体交期。只产草稿、不发送。
 */

const PLACEHOLDER = "[待确认]";

export const ORDER_STAGES = [
  "pi",
  "payment_reminder",
  "production_update",
  "inspection",
  "shipment",
  "after_sales",
  "restock",
] as const;

export type OrderStage = (typeof ORDER_STAGES)[number];

type Template = { subject: string; body: string };

const TEMPLATES: Record<OrderStage, Template> = {
  pi: {
    subject: "Proforma Invoice for order {{order_no}}",
    body: "Dear {{contact}},\n\nThank you for your order. Please find the Proforma Invoice {{order_no}} for {{company}}.\nTotal amount: {{amount}}\nPayment terms: {{payment_terms}}\nBank details: {{bank_info}}\n\nKindly confirm and arrange the deposit; production starts upon receipt.\n\nBest regards,\n{{sender}}",
  },
  payment_reminder: {
    subject: "Payment reminder — order {{order_no}}",
    body: "Dear {{contact}},\n\nA gentle reminder on the {{payment_stage}} payment for order {{order_no}} (amount: {{amount}}). Please let us know once it is arranged.\n\nBest regards,\n{{sender}}",
  },
  production_update: {
    subject: "Production update — order {{order_no}}",
    body: "Dear {{contact}},\n\nUpdate on order {{order_no}}: current status is {{production_status}}. Our production team is confirming the completion timing and we will revert with details.\n\nBest regards,\n{{sender}}",
  },
  inspection: {
    subject: "Ready for inspection — order {{order_no}}",
    body: "Dear {{contact}},\n\nOrder {{order_no}} is approaching readiness for inspection. Please advise your preferred inspection arrangement so we can coordinate.\n\nBest regards,\n{{sender}}",
  },
  shipment: {
    subject: "Shipment notice — order {{order_no}}",
    body: "Dear {{contact}},\n\nOrder {{order_no}} has been shipped.\nCarrier: {{carrier}}\nTracking no.: {{tracking_no}}\nDocuments: {{documents}}\n\nPlease let us know if you need anything for customs clearance.\n\nBest regards,\n{{sender}}",
  },
  after_sales: {
    subject: "Following up on order {{order_no}}",
    body: "Dear {{contact}},\n\nChecking in on order {{order_no}}. Please let us know if everything arrived in good condition, or if you need any support.\n\nBest regards,\n{{sender}}",
  },
  restock: {
    subject: "Restock for {{company}}?",
    body: "Dear {{contact}},\n\nBased on your previous order {{order_no}}, you may be due for a restock. We are happy to prepare a new Proforma Invoice whenever you are ready.\n\nBest regards,\n{{sender}}",
  },
};

export type OrderMessage = {
  stage: OrderStage;
  subject: string;
  body: string;
  requires_human_confirmation: true;
  unresolved_fields: string[];
  confirmation_checklist: string[];
  warnings: string[];
};

function renderTemplate(
  text: string,
  facts: Record<string, string>,
  unresolved: Set<string>,
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = facts[key];
    if (value != null && String(value).trim() !== "") {
      return String(value);
    }
    unresolved.add(key);
    return PLACEHOLDER;
  });
}

async function resolveParty(params: {
  tenantContext: TenantContext;
  leadId?: string;
  inquiryId?: string;
}): Promise<{ company: string; contact: string }> {
  if (!params.leadId && !params.inquiryId) {
    return { company: "", contact: "" };
  }
  const prisma = getTenantPrisma(params.tenantContext);
  const lead = params.leadId
    ? await prisma.lead.findFirst({
        where: { id: params.leadId },
        select: { ownerUserId: true, companyName: true, contact: { select: { name: true } } },
      })
    : await prisma.inquiry
        .findFirst({
          where: { id: params.inquiryId },
          select: {
            lead: {
              select: {
                ownerUserId: true,
                companyName: true,
                contact: { select: { name: true } },
              },
            },
          },
        })
        .then((i) => i?.lead ?? null);

  if (!lead) {
    throw new ApiError(404, "NOT_FOUND", "Lead or inquiry not found.");
  }
  assertLeadOwnerScope(params.tenantContext, lead.ownerUserId);
  return {
    company: lead.companyName ?? "",
    contact: lead.contact?.name ?? "",
  };
}

export async function buildOrderMessage(params: {
  tenantContext: TenantContext;
  userId?: string;
  input: {
    stage: OrderStage;
    leadId?: string;
    inquiryId?: string;
    facts?: Record<string, string>;
  };
}): Promise<OrderMessage> {
  const template = TEMPLATES[params.input.stage];
  if (!template) {
    throw new ApiError(400, "VALIDATION", "Unknown order stage.");
  }

  const party = await resolveParty({
    tenantContext: params.tenantContext,
    leadId: params.input.leadId,
    inquiryId: params.input.inquiryId,
  });

  const facts: Record<string, string> = {
    company: party.company,
    contact: party.contact,
    ...(params.input.facts ?? {}),
  };

  const unresolved = new Set<string>();
  const subject = renderTemplate(template.subject, facts, unresolved);
  const body = renderTemplate(template.body, facts, unresolved);
  const unresolved_fields = Array.from(unresolved);

  const warnings: string[] = [];
  if (unresolved_fields.length > 0) {
    warnings.push(
      `以下字段未填，已用 ${PLACEHOLDER} 占位，发送前必须人工补全：${unresolved_fields.join(", ")}。`,
    );
  }
  warnings.push("交期/金额等关键信息须经生产/财务确认，系统不自动承诺。");

  await logSkillEvent({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.userId,
    action: "order_communication_drafted",
    entityType: "order_communication",
    entityId: params.input.stage,
    metadata: { stage: params.input.stage, unresolvedCount: unresolved_fields.length },
  });

  return {
    stage: params.input.stage,
    subject,
    body,
    requires_human_confirmation: true,
    unresolved_fields,
    confirmation_checklist: [
      "核实订单号与客户信息",
      "核实金额与币种",
      "核实交期（由生产确认，勿自行承诺）",
      "核实账户/物流单据信息",
    ],
    warnings,
  };
}
