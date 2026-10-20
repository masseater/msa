import type readContentTypes from "./read-content.types.ts";

declare namespace readTypes {
  type ReadOperations = readContentTypes.ReadOperations;

  type ReadToolDetails = readContentTypes.ReadToolDetails;

  type ReadToolInput = readContentTypes.ReadToolInput;

  type ReadToolOptions = readContentTypes.ReadToolOptions;

  type ReadToolOutput = readContentTypes.ReadToolOutput;
}

export type { readTypes as default };
