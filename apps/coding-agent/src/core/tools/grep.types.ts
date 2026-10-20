import type { Static } from "typebox";

import type grepSupport from "./grep-support.ts";
import type grepSupportTypes from "./grep-support.types.ts";

declare namespace grepTypes {
  type GrepToolInput = Static<typeof grepSupport.grepSchema>;

  interface GrepToolOptions {
    operations?: grepSupportTypes.GrepOperations;
  }

  type GrepOperations = grepSupportTypes.GrepOperations;

  type GrepToolDetails = grepSupportTypes.GrepToolDetails;
}

export type { grepTypes as default };
