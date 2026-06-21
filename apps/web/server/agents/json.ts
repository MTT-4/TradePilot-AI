import { ApiError } from "@/server/api/errors";

export function extractJsonObject(text: string): unknown {
  const fenced = text.replace(/```json/gi, "```").trim();
  const withoutFence = fenced.startsWith("```")
    ? fenced.replace(/^```/, "").replace(/```$/, "").trim()
    : fenced;
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new ApiError(502, "MODEL_OUTPUT", "Agent returned no JSON object.");
  }

  return JSON.parse(withoutFence.slice(start, end + 1));
}
