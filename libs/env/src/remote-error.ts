import { Data } from "effect";

import type remoteErrorTypes from "./remote-error.types.ts";

class RemoteError extends Data.TaggedError("RemoteError")<{
  readonly message: string;
  readonly code: string;
  readonly path?: string;
  readonly fields: remoteErrorTypes.Json;
}> {
  constructor(fields: remoteErrorTypes.Json) {
    const path = fields["path"];
    super({
      code: typeof fields["code"] === "string" ? fields["code"] : "unknown",
      message:
        typeof fields["message"] === "string" ? fields["message"] : "Remote operation failed",
      ...(typeof path === "string" ? { path } : {}),
      fields,
    });
  }
}

function lost(message: string): RemoteError {
  return new RemoteError({ code: "unknown", lost: true, message });
}

function isConnectionLost(error: unknown): boolean {
  return error instanceof RemoteError && error.fields["lost"] === true;
}

function closed(): RemoteError {
  return new RemoteError({ code: "unknown", message: "Connection closed" });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const remoteError = {
  RemoteError,
  closed,
  errorMessage,
  isConnectionLost,
  lost,
};

export default remoteError;
