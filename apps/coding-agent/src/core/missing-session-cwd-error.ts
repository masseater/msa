import * as Data from "effect/Data";

import sessionCwdShared from "./session-cwd-shared.ts";
import type sessionCwdTypes from "./session-cwd.types.ts";
const { formatMissingSessionCwdError } = sessionCwdShared;

export default class MissingSessionCwdError extends Data.TaggedError("MissingSessionCwdError")<{
  readonly issue: sessionCwdTypes.SessionCwdIssue;
  readonly message: string;
}> {
  constructor(issue: sessionCwdTypes.SessionCwdIssue) {
    super({ issue, message: formatMissingSessionCwdError(issue) });
  }
}
