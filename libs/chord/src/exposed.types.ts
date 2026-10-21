import type ExposedImplClass from "./exposed.ts";

declare namespace exposedTypes {
  type ExposedImpl = ExposedImplClass;
}

export type { exposedTypes as default };
