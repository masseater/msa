import type jsonTypes from "../json.types.ts";
import type draftTypes from "./draft.ts";
import type opsTypes from "./ops.types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";

declare namespace trackerTypes {
  type JsonValue = jsonTypes.JsonValue;

  type Draft<T, Depth extends readonly unknown[] = []> = draftTypes.Draft<T, Depth>;

  type Op = opsTypes.Op;

  type Change<T extends object> = trackerTypesModule.Change<T>;

  type Prepared<T extends object> = trackerTypesModule.Prepared<T>;

  type Tracker<T extends object> = trackerTypesModule.Tracker<T>;
}

export type { trackerTypes as default };
