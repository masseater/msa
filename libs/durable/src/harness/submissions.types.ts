import type sessionTypes from "../session/session.types.ts";
import type inboxTypes from "./inbox.types.ts";
import type SubmissionsClass from "./submissions.ts";

declare namespace submissionsTypes {
  type AbortResult = "aborted" | "already_placed" | "settled";

  type Submissions = SubmissionsClass;

  type QueueModes = inboxTypes.QueueModes;

  type SessionImpl = sessionTypes.SessionImpl;
}

export type { submissionsTypes as default };
