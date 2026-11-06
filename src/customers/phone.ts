import { BadRequestException } from "@nestjs/common";

/**
 * Normalize Ethiopian mobile numbers to E.164 (+2519… / +2517…).
 * Accepts 09…, 07…, 9…, 7…, 2519…, 2517…, +2519…, +2517….
 */
export const normalizeEthiopianPhone = (raw: string): string => {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    throw new BadRequestException("Phone is required");
  }
  const digits = trimmed.replace(/[^\d+]/g, "");
  let national: string;
  if (digits.startsWith("+251")) {
    national = digits.slice(4);
  } else if (digits.startsWith("251")) {
    national = digits.slice(3);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else {
    national = digits.replace(/^\+/, "");
  }
  if (!/^[79]\d{8}$/.test(national)) {
    throw new BadRequestException(
      "Phone must be a valid Ethiopian mobile (09… / 07… → +2519… / +2517…)",
    );
  }
  return `+251${national}`;
};
