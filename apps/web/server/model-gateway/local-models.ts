// 本地模型扫描：扫描本机已下载的 GGUF 模型文件，识别用途并给出建议别名，
// 供设置页"选择本地模型"使用。纯文件系统读取、无网络、无 DB。
//
// 约定：模型默认放在 README 所述目录（如 ~/AI/models），文件后缀 .gguf。
// 分类靠文件名启发式：含 bge/e5/gte 等 → 向量(embedding)；含 qwen/llama 等 → 对话(chat)。

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export type LocalModelKind = "chat" | "embedding" | "unknown";

export type LocalModelFile = {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  kind: LocalModelKind;
  /** 建议在模型策略里使用的别名（已去掉扩展名/量化后缀，便于直接填入） */
  suggestedAlias: string;
};

const MODEL_EXTENSIONS = [".gguf"];
const EMBED_HINTS = ["bge", "e5", "gte", "nomic", "minilm", "embed"];
const CHAT_HINTS = [
  "qwen",
  "llama",
  "mistral",
  "mixtral",
  "gemma",
  "phi",
  "yi",
  "deepseek",
  "glm",
  "internlm",
  "baichuan",
  "instruct",
  "chat",
  "-vl",
];

export function classifyModelKind(fileName: string): LocalModelKind {
  const lower = fileName.toLowerCase();
  if (EMBED_HINTS.some((hint) => lower.includes(hint))) {
    return "embedding";
  }
  if (CHAT_HINTS.some((hint) => lower.includes(hint))) {
    return "chat";
  }
  return "unknown";
}

export function suggestModelAlias(fileName: string): string {
  let base = fileName;
  for (const ext of MODEL_EXTENSIONS) {
    if (base.toLowerCase().endsWith(ext)) {
      base = base.slice(0, -ext.length);
      break;
    }
  }
  // 去掉常见分片 / 量化后缀，例如 -00001-of-00003 / -Q8_0 / .Q4_K_M / -f16
  base = base
    .replace(/[._-]\d{5}-of-\d{5}$/i, "")
    .replace(/[._-](i?q?\d+(_[a-z0-9]+)*|f16|f32|bf16|int8|int4)$/i, "")
    .replace(/_/g, "-") // 仅把下划线转连字符，保留版本号里的小数点（如 2.5）
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base.toLowerCase();
}

async function collectFiles(dir: string, depth: number): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // 目录不存在 / 无权限：返回空，由调用方决定提示
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0) {
        files.push(...(await collectFiles(full, depth - 1)));
      }
    } else if (
      entry.isFile() &&
      MODEL_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))
    ) {
      files.push(full);
    }
  }
  return files;
}

/**
 * 扫描 baseDir（含 maxDepth 层子目录）下的 GGUF 模型文件。
 * @returns 按用途、文件名排序的模型列表；目录不存在时返回 []。
 */
export async function scanLocalModels(
  baseDir: string,
  options?: { maxDepth?: number },
): Promise<LocalModelFile[]> {
  const maxDepth = options?.maxDepth ?? 1;
  const files = await collectFiles(baseDir, maxDepth);

  const results: LocalModelFile[] = [];
  for (const filePath of files) {
    let sizeBytes = 0;
    try {
      sizeBytes = (await stat(filePath)).size;
    } catch {
      continue;
    }
    const fileName = path.basename(filePath);
    results.push({
      fileName,
      filePath,
      sizeBytes,
      kind: classifyModelKind(fileName),
      suggestedAlias: suggestModelAlias(fileName),
    });
  }

  const kindOrder: Record<LocalModelKind, number> = {
    chat: 0,
    embedding: 1,
    unknown: 2,
  };
  results.sort(
    (a, b) =>
      kindOrder[a.kind] - kindOrder[b.kind] ||
      a.fileName.localeCompare(b.fileName),
  );
  return results;
}
