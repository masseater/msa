import type { Effect } from "effect";

import type support from "./support.ts";

declare namespace harnessTasksRecoverySupportTypes {
  type OpenHarness = Effect.Success<ReturnType<typeof support.openTasks>>["harness"];

  type Step = { phase: "run" };

  type Handover = { phase: "a" } | { phase: "b" } | { phase: "c" };

  type Gates = {
    readonly a?: Promise<void>;
    readonly b?: Promise<void>;
    readonly onEnd?: () => void;
  };
}

export type { harnessTasksRecoverySupportTypes as default };
