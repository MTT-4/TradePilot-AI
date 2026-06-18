import { KnowledgeSensitivity } from "@prisma/client";

const INTERNAL_HINTS = [
  "quote",
  "quotation",
  "pricing",
  "price",
  "contract",
  "agreement",
  "invoice",
  "internal",
  "private",
  "nda",
  "confidential",
  "报价",
  "合同",
  "发票",
  "内部",
  "保密",
];

export function parseKnowledgeSensitivity(
  value: string | null | undefined,
): KnowledgeSensitivity | undefined {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized === "public") {
    return KnowledgeSensitivity.PUBLIC;
  }

  if (normalized === "internal_only") {
    return KnowledgeSensitivity.INTERNAL_ONLY;
  }

  return undefined;
}

export function suggestKnowledgeSensitivity(input: {
  title?: string | null;
  sourceUrl?: string | null;
  text?: string | null;
}) {
  const haystack = `${input.title ?? ""} ${input.sourceUrl ?? ""} ${input.text ?? ""}`.toLowerCase();

  if (INTERNAL_HINTS.some((hint) => haystack.includes(hint))) {
    return KnowledgeSensitivity.INTERNAL_ONLY;
  }

  return KnowledgeSensitivity.PUBLIC;
}

export function toApiKnowledgeSensitivity(value: KnowledgeSensitivity) {
  return value.toLowerCase();
}
