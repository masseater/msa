declare namespace harnessSchedulerRetentionSupportTypes {
  type Sizes = Record<
    "live" | "settled" | "edges" | "below" | "roots" | "unloaded" | "dropQueue",
    number
  >;
}

export type { harnessSchedulerRetentionSupportTypes as default };
