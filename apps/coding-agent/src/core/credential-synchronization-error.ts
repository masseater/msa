import type aiTypes from "@msa/ai/index.types";
import * as Data from "effect/Data";

import type modelRuntimeTypes from "./model-runtime.types.ts";

export default class CredentialSynchronizationError extends Data.TaggedError(
  "CredentialSynchronizationError",
)<{
  readonly providerId: string;
  readonly operation: modelRuntimeTypes.CredentialSynchronizationOperation;
  readonly credential: aiTypes.Credential | undefined;
  readonly message: string;
  readonly cause: unknown;
}> {
  constructor(
    providerId: string,
    operation: modelRuntimeTypes.CredentialSynchronizationOperation,
    credential: aiTypes.Credential | undefined,
    options: ErrorOptions,
  ) {
    super({
      cause: options.cause,
      credential,
      message: `Credential ${operation} committed for ${providerId}, but local synchronization failed`,
      operation,
      providerId,
    });
  }
}
