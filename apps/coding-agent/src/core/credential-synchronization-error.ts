import type aiTypes from "@msa/ai/index.types";
import * as Schema from "effect/Schema";

const Credential = Schema.declare(
  (input: unknown): input is aiTypes.Credential =>
    typeof input === "object" &&
    input !== null &&
    "type" in input &&
    (input.type === "api_key" || input.type === "oauth"),
);

export default class CredentialSynchronizationError extends Schema.TaggedError<
  CredentialSynchronizationError,
  { readonly brand: unique symbol }
>()("CredentialSynchronizationError", {
  cause: Schema.Unknown,
  credential: Schema.UndefinedOr(Credential),
  message: Schema.String,
  operation: Schema.Literals(["login", "logout", "setRuntimeApiKey", "removeRuntimeApiKey"]),
  providerId: Schema.String,
}) {
  static create(
    providerId: string,
    operation: CredentialSynchronizationError["operation"],
    credential: aiTypes.Credential | undefined,
    options: ErrorOptions,
  ): CredentialSynchronizationError {
    return CredentialSynchronizationError.make({
      cause: options.cause,
      credential,
      message: `Credential ${operation} committed for ${providerId}, but local synchronization failed`,
      operation,
      providerId,
    });
  }
}
