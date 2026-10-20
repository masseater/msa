import type cellFanout from "./cell-fanout.ts";

declare namespace cellFanoutTypes {
  type Fanout<T> = InstanceType<typeof cellFanout.Fanout<T>>;
}

export type { cellFanoutTypes as default };
