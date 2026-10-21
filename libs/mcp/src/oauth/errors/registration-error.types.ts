import type OAuthRegistrationErrorClass from "./registration-error.ts";

declare namespace registrationErrorTypes {
  type OAuthRegistrationError = OAuthRegistrationErrorClass;
}

export type { registrationErrorTypes as default };
