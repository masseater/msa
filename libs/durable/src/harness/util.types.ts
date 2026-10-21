import type util from "./util.ts";

declare namespace utilTypes {
  type Waiters<K, T> = InstanceType<typeof util.Waiters<K, T>>;
}

export type { utilTypes as default };
