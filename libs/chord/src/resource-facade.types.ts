import type ResourceFacadeClass from "./resource-facade.ts";

declare namespace resourceFacadeTypes {
  type ResourceFacade<T> = ResourceFacadeClass<T>;
}

export type { resourceFacadeTypes as default };
