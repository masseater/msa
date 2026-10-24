import { Schema } from "effect";

import RemoteError from "./remote-error-class.ts";

function lost(message: string): RemoteError {
  return RemoteError.create({ code: "unknown", lost: true, message });
}

function isConnectionLost(error: unknown): boolean {
  return Schema.is(RemoteError)(error) && error.fields["lost"] === true;
}

function closed(): RemoteError {
  return RemoteError.create({ code: "unknown", message: "Connection closed" });
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
