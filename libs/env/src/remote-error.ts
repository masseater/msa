import { Data } from "effect";

export type Json = Record<string, unknown>;

export type Wire<T> = { [K in keyof T]: T[K] };

export class RemoteError extends Data.TaggedError("RemoteError")<{
  readonly message: string;
  readonly code: string;
  readonly path?: string;
  readonly fields: Json;
}> {
  constructor(fields: Json) {
    const path = fields["path"];
    super({
      message:
        typeof fields["message"] === "string" ? fields["message"] : "Remote operation failed",
      code: typeof fields["code"] === "string" ? fields["code"] : "unknown",
      ...(typeof path === "string" ? { path } : {}),
      fields,
    });
  }
}

export function lost(message: string): RemoteError {
  return new RemoteError({ code: "unknown", message, lost: true });
}

export function isConnectionLost(error: unknown): boolean {
  return error instanceof RemoteError && error.fields["lost"] === true;
}

export function closed(): RemoteError {
  return new RemoteError({ code: "unknown", message: "Connection closed" });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
