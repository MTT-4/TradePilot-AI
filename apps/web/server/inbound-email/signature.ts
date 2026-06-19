import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/server/api/errors";

function getInboundEmailWebhookSecret() {
  const env = getEnv();

  return env.INBOUND_EMAIL_WEBHOOK_SECRET ?? env.AUTH_SECRET;
}

export function signInboundEmailWebhookPayload(payload: string) {
  return createHmac("sha256", getInboundEmailWebhookSecret())
    .update(payload)
    .digest("base64url");
}

export function verifyInboundEmailWebhookSignature(
  payload: string,
  signature: string | null,
) {
  if (!signature) {
    throw new ApiError(401, "UNAUTHENTICATED", "Missing webhook signature.");
  }

  const expected = signInboundEmailWebhookPayload(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new ApiError(401, "UNAUTHENTICATED", "Invalid webhook signature.");
  }
}
