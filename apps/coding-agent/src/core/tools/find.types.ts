import type { Static } from "typebox";

import type findSupport from "./find-support.ts";
import type findSupportTypes from "./find-support.types.ts";

declare namespace findTypes {
  type FindToolInput = Static<typeof findSupport.findSchema>;

  interface FindToolOptions {
    operations?: findSupportTypes.FindOperations;
  }

  type FindOperations = findSupportTypes.FindOperations;

  type FindToolDetails = findSupportTypes.FindToolDetails;
}

export type { findTypes as default };
