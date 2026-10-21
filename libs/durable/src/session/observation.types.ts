import type committedStateSourceTypes from "./committed-state-source.types.ts";
import type committedWatchTypes from "./committed-watch.types.ts";

declare namespace observationTypes {
  type ObservedDocumentValue = committedStateSourceTypes.ObservedDocumentValue;

  type CommittedStateSource<T = ObservedDocumentValue> =
    committedStateSourceTypes.CommittedStateSource<T>;

  type CommittedWatch<T = committedStateSourceTypes.ObservedDocumentValue> =
    committedWatchTypes.CommittedWatch<T>;
}

export type { observationTypes as default };
