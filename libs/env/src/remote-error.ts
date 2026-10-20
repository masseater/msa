import RemoteError from "./remote-error-class.ts";

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
