import { Schema } from "effect";

import type remoteErrorTypes from "./remote-error.types.ts";

export default class RemoteError extends Schema.TaggedError<
  RemoteError,
  { readonly brand: unique symbol }
>()("RemoteError", {
  code: Schema.String,
  fields: Schema.Record(Schema.String, Schema.Unknown),
  message: Schema.String,
  path: Schema.optionalKey(Schema.String),
}) {
  static create(fields: remoteErrorTypes.Json): RemoteError {
    const path = fields["path"];
    return RemoteError.make({
      code: typeof fields["code"] === "string" ? fields["code"] : "unknown",
      message:
        typeof fields["message"] === "string" ? fields["message"] : "Remote operation failed",
      ...(typeof path === "string" ? { path } : {}),
      fields,
    });
  }
}
