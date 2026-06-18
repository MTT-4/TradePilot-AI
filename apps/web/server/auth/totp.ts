import * as OTPAuth from "otpauth";

const TOTP_ISSUER = "TradePilot AI";

export function createTotpSetup(email: string) {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });

  return {
    secret: secret.base32,
    otpauthUrl: totp.toString(),
  };
}

export function verifyTotpCode(secret: string, code: string) {
  const normalizedCode = code.replace(/[\s-]/g, "");
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: "TradePilot AI",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  return totp.validate({ token: normalizedCode, window: 1 }) !== null;
}
