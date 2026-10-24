import * as Schema from "effect/Schema";

import sessionCwdShared from "./session-cwd-shared.ts";
import type sessionCwdTypes from "./session-cwd.types.ts";
const { formatMissingSessionCwdError } = sessionCwdShared;

export default class MissingSessionCwdError extends Schema.TaggedError<
  MissingSessionCwdError,
  { readonly brand: unique symbol }
>()("MissingSessionCwdError", {
  issue: Schema.Struct({
    fallbackCwd: Schema.String,
    sessionCwd: Schema.String,
    sessionFile: Schema.optionalKey(Schema.String),
  }),
  message: Schema.String,
}) {
  static create(issue: sessionCwdTypes.SessionCwdIssue): MissingSessionCwdError {
    return MissingSessionCwdError.make({ issue, message: formatMissingSessionCwdError(issue) });
  }
}
