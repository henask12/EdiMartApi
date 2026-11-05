import { BadRequestException } from "@nestjs/common";
import { assertPasswordPolicy, isPasswordPolicyOk } from "./password-policy";

describe("password policy", () => {
  it("accepts long passwords with a letter and a digit", () => {
    expect(isPasswordPolicyOk("Test-Password-123")).toBe(true);
    expect(isPasswordPolicyOk("abcdefghij1")).toBe(true);
  });

  it("rejects short or letter/digit-only passwords", () => {
    expect(isPasswordPolicyOk("short1A")).toBe(false);
    expect(isPasswordPolicyOk("abcdefghij")).toBe(false);
    expect(isPasswordPolicyOk("1234567890")).toBe(false);
  });

  it("throws BadRequestException via assertPasswordPolicy", () => {
    expect(() => assertPasswordPolicy("tiny")).toThrow(BadRequestException);
  });
});
