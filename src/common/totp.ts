import * as speakeasy from "speakeasy";

const ISSUER = "EdiMart";

export const generateTotpSecret = (email: string) => {
  const generated = speakeasy.generateSecret({
    name: `${ISSUER} (${email})`,
    issuer: ISSUER,
    length: 20,
  });
  if (!generated.base32) {
    throw new Error("Failed to generate TOTP secret");
  }
  const otpauthUrl =
    generated.otpauth_url ||
    `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(email)}?secret=${generated.base32}&issuer=${encodeURIComponent(ISSUER)}`;
  return { secret: generated.base32, otpauthUrl };
};

export const verifyTotpCode = (secret: string, token: string) =>
  speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token: token.trim(),
    window: 1,
  });

/** For tests only — generate a current code for a known secret. */
export const generateTotpCode = (secret: string) =>
  speakeasy.totp({
    secret,
    encoding: "base32",
  });
