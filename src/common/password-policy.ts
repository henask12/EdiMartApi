import { BadRequestException } from "@nestjs/common";

/** Min length and must include at least one letter and one digit. */
export const PASSWORD_MIN_LENGTH = 10;

export const passwordPolicyMessage =
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include at least one letter and one digit`;

export const isPasswordPolicyOk = (password: string): boolean => {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return false;
  }
  if (!/[A-Za-z]/.test(password)) {
    return false;
  }
  if (!/[0-9]/.test(password)) {
    return false;
  }
  return true;
};

export const assertPasswordPolicy = (password: string): void => {
  if (!isPasswordPolicyOk(password)) {
    throw new BadRequestException(passwordPolicyMessage);
  }
};
