import type { Static } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import type findSupport from "./find-support.ts";
import type findSupportTypes from "./find-support.types.ts";

declare namespace findTypes {
  type FindToolInput = Static<typeof findSupport.findSchema>;

  interface FindToolOptions {
    operations?: findSupportTypes.FindOperations;
  }

  type FindOperations = findSupportTypes.FindOperations;

  type FindToolDetails = findSupportTypes.FindToolDetails;

  type FindToolContext = extensionsTypesTypes.ExtensionContext;

  type FindToolDefinition = extensionsTypesTypes.ToolDefinition<
    typeof findSupport.findSchema,
    FindToolDetails | undefined
  >;
}

export type { findTypes as default };
