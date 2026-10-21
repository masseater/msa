import type extensionsTypesTypes from "../extensions/types.types.ts";
import type readContent from "./read-content.ts";
import type readContentTypes from "./read-content.types.ts";

declare namespace readTypes {
  type ReadOperations = readContentTypes.ReadOperations;

  type ReadToolDetails = readContentTypes.ReadToolDetails;

  type ReadToolInput = readContentTypes.ReadToolInput;

  type ReadToolOptions = readContentTypes.ReadToolOptions;

  type ReadToolOutput = readContentTypes.ReadToolOutput;

  type ReadToolContext = extensionsTypesTypes.ExtensionContext;

  type ReadToolDefinition = extensionsTypesTypes.ToolDefinition<
    typeof readContent.readSchema,
    ReadToolDetails | undefined
  >;
}

export type { readTypes as default };
