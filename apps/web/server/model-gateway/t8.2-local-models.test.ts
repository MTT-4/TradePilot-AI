import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  classifyModelKind,
  suggestModelAlias,
  scanLocalModels,
} from "@/server/model-gateway/local-models";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tp-models-"));
  await writeFile(path.join(dir, "Qwen2.5-VL-32B-Instruct-Q8_0.gguf"), "x");
  await writeFile(path.join(dir, "bge-m3-Q4_K_M.gguf"), "x");
  await writeFile(path.join(dir, "readme.txt"), "ignore me");
  await mkdir(path.join(dir, "sub"), { recursive: true });
  await writeFile(path.join(dir, "sub", "mistral-7b-instruct.gguf"), "x");
});

afterAll(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("T8.2 local model scan", () => {
  it("classifies chat vs embedding by filename", () => {
    expect(classifyModelKind("Qwen2.5-VL-32B-Instruct-Q8_0.gguf")).toBe("chat");
    expect(classifyModelKind("bge-m3.gguf")).toBe("embedding");
    expect(classifyModelKind("random-thing.gguf")).toBe("unknown");
  });

  it("suggests a clean alias without extension/quant suffix", () => {
    expect(suggestModelAlias("bge-m3-Q4_K_M.gguf")).toBe("bge-m3");
    expect(suggestModelAlias("Qwen2.5-VL-32B-Instruct-Q8_0.gguf")).toBe(
      "qwen2.5-vl-32b-instruct",
    );
  });

  it("scans a directory (incl. one subdir level) and ignores non-gguf", async () => {
    const models = await scanLocalModels(dir, { maxDepth: 1 });
    const names = models.map((m) => m.fileName).sort();
    expect(names).toEqual([
      "Qwen2.5-VL-32B-Instruct-Q8_0.gguf",
      "bge-m3-Q4_K_M.gguf",
      "mistral-7b-instruct.gguf",
    ]);
    // chat models sorted before embedding
    expect(models[0].kind).toBe("chat");
    expect(models.some((m) => m.kind === "embedding")).toBe(true);
    expect(models.every((m) => m.sizeBytes >= 0)).toBe(true);
  });

  it("returns [] for a missing directory instead of throwing", async () => {
    const models = await scanLocalModels(path.join(dir, "does-not-exist"));
    expect(models).toEqual([]);
  });
});
