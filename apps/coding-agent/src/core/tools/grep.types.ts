import type { Static } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import type grepSupport from "./grep-support.ts";
import type grepSupportTypes from "./grep-support.types.ts";

declare namespace grepTypes {
  type GrepToolInput = Static<typeof grepSupport.grepSchema>;

  interface GrepToolOptions {
    operations?: grepSupportTypes.GrepOperations;
  }

  type GrepOperations = grepSupportTypes.GrepOperations;

  type GrepToolDetails = grepSupportTypes.GrepToolDetails;

  type GrepCallInput = grepSupportTypes.GrepCallInput;

  type GrepToolContext = extensionsTypesTypes.ExtensionContext;

  type GrepToolDefinition = extensionsTypesTypes.ToolDefinition<
    typeof grepSupport.grepSchema,
    GrepToolDetails | undefined
  >;
}

export type { grepTypes as default };
