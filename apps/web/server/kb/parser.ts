import { extname } from "node:path";
import * as cheerio from "cheerio";

type ParsedKnowledgeDocument = {
  text: string;
  resolvedTitle: string | null;
  sourceLabel: string | null;
  contentType: string;
};

function normalizeText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getLowercaseExtension(name: string | null | undefined) {
  return extname(name ?? "").toLowerCase();
}

function resolveDocumentFormat(params: {
  mimeType?: string | null;
  fileName?: string | null;
}) {
  const mimeType = (params.mimeType ?? "").toLowerCase();
  const extension = getLowercaseExtension(params.fileName);

  if (
    mimeType.includes("pdf") ||
    extension === ".pdf"
  ) {
    return "pdf";
  }

  if (
    mimeType.includes(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ) ||
    extension === ".docx"
  ) {
    return "docx";
  }

  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    extension === ".xlsx" ||
    extension === ".xlsm" ||
    extension === ".xls"
  ) {
    return "xlsx";
  }

  if (
    mimeType.includes("text/html") ||
    extension === ".html" ||
    extension === ".htm"
  ) {
    return "html";
  }

  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    extension === ".txt" ||
    extension === ".md" ||
    extension === ".csv" ||
    extension === ".tsv" ||
    extension === ".json"
  ) {
    return "text";
  }

  return "unknown";
}

async function parsePdf(buffer: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return normalizeText(result.text);
  } finally {
    await parser.destroy();
  }
}

async function parseDocx(buffer: Buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });

  return normalizeText(result.value);
}

async function parseSpreadsheet(buffer: Buffer) {
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const text = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = xlsx.utils.sheet_to_csv(sheet, { blankrows: false }).trim();

    return csv ? `# ${sheetName}\n${csv}` : `# ${sheetName}`;
  }).join("\n\n");

  return normalizeText(text);
}

function parseHtml(
  html: string,
  fallbackTitle?: string | null,
  sourceUrl?: string | null,
) {
  const $ = cheerio.load(html);
  $("script,style,noscript").remove();
  const title = normalizeText($("title").first().text()) || fallbackTitle || null;
  const text = normalizeText($("body").text() || $.text());
  let sourceLabel = sourceUrl ? new URL(sourceUrl).hostname : null;

  if (sourceUrl) {
    const parsedUrl = new URL(sourceUrl);
    sourceLabel = `${parsedUrl.hostname}${parsedUrl.pathname}`;
  }

  return {
    text,
    resolvedTitle: title,
    sourceLabel,
  };
}

function parsePlainText(buffer: Buffer) {
  return normalizeText(buffer.toString("utf8"));
}

export async function parseKnowledgeBuffer(params: {
  buffer: Buffer;
  fileName?: string | null;
  mimeType?: string | null;
  fallbackTitle?: string | null;
  sourceUrl?: string | null;
}): Promise<ParsedKnowledgeDocument> {
  const format = resolveDocumentFormat(params);
  let text = "";
  let resolvedTitle = params.fallbackTitle ?? null;
  let sourceLabel: string | null = null;

  switch (format) {
    case "pdf":
      text = await parsePdf(params.buffer);
      break;
    case "docx":
      text = await parseDocx(params.buffer);
      break;
    case "xlsx":
      text = await parseSpreadsheet(params.buffer);
      break;
    case "html": {
      const parsed = parseHtml(
        params.buffer.toString("utf8"),
        params.fallbackTitle,
        params.sourceUrl,
      );
      text = parsed.text;
      resolvedTitle = parsed.resolvedTitle;
      sourceLabel = parsed.sourceLabel;
      break;
    }
    case "text":
      text = parsePlainText(params.buffer);
      break;
    default:
      throw new Error(
        `Unsupported knowledge document format: ${params.mimeType ?? params.fileName ?? "unknown"}`,
      );
  }

  if (!text) {
    throw new Error("Document parser returned empty text.");
  }

  return {
    text,
    resolvedTitle,
    sourceLabel,
    contentType: params.mimeType ?? "application/octet-stream",
  };
}

export async function fetchAndParseKnowledgeUrl(params: {
  url: string;
  fallbackTitle?: string | null;
}) {
  const response = await fetch(params.url, {
    headers: {
      "user-agent": "TradePilotBot/0.1 (+knowledge-fetch)",
      accept:
        "text/html,application/xhtml+xml,application/xml,text/plain,application/pdf;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch knowledge document URL: ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type");
  const buffer = Buffer.from(await response.arrayBuffer());

  return parseKnowledgeBuffer({
    buffer,
    fileName: new URL(params.url).pathname,
    mimeType: contentType,
    fallbackTitle: params.fallbackTitle,
    sourceUrl: params.url,
  });
}
