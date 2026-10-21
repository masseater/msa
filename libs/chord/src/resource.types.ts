import type resource from "./resource.ts";

declare namespace resourceTypes {
  type ResourceImpl<T = unknown> = InstanceType<typeof resource.ResourceImpl<T>>;
}

export type { resourceTypes as default };
