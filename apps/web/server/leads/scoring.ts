import { LeadScore } from "@prisma/client";
import { getPrismaClient } from "@/server/db/prisma";

const PRIORITY_COUNTRIES = new Set([
  "ae",
  "uae",
  "united arab emirates",
  "saudi arabia",
  "sa",
  "oman",
  "qatar",
  "kuwait",
  "bahrain",
]);

const HIGH_INTENT_KEYWORDS = [
  "moq",
  "lead time",
  "delivery",
  "exw",
  "fob",
  "cif",
  "quotation",
  "quote",
  "price",
  "pricing",
  "distributor",
  "dealer",
  "service support",
];

const VOLUME_KEYWORDS = [
  "monthly volume",
  "annual volume",
  "container",
  "units per month",
  "pieces per month",
  "10 units",
  "20 units",
  "50 units",
  "100 units",
  "per month",
  "per year",
];

type LeadScoringInput = {
  country?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  inquiryTexts: string[];
};

function containsAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle));
}

export function evaluateLeadScore(input: LeadScoringInput) {
  const joinedInquiry = input.inquiryTexts.join("\n").toLowerCase();
  const reasons: string[] = [];
  let points = 0;

  if (
    input.country &&
    PRIORITY_COUNTRIES.has(input.country.trim().toLowerCase())
  ) {
    points += 2;
    reasons.push(`Buyer market matched priority country: ${input.country.trim()}.`);
  }

  if (input.phone?.trim() || input.whatsapp?.trim()) {
    points += 2;
    reasons.push("Buyer left a direct phone or WhatsApp contact.");
  }

  if (containsAny(joinedInquiry, VOLUME_KEYWORDS)) {
    points += 2;
    reasons.push("Inquiry mentioned purchasing volume or order scale.");
  }

  if (containsAny(joinedInquiry, HIGH_INTENT_KEYWORDS)) {
    points += 1;
    reasons.push("Inquiry asked for concrete commercial or delivery details.");
  }

  if (joinedInquiry.length >= 120) {
    points += 1;
    reasons.push("Inquiry contained enough detail for concrete follow-up.");
  }

  const score =
    points >= 5
      ? LeadScore.A
      : points >= 3
        ? LeadScore.B
        : LeadScore.C;

  return {
    score,
    scoreReason:
      reasons.join(" ") ||
      "Limited buyer context so the lead stays in the lowest confidence band.",
  };
}

export async function refreshLeadScore(params: {
  tenantId: string;
  leadId: string;
}) {
  const prisma = getPrismaClient();
  const lead = await prisma.lead.findFirst({
    where: {
      id: params.leadId,
      tenantId: params.tenantId,
    },
    select: {
      id: true,
      country: true,
      contact: {
        select: {
          phone: true,
          whatsapp: true,
        },
      },
      inquiries: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          subject: true,
          body: true,
        },
      },
    },
  });

  if (!lead) {
    return null;
  }

  const evaluated = evaluateLeadScore({
    country: lead.country,
    phone: lead.contact?.phone ?? null,
    whatsapp: lead.contact?.whatsapp ?? null,
    inquiryTexts: lead.inquiries.map((item) =>
      [item.subject ?? "", item.body].filter(Boolean).join("\n"),
    ),
  });

  return prisma.lead.update({
    where: {
      id: lead.id,
    },
    data: {
      score: evaluated.score,
      scoreReason: evaluated.scoreReason,
    },
    select: {
      id: true,
      score: true,
      scoreReason: true,
    },
  });
}

export function toApiLeadScore(value: LeadScore | null | undefined) {
  return value?.toLowerCase() ?? null;
}
