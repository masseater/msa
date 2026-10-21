import type typesModule from "../types.types.ts";
import type CommittedStateSourceClass from "./committed-state-source.ts";

declare namespace committedStateSourceTypes {
  type ObservedDocumentValue = Readonly<typesModule.JsonObject> | null;

  type CommittedStateSource<T = ObservedDocumentValue> = CommittedStateSourceClass<T>;
}

export type { committedStateSourceTypes as default };
