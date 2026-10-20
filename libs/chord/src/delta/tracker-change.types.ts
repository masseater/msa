import type ChangeImplClass from "./tracker-change.ts";

declare namespace trackerChangeTypes {
  type ChangeImpl<T extends object> = ChangeImplClass<T>;
}

export type { trackerChangeTypes as default };
