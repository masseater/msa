import { Data } from "effect";

export class SessionFailed extends Data.TaggedError("SessionFailed")<{
  readonly message: string;
  readonly cause: unknown;
}> {
  constructor(cause: unknown) {
    super({ message: "Session failed after a storage error; close and reopen it", cause });
  }
}
