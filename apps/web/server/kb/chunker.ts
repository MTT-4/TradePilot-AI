import {
  KnowledgeSensitivity,
  type FileSourceType,
  type LocaleCode,
} from "@prisma/client";
import { suggestKnowledgeSensitivity } from "@/server/kb/sensitivity";

const MAX_CHARS_PER_CHUNK = 900;

type ChunkBlock = {
  text: string;
  isStructured: boolean;
};

export type ChunkBuildInput = {
  tenantId: string;
  documentId: string;
  title: string;
  locale: LocaleCode;
  sourceType: FileSourceType;
  sourceLabel?: string | null;
  product?: string | null;
  market?: string | null;
  documentSensitivity: KnowledgeSensitivity;
  parsedText: string;
};

function normalizeLines(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
}

function detectStructuredLine(line: string) {
  return (
    line.includes(",") ||
    line.includes("\t") ||
    line.includes("|") ||
    /^[A-Za-z0-9 _-]+:\s+\S+/.test(line) ||
    /^[\u4e00-\u9fffA-Za-z0-9 _-]+[:：]\s*\S+/.test(line)
  );
}

function splitIntoBlocks(text: string): ChunkBlock[] {
  const lines = normalizeLines(text);
  const blocks: ChunkBlock[] = [];
  let buffer: string[] = [];
  let hasStructuredLine = false;

  const flush = () => {
    const joined = buffer.join("\n").trim();

    if (joined) {
      blocks.push({
        text: joined,
        isStructured: hasStructuredLine,
      });
    }

    buffer = [];
    hasStructuredLine = false;
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }

    if (buffer.length === 0 && line.startsWith("#")) {
      flush();
    }

    if (detectStructuredLine(line)) {
      hasStructuredLine = true;
    }

    buffer.push(line);
  }

  flush();

  return blocks;
}

function splitLongBlock(block: ChunkBlock) {
  if (block.text.length <= MAX_CHARS_PER_CHUNK) {
    return [block];
  }

  const segments: ChunkBlock[] = [];
  const lines = block.text.split("\n");
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length > MAX_CHARS_PER_CHUNK && current) {
      segments.push({
        text: current,
        isStructured: block.isStructured,
      });
      current = line;
      continue;
    }

    current = candidate;
  }

  if (current) {
    segments.push({
      text: current,
      isStructured: block.isStructured,
    });
  }

  return segments;
}

function createSourceCitation(input: ChunkBuildInput, chunkIndex: number) {
  const label = input.sourceLabel?.trim() || input.title;

  return `${label} · chunk ${chunkIndex + 1}`;
}

export function buildKnowledgeChunks(input: ChunkBuildInput) {
  const blocks = splitIntoBlocks(input.parsedText).flatMap(splitLongBlock);

  return blocks.map((block, chunkIndex) => {
    const chunkSensitivity =
      input.documentSensitivity === KnowledgeSensitivity.INTERNAL_ONLY
        ? KnowledgeSensitivity.INTERNAL_ONLY
        : suggestKnowledgeSensitivity({
            title: input.title,
            text: block.text,
          });

    return {
      tenantId: input.tenantId,
      documentId: input.documentId,
      chunkIndex,
      namespace: `tenant:${input.tenantId}`,
      text: block.text,
      sourceCitation: createSourceCitation(input, chunkIndex),
      locale: input.locale,
      product: input.product ?? null,
      market: input.market ?? null,
      sensitivity: chunkSensitivity,
      metadata: {
        language: input.locale.toLowerCase(),
        product: input.product ?? null,
        market: input.market ?? null,
        sourceType: input.sourceType.toLowerCase(),
        sourceLabel: input.sourceLabel ?? null,
        title: input.title,
        isStructured: block.isStructured,
        characterCount: block.text.length,
      },
    };
  });
}
