import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/server/api/errors";

type AuthTokenType = "two_factor_setup" | "two_factor_login" | "session_grant";

type AuthTokenPayload = {
  type: AuthTokenType;
  userId: string;
  email: string;
  iat: number;
  exp: number;
  nonce: string;
};

type AuthTokenOptions = {
  type: AuthTokenType;
  userId: string;
  email: string;
  ttlSeconds: number;
};

function getSignature(input: string) {
  return createHmac("sha256", getEnv().AUTH_SECRET)
    .update(input)
    .digest("base64url");
}

function createSignedToken({
  type,
  userId,
  email,
  ttlSeconds,
}: AuthTokenOptions) {
  const iat = Math.floor(Date.now() / 1000);
  const payload: AuthTokenPayload = {
    type,
    userId,
    email,
    iat,
    exp: iat + ttlSeconds,
    nonce: randomUUID(),
  };

  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = getSignature(body);

  return `${body}.${signature}`;
}

function parseToken(
  token: string,
  acceptedTypes: AuthTokenType[],
): AuthTokenPayload {
  const [body, signature] = token.split(".");

  if (!body || !signature) {
    throw new ApiError(
      401,
      "UNAUTHENTICATED",
      "Invalid or expired authentication challenge.",
    );
  }

  const expectedSignature = getSignature(body);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new ApiError(
      401,
      "UNAUTHENTICATED",
      "Invalid or expired authentication challenge.",
    );
  }

  let payload: AuthTokenPayload;

  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(
      401,
      "UNAUTHENTICATED",
      "Invalid or expired authentication challenge.",
    );
  }

  const now = Math.floor(Date.now() / 1000);

  if (payload.exp <= now || !acceptedTypes.includes(payload.type)) {
    throw new ApiError(
      401,
      "UNAUTHENTICATED",
      "Invalid or expired authentication challenge.",
    );
  }

  return payload;
}

export function issueTwoFactorSetupChallenge(userId: string, email: string) {
  return createSignedToken({
    type: "two_factor_setup",
    userId,
    email,
    ttlSeconds: 15 * 60,
  });
}

export function issueTwoFactorLoginChallenge(userId: string, email: string) {
  return createSignedToken({
    type: "two_factor_login",
    userId,
    email,
    ttlSeconds: 10 * 60,
  });
}

export function issueSessionGrant(userId: string, email: string) {
  return createSignedToken({
    type: "session_grant",
    userId,
    email,
    ttlSeconds: 5 * 60,
  });
}

export function verifyTwoFactorChallenge(token: string) {
  return parseToken(token, ["two_factor_setup", "two_factor_login"]);
}

export function verifySessionGrant(token: string) {
  return parseToken(token, ["session_grant"]);
}

export function safeVerifySessionGrant(token: string) {
  try {
    return verifySessionGrant(token);
  } catch {
    return null;
  }
}
