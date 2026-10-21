import { Data } from "effect";

import type remoteErrorTypes from "./remote-error.types.ts";

export default class RemoteError extends Data.TaggedError("RemoteError")<{
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
