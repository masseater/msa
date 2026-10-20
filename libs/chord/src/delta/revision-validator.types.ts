import type JsonRevisionValidatorClass from "./revision-validator.ts";

declare namespace revisionValidatorTypes {
  type JsonRevisionValidator = JsonRevisionValidatorClass;
}

export type { revisionValidatorTypes as default };
