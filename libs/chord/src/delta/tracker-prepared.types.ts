import type PreparedImplClass from "./tracker-prepared.ts";

declare namespace trackerPreparedTypes {
  type PreparedImpl<T extends object> = PreparedImplClass<T>;
}

export type { trackerPreparedTypes as default };
