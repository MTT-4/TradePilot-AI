import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import type { TenantContext } from "@/server/db/tenant-context";

/**
 * Tool: email_template（邮件模板）
 * 纯本地、纯新增。模板存现有 TenantSetting（key=email_templates），不新增表。
 * 模板仅供业务员套用编辑，不自动发送。
 */

export const EMAIL_TEMPLATE_KEY = "email_templates";

export const emailTemplateItemSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().max(200).default(""),
  body: z.string().trim().max(8000).default(""),
});

export const emailTemplatesSchema = z.object({
  templates: z.array(emailTemplateItemSchema).max(50),
});

export type EmailTemplates = z.infer<typeof emailTemplatesSchema>;

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplates = {
  templates: [
    {
      id: "dev_letter",
      name: "开发信",
      subject: "Reliable {{product}} supplier from China",
      body: "Dear {{contact}},\n\nWe are a manufacturer of {{product}} with CE/RoHS certification and stable supply.\n\nWould you be open to a short intro and catalog? Happy to share specs and references.\n\nBest regards,\n{{sender}}",
    },
    {
      id: "follow_up",
      name: "跟进信",
      subject: "Following up on {{product}}",
      body: "Dear {{contact}},\n\nJust following up on my previous message about {{product}}. Is there anything I can clarify on specs, MOQ, or lead time?\n\nBest regards,\n{{sender}}",
    },
    {
      id: "quotation",
      name: "报价信",
      subject: "Quotation for {{product}}",
      body: "Dear {{contact}},\n\nPlease find our quotation below (valid until {{valid_until}}). All figures are confirmed by our sales team.\n\n{{quote_body}}\n\nBest regards,\n{{sender}}",
    },
  ],
};

export async function getEmailTemplates(
  tenantContext: TenantContext,
): Promise<EmailTemplates> {
  const tenantPrisma = getTenantPrisma(tenantContext);
  const record = await tenantPrisma.tenantSetting.findFirst({
    where: { key: EMAIL_TEMPLATE_KEY },
    select: { value: true },
  });
  if (!record) return DEFAULT_EMAIL_TEMPLATES;
  const parsed = emailTemplatesSchema.safeParse(record.value);
  return parsed.success ? parsed.data : DEFAULT_EMAIL_TEMPLATES;
}

export async function updateEmailTemplates(params: {
  tenantContext: TenantContext;
  actorUserId?: string;
  input: unknown;
}): Promise<EmailTemplates> {
  const payload = emailTemplatesSchema.parse(params.input);
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const existing = await tenantPrisma.tenantSetting.findFirst({
    where: { key: EMAIL_TEMPLATE_KEY },
    select: { id: true },
  });

  const record = existing
    ? await tenantPrisma.tenantSetting.update({
        where: { id: existing.id },
        data: {
          value: payload as Prisma.InputJsonValue,
          updatedByUserId: params.actorUserId,
        },
        select: { id: true },
      })
    : await tenantPrisma.tenantSetting.create({
        data: {
          tenantId: params.tenantContext.tenantId,
          key: EMAIL_TEMPLATE_KEY,
          value: payload as Prisma.InputJsonValue,
          updatedByUserId: params.actorUserId,
        },
        select: { id: true },
      });

  await tenantPrisma.auditLog.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      actorUserId: params.actorUserId,
      action: "email_templates_updated",
      entityType: "tenant_setting",
      entityId: record.id,
      metadata: { count: payload.templates.length },
    },
  });

  return payload;
}
