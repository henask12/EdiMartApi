import { SetMetadata } from "@nestjs/common";

export const ALLOW_PASSWORD_CHANGE_KEY = "allowPasswordChange";

/** Marks routes that a user who still must change their password is allowed to call. */
export const AllowPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
