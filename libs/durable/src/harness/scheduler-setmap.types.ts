import type SetMapClass from "./scheduler-setmap.ts";

declare namespace schedulerSetmapTypes {
  type SetMap<K, V> = SetMapClass<K, V>;
}

export type { schedulerSetmapTypes as default };
