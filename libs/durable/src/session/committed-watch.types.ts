import type committedStateSourceTypes from "./committed-state-source.types.ts";
import type CommittedWatchClass from "./committed-watch.ts";

declare namespace committedWatchTypes {
  type CommittedWatch<T = committedStateSourceTypes.ObservedDocumentValue> = CommittedWatchClass<T>;
}

export type { committedWatchTypes as default };
